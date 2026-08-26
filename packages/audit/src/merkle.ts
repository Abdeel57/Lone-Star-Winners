/**
 * Merkle tree sobre el hash canonico de cada registro (DEC-016).
 *
 * ---------------------------------------------------------------------------
 * PARA QUE SIRVE AQUI
 * ---------------------------------------------------------------------------
 *
 * El SHA-256 del fichero entregado prueba que el fichero no cambio. No permite
 * nada mas. El Merkle root permite dos cosas que el administrador externo va a
 * necesitar:
 *
 *   - verificar UN registro concreto -"esta participante estaba en el universo
 *     elegible con estas entries"- sin volver a recibir el fichero completo,
 *     con una prueba de tamano logaritmico;
 *   - detectar una REORDENACION. Un hash de fichero tambien la detecta, pero
 *     el arbol dice ademas por donde.
 *
 * ---------------------------------------------------------------------------
 * DOS DETALLES QUE NO SON DECORATIVOS
 * ---------------------------------------------------------------------------
 *
 * 1. HOJAS Y NODOS INTERNOS LLEVAN PREFIJO DISTINTO (0x00 y 0x01).
 *
 *    Sin esa separacion, un atacante puede presentar el hash de un nodo
 *    INTERNO como si fuera una hoja: la prueba verifica igual y "demuestra"
 *    la pertenencia de un registro que nunca existio. Es un ataque conocido
 *    contra los arboles de Merkle ingenuos, y cuesta un byte evitarlo.
 *
 * 2. UN NIVEL IMPAR PROMUEVE EL NODO SOBRANTE; NO LO DUPLICA.
 *
 *    Duplicar el ultimo nodo -lo que hace Bitcoin- provoca que dos listas de
 *    registros DISTINTAS produzcan el mismo root (CVE-2012-2459). En un export
 *    de sweepstakes eso significaria que dos universos de entries distintos
 *    presentan la misma evidencia. Aqui el nodo sobrante sube de nivel intacto.
 *
 * El arbol vacio tiene root propio, derivado de una etiqueta fija: no es un
 * hash de cero bytes, para que "no hay registros" sea una afirmacion firmable
 * y distinguible de "no se calculo nada".
 */

import { createHash } from "node:crypto";

import { canonicalizeToBytes } from "./canonical.js";
import { hashesEqual, toHex } from "./chain.js";

const encoder = new TextEncoder();

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);
const EMPTY_LABEL = encoder.encode("LSW/MERKLE/v1/EMPTY");

function sha256(chunks: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return new Uint8Array(hash.digest());
}

/** Hash de hoja: `SHA256(0x00 || canonical(record))`. */
export function merkleLeafHash(record: unknown): Uint8Array {
  return sha256([LEAF_PREFIX, canonicalizeToBytes(record)]);
}

function merkleNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256([NODE_PREFIX, left, right]);
}

export const EMPTY_MERKLE_ROOT: Uint8Array = sha256([EMPTY_LABEL]);

/** Root sobre hojas ya calculadas, en el orden en que se entregan. */
export function merkleRootFromLeaves(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    return EMPTY_MERKLE_ROOT;
  }

  let level: Uint8Array[] = [...leaves];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level.at(index);
      const right = level.at(index + 1);
      /* c8 ignore next 3 -- `index` recorre el propio array */
      if (left === undefined) {
        throw new Error("Nodo ausente construyendo el arbol de Merkle.");
      }
      // Nodo impar: sube intacto. Nunca duplicado (CVE-2012-2459).
      next.push(right === undefined ? left : merkleNodeHash(left, right));
    }
    level = next;
  }

  const root = level.at(0);
  /* c8 ignore next 3 -- un nivel no vacio siempre deja exactamente un nodo */
  if (root === undefined) {
    throw new Error("Arbol de Merkle sin raiz.");
  }
  return root;
}

export function merkleRoot(records: readonly unknown[]): Uint8Array {
  return merkleRootFromLeaves(records.map((record) => merkleLeafHash(record)));
}

export interface MerkleProofStep {
  readonly sibling: string;
  readonly position: "LEFT" | "RIGHT";
}

/**
 * Prueba de pertenencia de la hoja `index`.
 *
 * Un nivel impar promueve el nodo sobrante, asi que un paso puede no tener
 * hermano: en ese caso no se anade nada a la prueba, igual que en la
 * construccion del arbol.
 */
export function merkleProof(
  leaves: readonly Uint8Array[],
  index: number,
): readonly MerkleProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`Indice de hoja fuera de rango: ${String(index)}`);
  }

  const steps: MerkleProofStep[] = [];
  let level: Uint8Array[] = [...leaves];
  let position = index;

  while (level.length > 1) {
    const isRight = position % 2 === 1;
    const siblingIndex = isRight ? position - 1 : position + 1;
    const sibling = level.at(siblingIndex);
    if (sibling !== undefined) {
      steps.push({ sibling: toHex(sibling), position: isRight ? "LEFT" : "RIGHT" });
    }

    const next: Uint8Array[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level.at(cursor);
      const right = level.at(cursor + 1);
      /* c8 ignore next 3 */
      if (left === undefined) {
        throw new Error("Nodo ausente construyendo la prueba de Merkle.");
      }
      next.push(right === undefined ? left : merkleNodeHash(left, right));
    }
    level = next;
    position = Math.floor(position / 2);
  }

  return steps;
}

/** Verifica una prueba. Es lo que ejecutaria el administrador externo. */
export function verifyMerkleProof(input: {
  readonly leaf: Uint8Array;
  readonly proof: readonly MerkleProofStep[];
  readonly root: Uint8Array;
}): boolean {
  let current = input.leaf;
  for (const step of input.proof) {
    const sibling = new Uint8Array(Buffer.from(step.sibling, "hex"));
    current =
      step.position === "LEFT"
        ? merkleNodeHash(sibling, current)
        : merkleNodeHash(current, sibling);
  }
  return hashesEqual(current, input.root);
}
