/**
 * Errores del dominio de participaciones.
 *
 * DEC-022 y DEC-031: el backend emite CODIGOS ESTABLES; el copy en ingles y en
 * espanol lo resuelve el frontend a partir del codigo. Aqui no viaja prosa
 * traducible, y no hay un segundo campo `messageKey`: `code` ES la clave.
 *
 * El `message` de `Error` es texto interno para logs y trazas. No se envia al
 * participante y no se traduce.
 */

import type { JsonObject } from "./json.js";

/**
 * Catalogo de codigos.
 *
 * Cerrado a proposito: un codigo nuevo es un cambio de contrato que el
 * frontend tiene que poder traducir, asi que aparecer en esta lista obliga a
 * anadirlo tambien al diccionario de copy. Un `string` libre haria que el
 * participante viera un codigo crudo el dia que alguien improvisara uno.
 */
export const SWEEPSTAKES_ERROR_CODES = [
  // --- promocion y reglas ---
  "PROMOTION_NOT_FOUND",
  "PROMOTION_NOT_ACCEPTING_ENTRIES",
  "PROMOTION_WINDOW_CLOSED",
  "RULES_VERSION_MISMATCH",
  "ENTRY_EXPIRATION_CONFIG_MISSING",

  // --- award ---
  "PARTICIPANT_NOT_FOUND",
  "ORDER_ALREADY_AWARDED",
  "AWARD_HOLD_NOT_FOUND",
  "AWARD_HOLD_ALREADY_RELEASED",

  // --- reversals ---
  "ORIGIN_TRANSACTION_NOT_FOUND",
  "REVERSAL_AMOUNT_INVALID",
  "REVERSAL_ALREADY_APPLIED",
  "NOTHING_LEFT_TO_REVERSE",
  "CALCULATION_SNAPSHOT_NOT_FOUND",

  // --- AMOE ---
  "AMOE_NOT_ENABLED",
  "AMOE_MODE_NOT_CONFIGURED",
  "AMOE_CONFIG_INVALID",
  "AMOE_WINDOW_CLOSED",
  "AMOE_SUBMISSION_NOT_FOUND",
  "AMOE_SUBMISSION_NOT_REVIEWABLE",
  "AMOE_DUPLICATE_SUBMISSION",
  "AMOE_PERIOD_LIMIT_REACHED",
  "AMOE_PAYLOAD_INVALID",

  // --- ajustes y descalificacion ---
  "MANUAL_ADJUSTMENTS_NOT_ENABLED",
  "ADJUSTMENT_NOT_FOUND",
  "ADJUSTMENT_NOT_PENDING",
  "ADJUSTMENT_SELF_APPROVAL_FORBIDDEN",
  "ADJUSTMENT_WOULD_MAKE_BALANCE_NEGATIVE",
  "REASON_KEY_REQUIRED",
  "CAPABILITY_REQUIRED",
  "PARTICIPANT_ALREADY_DISQUALIFIED",
  "NO_ENTRIES_TO_DISQUALIFY",
] as const;

export type SweepstakesErrorCode = (typeof SWEEPSTAKES_ERROR_CODES)[number];

export class SweepstakesError extends Error {
  public readonly code: SweepstakesErrorCode;
  public readonly details: JsonObject;

  public constructor(code: SweepstakesErrorCode, details: JsonObject = {}, internal?: string) {
    super(internal ?? code);
    this.name = "SweepstakesError";
    this.code = code;
    this.details = details;
  }
}

export function isSweepstakesError(
  error: unknown,
  code?: SweepstakesErrorCode,
): error is SweepstakesError {
  if (!(error instanceof SweepstakesError)) {
    return false;
  }
  return code === undefined || error.code === code;
}
