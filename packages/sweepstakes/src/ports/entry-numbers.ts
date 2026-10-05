/**
 * Puerto de numeros de participacion ("mis numeros").
 *
 * ESTE MODULO NO ES UN ALGORITMO DE SORTEO, Y CONVIENE DEJARLO ESCRITO
 *
 *   La secuencia asigna bloques contiguos de forma monotona y perfectamente
 *   predecible. Usarla como fuente de la seleccion del ganador seria un sorteo
 *   con estructura conocida. El ganador lo elige el Administrador sobre el
 *   universo exportado (Reglas, seccion 7), y DEC-017 exige cinco cerrojos
 *   simultaneos para cualquier seleccion aleatoria interna. La misma
 *   advertencia esta escrita en `lsw_allocate_entry_range`.
 *
 * LA ASIGNACION OCURRE SIEMPRE; LO QUE VA DETRAS DEL FLAG ES MOSTRARLA (DEC-080)
 *
 *   Toda transaccion positiva -compra, correo, ajuste- recibe su bloque, con
 *   `visible_entry_numbers_enabled` encendido o apagado: el export al
 *   Administrador se construye sobre los bloques, y un numero que solo
 *   existiera con el flag encendido no se podria reconstruir hacia atras. La
 *   compra lo asigna aqui, de forma explicita; el resto lo garantiza el trigger
 *   diferido `entry_transactions_ensure_numbers` de la migracion 0037, que
 *   numera al confirmar cualquier fila positiva que llegue sin bloque.
 *
 *   El flag decide solo si el participante VE sus numeros.
 *
 * EL NUMERO QUE SE VE NO ES EL DE LA SECUENCIA
 *
 *   El rango interno es contiguo; el participante ve cada ordinal pasado por
 *   la permutacion con clave de `entry-number-cipher.ts`. Ver alli por que.
 *
 * LO QUE SIGUE VIVO DE LA DECISION ORIGINAL
 *
 *   El bloque es la IDENTIDAD HISTORICA de lo asignado; que siga vigente lo
 *   responde el ledger. Por eso `entry_batches` no tiene `active_quantity`:
 *   lo calcula `computeEntryNumberActivity` (DEC-080).
 */

import type { EntryNumberRange } from "../ledger.js";

export interface EntryBatchRecord {
  readonly id: string;
  readonly entryTransactionId: string;
  readonly promotionId: string;
  readonly participantId: string;
  readonly quantity: number;
  /** Semiabierto `[start, end)`. Ver `ledger.ts`. */
  readonly range: EntryNumberRange;
  readonly allocationStrategy: "SEQUENTIAL_PER_PROMOTION";
  readonly allocationVersion: number;
  readonly createdAt: Date;
}

/**
 * Valores con los que `lsw_allocate_entry_range` crea la secuencia de una
 * promocion que todavia no la tiene. Espejo de la migracion 0037.
 */
export const DEFAULT_ENTRY_NUMBER_PREFIX = "LSW";
export const DEFAULT_ENTRY_NUMBER_DIGITS = 8;

export interface EntryNumberFormat {
  readonly prefix: string;
  readonly digits: number;
  /** Clave de la permutacion, 32 bytes. No sale nunca de la API. */
  readonly key: Uint8Array;
  /** Esquema con el que se derivan los numeros visibles. */
  readonly scheme: string;
}

export interface EntryNumberPort {
  /**
   * Reserva un rango del pozo de la promocion, creando la secuencia si aun no
   * existe.
   *
   * El adaptador real lo hace con `lsw_allocate_entry_range`, que toma un lock
   * consultivo por promocion y avanza la secuencia dentro de la transaccion. Si
   * la transaccion revierte, el rango se libera con ella.
   */
  allocateRange(promotionId: string, quantity: number): Promise<EntryNumberRange>;

  saveBatch(record: EntryBatchRecord): Promise<EntryBatchRecord>;

  /** En orden de asignacion: por el primer numero del rango. */
  listBatchesForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryBatchRecord[]>;

  /** `null` mientras la promocion no haya numerado ninguna participacion. */
  getFormat(promotionId: string): Promise<EntryNumberFormat | null>;
}
