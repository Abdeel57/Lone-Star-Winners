/**
 * Motivos de las acciones sensibles del panel.
 *
 * POR QUE UN MOTIVO ES OBLIGATORIO
 * --------------------------------
 * Aprobar un envio AMOE, rechazarlo o proponer un ajuste manual son acciones
 * que cambian -o pueden cambiar- el universo de participaciones de una
 * promocion. Seis meses despues, cuando alguien pregunte por que existe esa
 * participacion, la unica respuesta posible es la que quedo registrada en el
 * momento. Un motivo no es documentacion: para el ajuste manual, el propio
 * contrato dice que la base de datos rechaza el cambio sin el.
 *
 * POR QUE SON CLAVES Y NO PROSA
 * -----------------------------
 * Una clave estable es la misma en los dos idiomas, se puede agregar, se puede
 * filtrar en la auditoria y se traduce con DEC-022. Un campo de texto libre
 * como unico motivo produce una traza en la que "error", "err", "corregido" y
 * "se corrige por indicacion de M." son cuatro motivos distintos. La nota libre
 * existe ADEMAS, para el detalle que la clave no puede llevar.
 *
 * [PROVISIONAL] - PETICION ABIERTA A `backend`
 * --------------------------------------------
 * Estas listas deberian llegar del backend, no vivir aqui. El motivo es el
 * mismo que con las capacidades: el backend VALIDA que la clave recibida sea
 * una de las admitidas, asi que ya tiene la lista, y tenerla dos veces
 * garantiza que un dia difieran -y el sintoma seria un rechazo `VALIDATION_
 * FAILED` en una accion sensible, con el motivo ya escrito y el formulario
 * perdido.
 *
 * Lo que se pide: `GET /admin/reason-codes?action=<capacidad>` devolviendo
 * `{ items: [{ key, requires_note }] }`. Mientras no exista, estas son las
 * claves que el panel ofrece, y son OPERATIVAS, no legales: ninguna afirma nada
 * sobre elegibilidad, edad, jurisdiccion ni condiciones de participacion, que
 * es lo que el principio #2 prohibe inventar.
 */

/** Motivos de aprobacion de un envio AMOE. */
export const AMOE_APPROVE_REASONS = ["MEETS_REQUIREMENTS", "MANUAL_VERIFICATION_PASSED"] as const;

/** Motivos de rechazo de un envio AMOE. */
export const AMOE_REJECT_REASONS = [
  "INCOMPLETE_SUBMISSION",
  "DUPLICATE_SUBMISSION",
  "OUTSIDE_WINDOW",
  "PERIOD_LIMIT_REACHED",
  "FAILED_VERIFICATION",
] as const;

/** Motivos de un ajuste manual de participaciones. */
export const ADJUSTMENT_REASONS = [
  "SYSTEM_ERROR_CORRECTION",
  "PAYMENT_RECONCILIATION",
  "SUPPORT_RESOLUTION",
  "COMPLIANCE_DIRECTIVE",
  "OTHER",
] as const;

/** Motivos de la segunda aprobacion de un ajuste. */
export const ADJUSTMENT_APPROVAL_REASONS = [
  "REVIEWED_AND_CORRECT",
  "COMPLIANCE_DIRECTIVE",
] as const;

export type AmoeApproveReason = (typeof AMOE_APPROVE_REASONS)[number];
export type AmoeRejectReason = (typeof AMOE_REJECT_REASONS)[number];
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export type AdjustmentApprovalReason = (typeof ADJUSTMENT_APPROVAL_REASONS)[number];

/**
 * Claves que EXIGEN nota libre ademas de la clave.
 *
 * `OTHER` es la unica, y por definicion: una clave que significa "ninguna de
 * las anteriores" sin explicar cual es no registra nada. Sin esta regla, todo
 * el mundo elegiria `OTHER` y la traza volveria a ser texto libre.
 */
export const REASONS_REQUIRING_NOTE: readonly string[] = ["OTHER"];

export function reasonRequiresNote(reasonKey: string): boolean {
  return REASONS_REQUIRING_NOTE.includes(reasonKey);
}

/**
 * Motivos para ACTIVAR una promocion (seccion 12).
 *
 * Programar no lleva motivo -es reversible y no reparte participaciones-;
 * activar si, porque abre el universo. Son claves OPERATIVAS: ninguna afirma
 * nada sobre elegibilidad ni condiciones de participacion.
 */
export const PROMOTION_ACTIVATE_REASONS = ["PROMOTION_LAUNCH_APPROVED", "OTHER"] as const;

/** Motivos para CERRAR una promocion. */
export const PROMOTION_CLOSE_REASONS = [
  "ENTRY_PERIOD_ENDED",
  "EARLY_TERMINATION",
  "OTHER",
] as const;

/**
 * Motivos para ACTIVAR una version de reglas (§13.7, DEC-054).
 *
 * Activar una version es el gesto que cambia LO QUE VALE UNA COMPRA, y por eso
 * exige motivo y step-up igual que activar la promocion. Las claves son
 * OPERATIVAS -describen por que se publica esta version, no que dice- porque lo
 * que dice ya esta en el propio documento, con su referencia de aprobacion.
 */
export const RULES_ACTIVATE_REASONS = [
  "ATTORNEY_APPROVED_VERSION",
  "CORRECTION_OF_PUBLISHED_VERSION",
  "OTHER",
] as const;

/**
 * Motivos para crear un periodo bonus (§13.8).
 *
 * El atajo bonus ES una version de reglas nueva, asi que lleva su propio
 * motivo. Se separan de los de activacion porque responden a otra pregunta:
 * alli, por que se publica una version; aqui, por que se abre una bonificacion.
 */
export const BONUS_PERIOD_REASONS = [
  "PROMOTIONAL_CAMPAIGN",
  "COMPLIANCE_DIRECTIVE",
  "OTHER",
] as const;

/**
 * Motivos para cambiar un feature flag o la modalidad AMOE (§13.9).
 *
 * Los flags legalmente materiales cambian lo que la plataforma afirma o aplica
 * -si hay via gratuita, si los topes se imponen, si los multiplicadores
 * cuentan-, y su traza tiene que poder explicarse sola seis meses despues.
 */
export const FLAG_UPDATE_REASONS = [
  "COMPLIANCE_DIRECTIVE",
  "OPERATIONAL_ROLLOUT",
  "INCIDENT_MITIGATION",
  "OTHER",
] as const;
