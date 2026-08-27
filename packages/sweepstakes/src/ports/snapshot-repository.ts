/**
 * Puerto de `EntryCalculationSnapshot`.
 *
 * El snapshot es lo que permite que un tercero -o nosotros dentro de dos
 * anos- reconstruya un calculo sin volver a ejecutarlo: guarda las entradas
 * normalizadas, la traza, el resultado, la version de reglas y la version de
 * motor. Sin el, un reversal parcial no tendria contra que prorratear.
 *
 * La tabla es append-only igual que el ledger, asi que este puerto tampoco
 * expone `update`.
 */

import type { JsonObject } from "../json.js";
import type { EntrySourceType } from "../enums.js";

export interface CalculationSnapshotRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly participantId: string | null;
  readonly rulesVersionId: string;
  readonly engineVersion: number;
  readonly sourceType: EntrySourceType;
  readonly sourceRef: string;
  /** Entradas normalizadas. DEC-010: importes como cadena de digitos. */
  readonly input: JsonObject;
  /** Traza legible por maquina, tal cual la produce el motor. */
  readonly trace: JsonObject;
  readonly resultQuantity: number;
  readonly evaluatedAt: Date;
  readonly recordedAt: Date;
}

export type CalculationSnapshotInput = CalculationSnapshotRecord;

export interface CalculationSnapshotRepository {
  /**
   * Guarda el snapshot. Si ya existe uno para
   * `(promotionId, sourceType, sourceRef, engineVersion)` devuelve el
   * existente en vez de duplicarlo: recalcular la misma fuente con el mismo
   * motor debe dar el mismo resultado, y guardarlo dos veces solo crearia dos
   * versiones de la misma verdad.
   */
  save(input: CalculationSnapshotInput): Promise<CalculationSnapshotRecord>;

  findById(id: string): Promise<CalculationSnapshotRecord | null>;

  findBySource(
    promotionId: string,
    sourceType: EntrySourceType,
    sourceRef: string,
    engineVersion: number,
  ): Promise<CalculationSnapshotRecord | null>;
}
