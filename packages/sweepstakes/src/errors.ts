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
  /**
   * El participante ya esta en el tope por persona (DEC-052 punto 5).
   *
   * NO rechaza el envio: lo deja en `PENDING_REVIEW` para que decida una
   * persona. Rechazarlo automaticamente cerraria la via gratuita a quien quiza
   * recupere espacio manana -un reembolso revierte participaciones- y las
   * Official Rules no dicen que una ficha valida se anule por llegar llena la
   * cuenta.
   */
  "AMOE_ENTRY_CAP_REACHED",
  /**
   * La modalidad configurada no admite el formulario en linea.
   *
   * Con `MAIL_IN_REVIEW` o `EXTERNAL_INSTRUCTIONS`, la via gratuita que
   * describen las Official Rules NO es un formulario: es un sobre o un destino
   * externo. Dejar abierta la ruta de envio propio crearia participaciones por
   * un metodo que las Reglas vigentes no ofrecen, y despues habria que decidir
   * que hacer con ellas. La interfaz ya no pinta el formulario; esto lo
   * garantiza tambien cuando nadie mira la interfaz.
   */
  "AMOE_MODE_NOT_ONLINE",
  /**
   * Transcribir una ficha solo tiene sentido con `MAIL_IN_REVIEW`.
   *
   * En las otras tres modalidades no hay papel que teclear, y admitirlo
   * convertiria la transcripcion en una via por la que un administrador crea
   * participaciones a nombre de terceros sin que exista el envio fisico que
   * las justifica.
   */
  "AMOE_MODE_NOT_MAIL_IN",
  /**
   * Quien transcribio una ficha postal no puede aprobarla (DEC-054 punto 4).
   *
   * Es una propiedad de los DATOS y no de la ruta -depende de quien escribio
   * `metadata.transcribed_by_admin_user_id`-, asi que se comprueba aqui y no en
   * el autorizador de transporte. Con la transcripcion, una sola persona
   * pasaria de teclear una ficha inventada a concederse participaciones sin que
   * nadie mas la viera.
   */
  "SEPARATION_OF_DUTIES",

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
