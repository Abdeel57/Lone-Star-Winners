/**
 * Puerto de numeros visibles de entry ("mis numeros").
 *
 * ESTE MODULO NO ES UN ALGORITMO DE SORTEO, Y CONVIENE DEJARLO ESCRITO
 *
 *   La secuencia asigna bloques contiguos de forma monotona y perfectamente
 *   predecible. Usarla como fuente de la seleccion del ganador seria un sorteo
 *   con estructura conocida. DEC-017 exige cinco cerrojos simultaneos para
 *   cualquier seleccion aleatoria interna, y ninguno se cumple hoy. La misma
 *   advertencia esta escrita en `lsw_allocate_entry_range`.
 *
 * ESTA DETRAS DE UN FLAG
 *
 *   `visible_entry_numbers_enabled` arranca apagado (DEC-032). Con el apagado
 *   no se asigna ningun rango, y el saldo -que es lo que decide la
 *   elegibilidad- no depende de que existan numeros.
 *
 * LO QUE SIGUE SIN DECIDIRSE, Y NO SE DECIDE AQUI
 *
 *   Tras una devolucion parcial, QUE numeros concretos dejan de ser elegibles
 *   -los ultimos asignados, los primeros, un criterio de las Official Rules- es
 *   una eleccion legal, no tecnica. Por eso `entry_batches` no tiene
 *   `active_quantity` y por eso el bloque es la IDENTIDAD HISTORICA de lo
 *   asignado: que siga siendo elegible lo responde el ledger.
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

export interface EntryNumberFormat {
  readonly prefix: string;
  readonly digits: number;
}

export interface EntryNumberPort {
  /**
   * Reserva un rango del pozo de la promocion.
   *
   * El adaptador real lo hace con `lsw_allocate_entry_range`, que toma un lock
   * consultivo por promocion y avanza la secuencia dentro de la transaccion. Si
   * la transaccion revierte, el rango se libera con ella.
   */
  allocateRange(promotionId: string, quantity: number): Promise<EntryNumberRange>;

  saveBatch(record: EntryBatchRecord): Promise<EntryBatchRecord>;

  listBatchesForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryBatchRecord[]>;

  getFormat(promotionId: string): Promise<EntryNumberFormat | null>;
}
