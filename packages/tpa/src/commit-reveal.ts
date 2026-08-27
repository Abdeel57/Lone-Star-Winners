/**
 * Commit-reveal del sorteo interno.
 *
 * ---------------------------------------------------------------------------
 * ESTADO: DESACTIVADO POR DEFECTO Y PENDIENTE DE DECISION DEL CLIENTE
 * ---------------------------------------------------------------------------
 *
 * DEC-017 lo recoge como "nota adicional propuesta por security, NO
 * VINCULANTE". Que este implementado no lo aprueba: el modo por defecto de
 * `initiateDraw` no lo usa, y activarlo exige configuracion explicita, igual
 * que el sorteo entero exige sus cinco cerrojos. Queda anotado en
 * `docs/LEGAL_PENDING.md` como decision del cliente y de su abogado.
 *
 * ---------------------------------------------------------------------------
 * QUE PROBLEMA RESUELVE, Y CUAL NO
 * ---------------------------------------------------------------------------
 *
 * Un sorteo con CSPRNG es uniforme, pero la evidencia de que lo fue es interna:
 * "sacamos un numero de `node:crypto` y salio este". Un tercero no puede
 * distinguir eso de "tiramos varias veces hasta que salio el que queriamos".
 * Nadie puede, ni siquiera nosotros, y ese es justo el problema.
 *
 * El commit-reveal parte el acto en dos:
 *
 *   1. ANTES del sorteo se publica `commitment = SHA256(server_seed)`, junto
 *      con el `content_digest` del snapshot. En ese momento la semilla ya esta
 *      fijada pero nadie la conoce, y el universo tambien esta fijado.
 *   2. DESPUES se revela `server_seed`. Cualquiera comprueba que su SHA-256 es
 *      el `commitment` publicado y que el ordinal se deriva de ella de forma
 *      determinista.
 *
 * Repetir el sorteo deja de ser posible sin que se note: el segundo intento
 * necesitaria otra semilla, y esa no encaja con el compromiso publicado.
 *
 * LO QUE NO RESUELVE: no impide elegir la semilla con mala fe ANTES de
 * comprometerla. Quien pueda simular el resultado de muchas semillas puede
 * comprometer la que le conviene. Para cerrar ese hueco hace falta entropia
 * que el operador no controle -por ejemplo aportada por el administrador
 * externo, o un beacon publico posterior al compromiso-, y eso es una decision
 * de diseno del cliente con su abogado, no una decision de este paquete. El
 * `context` de la derivacion deja el sitio preparado para anadirla.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { ByteSource } from "./random.js";
import type { Csprng } from "./ports.js";

const encoder = new TextEncoder();

/** Identificador versionado del esquema. Viaja en el registro del sorteo. */
export const COMMIT_REVEAL_SCHEME = "LSW/DRAW/COMMIT-REVEAL/v1";

const COMMIT_LABEL = encoder.encode("LSW/DRAW/COMMIT/v1\n");
const DERIVE_LABEL = encoder.encode("LSW/DRAW/DRBG/v1\n");

/** 32 bytes: el mismo tamano que la salida de SHA-256. */
export const SERVER_SEED_BYTES = 32;

function sha256(chunks: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return new Uint8Array(hash.digest());
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function fromHex(hex: string, label: string): Uint8Array {
  // La longitud se comprueba aparte, con aritmetica, en vez de con un grupo
  // repetido dentro del patron: un `(?:..)+` dispara el detector de ReDoS y
  // ademas no aporta nada que esta linea no diga mejor.
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(hex)) {
    throw new Error(`${label} no es hexadecimal en minusculas de longitud par.`);
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function uint32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/**
 * `commitment = SHA256(etiqueta || server_seed)`.
 *
 * La etiqueta separa dominios: sin ella, el mismo valor podria presentarse como
 * compromiso de una semilla y como hash de otra cosa que casualmente tuviera
 * esos bytes.
 */
export function computeCommitment(serverSeedHex: string): string {
  return toHex(sha256([COMMIT_LABEL, fromHex(serverSeedHex, "La semilla")]));
}

export function verifyCommitment(commitmentHex: string, serverSeedHex: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(commitmentHex)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(computeCommitment(serverSeedHex), "hex"),
    Buffer.from(commitmentHex, "hex"),
  );
}

/**
 * Contexto de derivacion: ata la semilla a ESTE sorteo.
 *
 * Sin el, una semilla comprometida para el snapshot de marzo serviria para
 * "verificar" el sorteo de abril, y el compromiso dejaria de decir nada sobre
 * cual de los dos se sorteo primero.
 */
export interface DrawDerivationContext {
  readonly promotionId: string;
  readonly snapshotId: string;
  readonly snapshotContentDigest: string;
  readonly totalEligibleEntries: number;
  /** Identificador de la peticion de sorteo: distingue dos sorteos del mismo snapshot. */
  readonly drawRequestId: string;
}

function contextBytes(context: DrawDerivationContext): Uint8Array {
  // Cada campo va con su longitud delante: concatenar sin separador permitiria
  // que dos contextos distintos produjeran la misma secuencia de bytes.
  const parts: Uint8Array[] = [];
  const fields = [
    context.promotionId,
    context.snapshotId,
    context.snapshotContentDigest,
    context.totalEligibleEntries.toString(10),
    context.drawRequestId,
  ];
  for (const field of fields) {
    const bytes = encoder.encode(field);
    parts.push(uint32be(bytes.length), bytes);
  }
  return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

/**
 * Fuente de bytes derivada de la semilla, en modo contador.
 *
 * `bloque(i) = SHA256(etiqueta || contexto || u32be(i) || semilla)`.
 *
 * Es determinista a proposito: es lo que permite a un tercero repetir la
 * derivacion con la semilla revelada y obtener el mismo ordinal. Fuera del
 * commit-reveal seria una aleatoriedad de mentira, y por eso esta funcion no se
 * usa en el camino por defecto.
 */
export function createSeedByteSource(
  serverSeedHex: string,
  context: DrawDerivationContext,
): ByteSource {
  const seed = fromHex(serverSeedHex, "La semilla");
  const suffix = contextBytes(context);
  let counter = 0;
  let buffer: Uint8Array = new Uint8Array(0);
  let offset = 0;

  return (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (offset >= buffer.length) {
        buffer = sha256([DERIVE_LABEL, suffix, uint32be(counter), seed]);
        counter += 1;
        offset = 0;
      }
      const take = Math.min(length - written, buffer.length - offset);
      out.set(buffer.subarray(offset, offset + take), written);
      offset += take;
      written += take;
    }
    return out;
  };
}

export interface DrawCommitment {
  readonly scheme: string;
  readonly commitment: string;
  /**
   * La semilla. NO se persiste junto al compromiso en el mismo sitio donde
   * cualquiera pueda leerla antes del sorteo: quien la conozca puede simular el
   * resultado. La guarda quien monta el puerto, en el almacen que corresponda,
   * y se publica al revelar.
   */
  readonly serverSeed: string;
}

/** Genera semilla y compromiso. La semilla sale del CSPRNG, nunca de un reloj. */
export function createDrawCommitment(csprng: Csprng): DrawCommitment {
  const seed = csprng.randomBytes(SERVER_SEED_BYTES);
  if (seed.length !== SERVER_SEED_BYTES) {
    throw new Error(
      `El CSPRNG devolvio ${String(seed.length)} bytes de semilla y se pidieron ` +
        `${String(SERVER_SEED_BYTES)}. Una semilla corta no se completa con ceros.`,
    );
  }
  const serverSeed = toHex(seed);
  return { scheme: COMMIT_REVEAL_SCHEME, commitment: computeCommitment(serverSeed), serverSeed };
}

export type RevealVerdict =
  "VERIFIED" | "COMMITMENT_MISMATCH" | "ORDINAL_MISMATCH" | "NOT_A_COMMIT_REVEAL_DRAW";

export interface RevealVerification {
  readonly verdict: RevealVerdict;
  readonly recomputedOrdinal: number | null;
  readonly detail: string;
}

/**
 * Verificacion que ejecutaria un tercero con la semilla revelada.
 *
 * Es una funcion pura, sin acceso a nada nuestro: recibe lo publicado y lo
 * recalcula. Ese es el punto entero del esquema; si hiciera falta nuestro
 * sistema para comprobarlo, no seria una comprobacion independiente.
 */
export function verifyDrawReveal(input: {
  readonly commitment: string | null;
  readonly serverSeed: string;
  readonly context: DrawDerivationContext;
  readonly recordedOrdinal: number;
  readonly selectOrdinalWith: (source: ByteSource) => number;
}): RevealVerification {
  if (input.commitment === null) {
    return {
      verdict: "NOT_A_COMMIT_REVEAL_DRAW",
      recomputedOrdinal: null,
      detail:
        "El registro no tiene compromiso publicado: se sorteo con el CSPRNG directo. No hay " +
        "nada que revelar, y presentar una semilla ahora no probaria nada.",
    };
  }
  if (!verifyCommitment(input.commitment, input.serverSeed)) {
    return {
      verdict: "COMMITMENT_MISMATCH",
      recomputedOrdinal: null,
      detail:
        "SHA-256 de la semilla revelada no es el compromiso publicado. La semilla no es la que " +
        "se comprometio antes del sorteo.",
    };
  }

  const recomputed = input.selectOrdinalWith(createSeedByteSource(input.serverSeed, input.context));
  if (recomputed !== input.recordedOrdinal) {
    return {
      verdict: "ORDINAL_MISMATCH",
      recomputedOrdinal: recomputed,
      detail:
        `La semilla comprometida deriva el ordinal ${String(recomputed)} y el registro guarda ` +
        `${String(input.recordedOrdinal)}. O el universo cambio, o el resultado no salio de esta semilla.`,
    };
  }

  return {
    verdict: "VERIFIED",
    recomputedOrdinal: recomputed,
    detail: "La semilla revelada encaja con el compromiso y deriva el ordinal registrado.",
  };
}

/**
 * Compromiso publicado, tal y como se guarda.
 *
 * La semilla vive aqui hasta que se revela, y ese almacen es sensible: quien la
 * lea antes del sorteo puede simular el resultado. No es un secreto de los que
 * protegen una cuenta -no da acceso a nada- pero si de los que, conocidos a
 * destiempo, arruinan la garantia entera del esquema.
 */
export interface DrawCommitmentRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly snapshotId: string;
  readonly drawRequestId: string;
  readonly commitment: string;
  readonly serverSeed: string;
  readonly publishedAt: string;
  /** Instante en que se uso para sortear. Un compromiso no se reutiliza. */
  readonly consumedAt: string | null;
}

export interface CommitmentStore {
  find(commitmentId: string): Promise<DrawCommitmentRecord | null>;
  markConsumed(commitmentId: string, at: string): Promise<void>;
}
