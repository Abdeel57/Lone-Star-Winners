/**
 * Claves de capacidad que este dominio comprueba.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAY UNA COMPROBACION AQUI SI YA LA HACE LA RUTA
 * ---------------------------------------------------------------------------
 *
 * La autorizacion de transporte -que una peticion HTTP llegue con permiso- es
 * de `apps/api` y del catalogo de `packages/security`. Esta es la SEGUNDA
 * linea, y cubre lo que la primera no puede cubrir:
 *
 *   - Un job, una tarea de mantenimiento o un script de administracion no pasan
 *     por ninguna ruta, y aun asi no deberian poder aprobar un ajuste.
 *   - La separacion de funciones no es una propiedad de la ruta sino de los
 *     DATOS: que quien aprueba no sea quien pidio solo se puede comprobar aqui,
 *     donde se conoce el registro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SON LITERALES Y NO UN IMPORT
 * ---------------------------------------------------------------------------
 *
 * El catalogo canonico vive en `packages/security/src/capabilities.ts`.
 * `packages/sweepstakes` NO depende de `packages/security` y no debe: el
 * dominio de participaciones no puede arrastrar el modulo de identidad, MFA y
 * sesiones para poder ejecutarse en un test.
 *
 * La coherencia se garantiza con un test de paridad que lee el catalogo real y
 * exige que cada clave de aqui exista alli. Es la misma tecnica que se usa con
 * el predicado del saldo y con `BALANCE_PREDICATE_V1`.
 */

export const SWEEPSTAKES_CAPABILITIES = {
  amoeReviewRead: "amoe.review.read",
  amoeReviewApprove: "amoe.review.approve",
  amoeReviewReject: "amoe.review.reject",
  amoeSelfSubmit: "amoe.self.submit",
  entryAdjustCreate: "entry.adjust.create",
  entryAdjustApprove: "entry.adjust.approve",
  entryReversalCreate: "entry.reversal.create",
  participantDisqualify: "participant.disqualify",
  entryLedgerRead: "entry.ledger.read",
  entrySelfRead: "entry.self.read",
} as const;

export type SweepstakesCapability =
  (typeof SWEEPSTAKES_CAPABILITIES)[keyof typeof SWEEPSTAKES_CAPABILITIES];
