/**
 * Hash chain de DEC-008.
 *
 * `hash = SHA256(canonical(payload) || prev_hash)`, encadenado POR PROMOCION.
 *
 * ---------------------------------------------------------------------------
 * EL PREIMAGE, CON PRECISION, PORQUE LA FRASE DE DEC-008 NO BASTA
 * ---------------------------------------------------------------------------
 *
 * "canonical(payload) || prev_hash" describe la idea, no una construccion
 * verificable. Concatenar sin mas deja dos huecos reales:
 *
 *   1. AMBIGUEDAD DE CONCATENACION. Si dos campos variables se pegan sin
 *      separador ni longitud, existen pares distintos que producen la misma
 *      cadena de bytes. Aqui el `prev_hash` tiene 32 bytes fijos al final, asi
 *      que ese extremo esta a salvo, pero el dominio y la promocion no lo
 *      estan. Van con longitud delante.
 *
 *   2. SUSTITUCION DE VERSION. Si `canonicalization_version` viaja en la fila
 *      pero NO entra en el hash, quien controle la fila puede reetiquetarla
 *      como version 2 y presentar despues una canonicalizacion mas permisiva
 *      que produzca el mismo hash con otro contenido. La version entra en el
 *      preimage.
 *
 * Layout v1, en bytes:
 *
 *   "LSW/CHAIN/v1\n"                      etiqueta de dominio criptografico
 *   u8(len(domain))   || domain           UTF-8
 *   u8(len(promoId))  || promoId          UTF-8
 *   u32be(canonicalizationVersion)
 *   u32be(len(canonical)) || canonical    UTF-8, sin BOM (ver `canonical.ts`)
 *   prevHash                              32 bytes exactos
 *
 * ---------------------------------------------------------------------------
 * EL GENESIS NO ES CERO
 * ---------------------------------------------------------------------------
 *
 * La primera fila de una promocion no tiene anterior. La tentacion es usar 32
 * ceros. Con ceros, la cadena de la promocion A y la de la promocion B empiezan
 * en el mismo punto, y una fila de A -con su hash intacto- puede presentarse
 * como la primera fila de B. El genesis se deriva del dominio y de la
 * promocion, de modo que cada cadena esta anclada a la suya y un injerto entre
 * promociones se detecta en la primera comprobacion.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA CADENA NO PUEDE HACER SOLA
 * ---------------------------------------------------------------------------
 *
 * Detectar que alguien reescribio el pasado ENTERO. Quien tenga acceso total a
 * la base de datos puede alterar una fila y recalcular todas las posteriores:
 * la cadena resultante es internamente perfecta. La unica defensa es que el
 * `chain_head_hash` este sellado fuera de su alcance, y eso vive en
 * `sealing.ts`. Esa es la razon por la que DEC-008 exige el sellado externo, y
 * el motivo de que `verifyChain` devuelva siempre el head observado aunque la
 * cadena verifique: el head es lo que se compara con el sello.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { canonicalizeToBytes } from "./canonical.js";
import type { CanonicalObject } from "./canonical.js";
import {
  CURRENT_CANONICALIZATION_VERSION,
  canonicalFieldsFor,
  canonicalizationDescriptor,
  isSupportedCanonicalizationVersion,
  projectCanonicalPayload,
} from "./canonicalization.js";
import type { ChainDomain } from "./canonicalization.js";

const encoder = new TextEncoder();

const CHAIN_LABEL = encoder.encode("LSW/CHAIN/v1\n");
const GENESIS_LABEL = encoder.encode("LSW/CHAIN/GENESIS/v1\n");

/** SHA-256 produce 32 bytes. Cualquier otra longitud es una fila corrupta. */
export const CHAIN_HASH_BYTES = 32;

function sha256(chunks: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return new Uint8Array(hash.digest());
}

function lengthPrefixed(text: string, label: string): readonly Uint8Array[] {
  const bytes = encoder.encode(text);
  if (bytes.length === 0) {
    throw new Error(`${label} vacio: no puede formar parte de un preimage.`);
  }
  if (bytes.length > 255) {
    throw new Error(`${label} demasiado largo (${String(bytes.length)} bytes, maximo 255).`);
  }
  return [Uint8Array.of(bytes.length), bytes];
}

function uint32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Valor fuera de rango para un entero de 32 bits: ${String(value)}`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/u.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Hash hexadecimal invalido: se espera minusculas y longitud par.");
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** Comparacion en tiempo constante. Aqui no protege un secreto, protege el habito. */
export function hashesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/**
 * Ancla de la cadena de una promocion en un dominio.
 *
 * No depende de la version de canonicalizacion: es el punto de partida del
 * par (dominio, promocion), y ese par no cambia si manana la canonicalizacion
 * pasa a la version 2 a mitad de la cadena.
 */
export function genesisHash(domain: ChainDomain, promotionId: string): Uint8Array {
  return sha256([
    GENESIS_LABEL,
    ...lengthPrefixed(domain, "dominio"),
    ...lengthPrefixed(promotionId, "promotion_id"),
  ]);
}

export interface ChainHashInput {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  readonly canonicalizationVersion: number;
  /** Payload YA proyectado sobre los campos de la version. */
  readonly payload: CanonicalObject;
  /** `null` para la primera fila de la promocion: se usa el genesis. */
  readonly previousHash: Uint8Array | null;
}

export function computeChainHash(input: ChainHashInput): Uint8Array {
  if (!isSupportedCanonicalizationVersion(input.canonicalizationVersion)) {
    throw new Error(
      `canonicalization_version ${String(input.canonicalizationVersion)} no soportada: ` +
        "no se puede calcular un hash con un algoritmo que este proceso no conoce.",
    );
  }

  const previous = input.previousHash ?? genesisHash(input.domain, input.promotionId);
  if (previous.length !== CHAIN_HASH_BYTES) {
    throw new Error(
      `prev_hash de ${String(previous.length)} bytes; se esperan ${String(CHAIN_HASH_BYTES)}.`,
    );
  }

  const canonical = canonicalizeToBytes(input.payload);

  return sha256([
    CHAIN_LABEL,
    ...lengthPrefixed(input.domain, "dominio"),
    ...lengthPrefixed(input.promotionId, "promotion_id"),
    uint32be(input.canonicalizationVersion),
    uint32be(canonical.length),
    canonical,
    previous,
  ]);
}

/** Campos que la version cubre en cada dominio. */
function fieldsFor(domain: ChainDomain, version: number): readonly string[] {
  return canonicalFieldsFor(domain, canonicalizationDescriptor(version));
}

/**
 * Calcula el hash de una fila cruda, proyectandola primero sobre los campos de
 * su version. Es el camino que usan tanto el escritor como el verificador: si
 * fueran dos, la cadena probaria que coinciden consigo mismas.
 */
export function computeRowHash(input: {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  readonly canonicalizationVersion?: number;
  readonly row: Readonly<Record<string, unknown>>;
  readonly previousHash: Uint8Array | null;
}): Uint8Array {
  const version = input.canonicalizationVersion ?? CURRENT_CANONICALIZATION_VERSION;
  return computeChainHash({
    domain: input.domain,
    promotionId: input.promotionId,
    canonicalizationVersion: version,
    payload: projectCanonicalPayload(input.row, fieldsFor(input.domain, version)),
    previousHash: input.previousHash,
  });
}

/** Fila tal y como esta guardada, para verificar. */
export interface StoredChainLink {
  readonly id: string;
  /** `sequence_no` como cadena de digitos: es `bigint` en la tabla. */
  readonly sequence: string;
  readonly canonicalizationVersion: number;
  /** Fila cruda. El verificador proyecta; no confia en que ya venga proyectada. */
  readonly row: Readonly<Record<string, unknown>>;
  readonly storedHash: Uint8Array;
  readonly storedPreviousHash: Uint8Array | null;
}

export type ChainBreakKind =
  | "UNSUPPORTED_VERSION"
  | "MALFORMED_HASH"
  | "MALFORMED_SEQUENCE"
  | "GENESIS_MISMATCH"
  | "LINK_BROKEN"
  | "HASH_MISMATCH"
  | "SEQUENCE_NOT_INCREASING"
  | "DUPLICATE_ID"
  | "PAYLOAD_UNCANONICALIZABLE";

export interface ChainBreak {
  readonly index: number;
  readonly linkId: string;
  readonly sequence: string;
  readonly kind: ChainBreakKind;
  readonly expected: string | null;
  readonly actual: string | null;
  readonly detail: string;
}

export interface ChainVerificationResult {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  readonly ok: boolean;
  readonly linkCount: number;
  /**
   * Hash de la ultima fila observada, en hexadecimal. Se devuelve SIEMPRE,
   * tambien cuando la cadena esta rota: es el valor que se compara con el
   * sello externo, y esa comparacion es la unica que detecta una reescritura
   * completa y coherente.
   */
  readonly observedHeadHash: string | null;
  readonly breaks: readonly ChainBreak[];
}

export interface VerifyChainInput {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  /** Filas de ESA promocion, ordenadas por `sequence_no` ascendente. */
  readonly links: readonly StoredChainLink[];
}

/**
 * Recorre la cadena y devuelve TODAS las roturas, no solo la primera.
 *
 * Cada fila se juzga con dos comprobaciones INDEPENDIENTES:
 *
 *   a) consistencia propia - recalcular su payload con su `chain_prev_hash`
 *      guardado debe reproducir su `chain_hash` guardado;
 *   b) encadenamiento - su `chain_prev_hash` guardado debe ser el `chain_hash`
 *      guardado de la fila anterior (o el genesis, si es la primera).
 *
 * Separarlas importa. Si se comprobara una sola cosa -recalcular en cascada-,
 * una fila alterada haria fallar todas las siguientes y el informe diria "la
 * cadena esta rota desde marzo" cuando lo que hay es UNA fila tocada. Un
 * informe que no distingue entre una manipulacion y sus consecuencias no sirve
 * para investigar nada.
 */
export function verifyChain(input: VerifyChainInput): ChainVerificationResult {
  const breaks: ChainBreak[] = [];
  const seenIds = new Set<string>();
  let previousStoredHash: Uint8Array | null = null;
  let previousSequence: bigint | null = null;
  let observedHeadHash: string | null = null;

  for (const [index, link] of input.links.entries()) {
    const at = (
      kind: ChainBreakKind,
      detail: string,
      expected: string | null,
      actual: string | null,
    ): void => {
      breaks.push({
        index,
        linkId: link.id,
        sequence: link.sequence,
        kind,
        expected,
        actual,
        detail,
      });
    };

    if (seenIds.has(link.id)) {
      at("DUPLICATE_ID", "El mismo id aparece dos veces en la cadena.", null, link.id);
    }
    seenIds.add(link.id);

    // El verificador NUNCA debe lanzar por culpa de un dato de entrada. Sus
    // entradas son filas de una base de datos que, por hipotesis del propio
    // control, puede estar bajo el control de quien manipula: un `sequence_no`
    // con basura tumbaria el proceso, y un verificador caido no informa de
    // nada. Se registra como rotura y se sigue recorriendo.
    let sequence: bigint | null = null;
    try {
      sequence = BigInt(link.sequence);
    } catch {
      at(
        "MALFORMED_SEQUENCE",
        "sequence_no no es un entero: la fila no puede situarse en el recorrido.",
        "entero decimal",
        link.sequence,
      );
    }

    if (sequence !== null) {
      if (previousSequence !== null && sequence <= previousSequence) {
        at(
          "SEQUENCE_NOT_INCREASING",
          "Las filas no llegan en orden estricto de sequence_no; el recorrido no es fiable.",
          `> ${previousSequence.toString()}`,
          sequence.toString(),
        );
      }
      previousSequence = sequence;
    }

    if (link.storedHash.length !== CHAIN_HASH_BYTES) {
      at(
        "MALFORMED_HASH",
        `chain_hash de ${String(link.storedHash.length)} bytes.`,
        String(CHAIN_HASH_BYTES),
        String(link.storedHash.length),
      );
    }

    // (b) encadenamiento
    const expectedPrevious = previousStoredHash ?? genesisHash(input.domain, input.promotionId);
    const actualPrevious = link.storedPreviousHash;

    if (actualPrevious === null && index !== 0) {
      at(
        "LINK_BROKEN",
        "chain_prev_hash nulo en una fila que no es la primera de la promocion.",
        toHex(expectedPrevious),
        null,
      );
    } else if (actualPrevious !== null && !hashesEqual(expectedPrevious, actualPrevious)) {
      at(
        index === 0 ? "GENESIS_MISMATCH" : "LINK_BROKEN",
        index === 0
          ? "La primera fila no ancla en el genesis de esta promocion: la cadena empieza en otro sitio."
          : "chain_prev_hash no coincide con el chain_hash de la fila anterior: falta, sobra o se reordeno una fila.",
        toHex(expectedPrevious),
        toHex(actualPrevious),
      );
    }

    // (a) consistencia propia
    if (!isSupportedCanonicalizationVersion(link.canonicalizationVersion)) {
      at(
        "UNSUPPORTED_VERSION",
        "Version de canonicalizacion desconocida: la fila NO queda verificada.",
        null,
        String(link.canonicalizationVersion),
      );
    } else {
      try {
        const recomputed = computeRowHash({
          domain: input.domain,
          promotionId: input.promotionId,
          canonicalizationVersion: link.canonicalizationVersion,
          row: link.row,
          previousHash: actualPrevious,
        });
        if (!hashesEqual(recomputed, link.storedHash)) {
          at(
            "HASH_MISMATCH",
            index === 0
              ? // En la PRIMERA fila el genesis de esta promocion es una de las
                // entradas del hash. Asi que aqui caben dos explicaciones y
                // desde el hash no se pueden separar: o el contenido de la fila
                // fue alterado, o la fila pertenece a la cadena de OTRA
                // promocion y alguien la injerto en esta. Se dicen las dos.
                "La primera fila no reproduce su chain_hash con el genesis de esta promocion: " +
                  "o su contenido fue alterado, o la fila procede de la cadena de otra promocion."
              : "El contenido de la fila no produce su chain_hash guardado: la fila fue alterada.",
            toHex(recomputed),
            toHex(link.storedHash),
          );
        }
      } catch (error) {
        at(
          "PAYLOAD_UNCANONICALIZABLE",
          error instanceof Error ? error.message : String(error),
          null,
          null,
        );
      }
    }

    previousStoredHash = link.storedHash;
    observedHeadHash = toHex(link.storedHash);
  }

  return {
    domain: input.domain,
    promotionId: input.promotionId,
    ok: breaks.length === 0,
    linkCount: input.links.length,
    observedHeadHash,
    breaks,
  };
}
