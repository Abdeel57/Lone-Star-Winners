/**
 * Seleccion uniforme sobre el universo de entries (DEC-017, cerrojo 5).
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO BASTA CON "USAR UN CSPRNG"
 * ---------------------------------------------------------------------------
 *
 * Un CSPRNG produce BYTES uniformes. Lo que hace falta es un entero uniforme en
 * `[1, N]`, y el paso de una cosa a la otra es donde se pierde la uniformidad
 * en la practica. La forma comoda -`bytes % N`- es sesgada siempre que `N` no
 * sea una potencia de dos, y el sesgo favorece a los primeros ordinales.
 *
 * Con un byte y `N = 5`: los valores 0..255 se reparten en 52, 51, 51, 51, 51.
 * El primer participante del universo tiene un 20.3% en vez de un 20%. Nadie lo
 * nota mirando un sorteo, y sigue ahi si alguien lo audita con cuidado.
 *
 * La solucion es el RECHAZO DE MUESTREO: se toman los bits justos, se descarta
 * lo que cae fuera del rango y se vuelve a tirar. El resultado es exactamente
 * uniforme, y el precio es un numero variable -y pequeno- de intentos.
 *
 * ---------------------------------------------------------------------------
 * DOS FORMAS DE FALLAR QUE AQUI SON ERRORES, NO AVISOS
 * ---------------------------------------------------------------------------
 *
 *  1. LA FUENTE INCUMPLE SU CONTRATO. Si devuelve menos bytes de los pedidos
 *     -o mas-, no se rellena con ceros ni se recorta: se lanza. Rellenar con
 *     ceros convertiria una fuente rota en un sorteo con resultados
 *     predecibles y sin ninguna senal de que algo iba mal.
 *
 *  2. DEMASIADOS RECHAZOS. Con la mascara correcta, cada intento acierta con
 *     probabilidad mayor que 1/2, asi que 512 fallos seguidos tienen
 *     probabilidad menor que 2^-512: no ocurre, salvo que la fuente este
 *     averiada o sea adversaria. En ese caso se lanza. Lo que NUNCA se hace es
 *     "rendirse y usar el modulo", que es exactamente el atajo que reintroduce
 *     el sesgo justo cuando hay motivos para sospechar de la fuente.
 */

import type { EntryBatchRange } from "./ports.js";

/** Fuente de bytes. Devuelve EXACTAMENTE `length` bytes o el dominio se niega. */
export type ByteSource = (length: number) => Uint8Array;

/** Identificador versionado del algoritmo. Viaja en el registro del sorteo. */
export const UNIFORM_SELECTION_ALGORITHM = "LSW/DRAW/UNIFORM-RANGE/v1";

/**
 * Tope de intentos. No es un parametro de rendimiento: es la frontera entre
 * "la fuente tuvo mala suerte" y "la fuente esta rota".
 */
export const MAX_REJECTION_ATTEMPTS = 512;

export class RandomnessContractError extends Error {
  public readonly code = "csprng.contract_violated";

  public constructor(detail: string) {
    super(
      `La fuente de aleatoriedad incumple su contrato: ${detail}. No se sortea con una fuente ` +
        "que no se comporta como dice.",
    );
    this.name = "RandomnessContractError";
  }
}

export class RandomnessExhaustedError extends Error {
  public readonly code = "csprng.rejection_exhausted";

  public constructor(attempts: number) {
    super(
      `El rechazo de muestreo agoto ${String(attempts)} intentos. Con la mascara correcta cada ` +
        "intento acierta con probabilidad mayor que 1/2, asi que esto no es mala suerte: la " +
        "fuente esta averiada o es adversaria. No se degrada a modulo.",
    );
    this.name = "RandomnessExhaustedError";
  }
}

export interface UniformSelection {
  /** Valor en `[0, bound)`. */
  readonly value: number;
  /** Intentos consumidos, incluido el que acerto. Evidencia reproducible. */
  readonly attempts: number;
  /** Bytes pedidos a la fuente en cada intento. */
  readonly bytesPerAttempt: number;
}

function bitLength(value: bigint): number {
  let bits = 0;
  let remaining = value;
  while (remaining > 0n) {
    remaining >>= 1n;
    bits += 1;
  }
  return bits;
}

function toBigInt(bytes: Uint8Array): bigint {
  let accumulator = 0n;
  for (const byte of bytes) {
    accumulator = (accumulator << 8n) | BigInt(byte);
  }
  return accumulator;
}

/**
 * Entero uniforme en `[0, bound)` con rechazo de muestreo.
 *
 * `bound === 1` devuelve 0 sin consumir entropia. Es deliberado: con un solo
 * candidato el resultado no es aleatorio, esta determinado, y gastar bytes del
 * CSPRNG sugeriria lo contrario a quien lea el registro.
 */
export function uniformBelow(
  bound: number,
  source: ByteSource,
  maxAttempts: number = MAX_REJECTION_ATTEMPTS,
): UniformSelection {
  if (!Number.isSafeInteger(bound) || bound < 1) {
    throw new RandomnessContractError(
      `el rango pedido no es un entero seguro positivo (${String(bound)})`,
    );
  }
  if (bound === 1) {
    return { value: 0, attempts: 0, bytesPerAttempt: 0 };
  }

  const bits = bitLength(BigInt(bound - 1));
  const bytesPerAttempt = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  const limit = BigInt(bound);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const bytes = source(bytesPerAttempt);
    if (bytes.length !== bytesPerAttempt) {
      throw new RandomnessContractError(
        `se pidieron ${String(bytesPerAttempt)} bytes y devolvio ${String(bytes.length)}`,
      );
    }
    const candidate = toBigInt(bytes) & mask;
    if (candidate < limit) {
      return { value: Number(candidate), attempts: attempt, bytesPerAttempt };
    }
  }

  throw new RandomnessExhaustedError(maxAttempts);
}

/**
 * Ordinal uniforme en `[1, totalEligibleEntries]`.
 *
 * 1-based porque es lo que se ensena a un tercero: "la entry numero 4.812 de
 * 12.907". Un cero seria un ordinal que no existe en ningun documento.
 */
export function selectOrdinal(
  totalEligibleEntries: number,
  source: ByteSource,
  maxAttempts: number = MAX_REJECTION_ATTEMPTS,
): UniformSelection {
  const selection = uniformBelow(totalEligibleEntries, source, maxAttempts);
  return { ...selection, value: selection.value + 1 };
}

// ---------------------------------------------------------------------------
// El universo, y sus formas de estar mal
// ---------------------------------------------------------------------------

export const ENTRY_RANGE_ERROR_CODES = Object.freeze({
  EMPTY_UNIVERSE: "entry_ranges.empty_universe",
  NOT_INTEGER: "entry_ranges.not_integer",
  INVERTED: "entry_ranges.inverted",
  DOES_NOT_START_AT_ONE: "entry_ranges.does_not_start_at_one",
  OVERLAP: "entry_ranges.overlap",
  GAP: "entry_ranges.gap",
  TOTAL_MISMATCH: "entry_ranges.total_mismatch",
  DUPLICATE_BATCH_ID: "entry_ranges.duplicate_batch_id",
} as const);

export type EntryRangeErrorCode =
  (typeof ENTRY_RANGE_ERROR_CODES)[keyof typeof ENTRY_RANGE_ERROR_CODES];

export class EntryRangeError extends Error {
  public readonly code: EntryRangeErrorCode;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    code: EntryRangeErrorCode,
    detail: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail);
    this.name = "EntryRangeError";
    this.code = code;
    this.context = context;
  }
}

/**
 * Universo validado y ordenado.
 *
 * Se construye ANTES de tocar el CSPRNG. El orden importa: si se sorteara
 * primero y se validara despues, un universo incoherente producira un ordinal
 * que no se puede mapear, y para entonces ya se habra consumido entropia y
 * habra que decidir si se vuelve a tirar. Volver a tirar tras ver un resultado
 * es, literalmente, la definicion de un sorteo amanado.
 */
export interface EntryRangeIndex {
  readonly totalEligibleEntries: number;
  readonly ranges: readonly EntryBatchRange[];
}

export function buildEntryRangeIndex(
  ranges: readonly EntryBatchRange[],
  expectedTotal: number,
): EntryRangeIndex {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0) {
    throw new EntryRangeError(
      ENTRY_RANGE_ERROR_CODES.NOT_INTEGER,
      `El total declarado no es un entero seguro no negativo: ${String(expectedTotal)}.`,
      { expected_total: expectedTotal },
    );
  }
  if (ranges.length === 0 || expectedTotal === 0) {
    throw new EntryRangeError(
      ENTRY_RANGE_ERROR_CODES.EMPTY_UNIVERSE,
      "El universo elegible esta vacio. No hay nada que sortear, y un sorteo sobre cero " +
        "entries no es un sorteo fallido: es un error de quien lo pidio.",
      { range_count: ranges.length, expected_total: expectedTotal },
    );
  }

  const sorted = [...ranges].sort((left, right) => left.firstOrdinal - right.firstOrdinal);
  const seenBatchIds = new Set<string>();

  for (const range of sorted) {
    if (!Number.isSafeInteger(range.firstOrdinal) || !Number.isSafeInteger(range.lastOrdinal)) {
      throw new EntryRangeError(
        ENTRY_RANGE_ERROR_CODES.NOT_INTEGER,
        `El lote ${range.batchId} tiene extremos no enteros (DEC-010: nunca coma flotante).`,
        { batch_id: range.batchId },
      );
    }
    if (range.firstOrdinal < 1 || range.lastOrdinal < range.firstOrdinal) {
      throw new EntryRangeError(
        ENTRY_RANGE_ERROR_CODES.INVERTED,
        `El lote ${range.batchId} declara un tramo invalido ` +
          `[${String(range.firstOrdinal)}, ${String(range.lastOrdinal)}].`,
        { batch_id: range.batchId },
      );
    }
    if (seenBatchIds.has(range.batchId)) {
      throw new EntryRangeError(
        ENTRY_RANGE_ERROR_CODES.DUPLICATE_BATCH_ID,
        `El lote ${range.batchId} aparece dos veces en el universo.`,
        { batch_id: range.batchId },
      );
    }
    seenBatchIds.add(range.batchId);
  }

  const first = sorted.at(0);
  /* c8 ignore next 3 -- la lista no esta vacia: se comprobo arriba */
  if (first === undefined) {
    throw new EntryRangeError(ENTRY_RANGE_ERROR_CODES.EMPTY_UNIVERSE, "Universo vacio.");
  }
  if (first.firstOrdinal !== 1) {
    throw new EntryRangeError(
      ENTRY_RANGE_ERROR_CODES.DOES_NOT_START_AT_ONE,
      `El universo empieza en ${String(first.firstOrdinal)} y no en 1. Los ordinales que faltan ` +
        "por delante no pertenecen a nadie y aun asi son elegibles.",
      { first_ordinal: first.firstOrdinal },
    );
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted.at(index - 1);
    const current = sorted.at(index);
    /* c8 ignore next 3 -- `index` recorre el propio array */
    if (previous === undefined || current === undefined) {
      throw new EntryRangeError(ENTRY_RANGE_ERROR_CODES.GAP, "Tramo ausente al recorrer.");
    }
    if (current.firstOrdinal <= previous.lastOrdinal) {
      throw new EntryRangeError(
        ENTRY_RANGE_ERROR_CODES.OVERLAP,
        `Los lotes ${previous.batchId} y ${current.batchId} se solapan: el ordinal ` +
          `${String(current.firstOrdinal)} pertenece a los dos.`,
        { previous_batch_id: previous.batchId, batch_id: current.batchId },
      );
    }
    if (current.firstOrdinal !== previous.lastOrdinal + 1) {
      throw new EntryRangeError(
        ENTRY_RANGE_ERROR_CODES.GAP,
        `Hueco entre ${previous.batchId} y ${current.batchId}: los ordinales ` +
          `${String(previous.lastOrdinal + 1)}..${String(current.firstOrdinal - 1)} son ` +
          "elegibles y no pertenecen a nadie.",
        { previous_batch_id: previous.batchId, batch_id: current.batchId },
      );
    }
  }

  const last = sorted.at(-1);
  /* c8 ignore next 3 -- la lista no esta vacia */
  if (last === undefined) {
    throw new EntryRangeError(ENTRY_RANGE_ERROR_CODES.EMPTY_UNIVERSE, "Universo vacio.");
  }
  if (last.lastOrdinal !== expectedTotal) {
    throw new EntryRangeError(
      ENTRY_RANGE_ERROR_CODES.TOTAL_MISMATCH,
      `Los tramos cubren ${String(last.lastOrdinal)} entries y el snapshot declara ` +
        `${String(expectedTotal)}. Uno de los dos numeros esta mal, y sortear sin saber cual ` +
        "seria sortear sobre un universo que nadie ha verificado.",
      { covered: last.lastOrdinal, expected_total: expectedTotal },
    );
  }

  return { totalEligibleEntries: expectedTotal, ranges: sorted };
}

/**
 * Tramo al que pertenece un ordinal. Busqueda binaria: el universo puede tener
 * cientos de miles de lotes y esto se ejecuta bajo la mirada de un auditor.
 */
export function locateOrdinal(index: EntryRangeIndex, ordinal: number): EntryBatchRange {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > index.totalEligibleEntries) {
    throw new EntryRangeError(
      ENTRY_RANGE_ERROR_CODES.TOTAL_MISMATCH,
      `El ordinal ${String(ordinal)} cae fuera de [1, ${String(index.totalEligibleEntries)}].`,
      { ordinal },
    );
  }

  let low = 0;
  let high = index.ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = index.ranges.at(middle);
    /* c8 ignore next 3 -- `middle` esta acotado por la propia longitud */
    if (range === undefined) {
      break;
    }
    if (ordinal < range.firstOrdinal) {
      high = middle - 1;
      continue;
    }
    if (ordinal > range.lastOrdinal) {
      low = middle + 1;
      continue;
    }
    return range;
  }

  /* c8 ignore next 4 -- inalcanzable con un indice validado: los tramos cubren
     [1, total] sin huecos, y el ordinal ya se comprobo dentro de ese intervalo */
  throw new EntryRangeError(
    ENTRY_RANGE_ERROR_CODES.GAP,
    `Ningun lote contiene el ordinal ${String(ordinal)} pese a estar en rango.`,
    { ordinal },
  );
}
