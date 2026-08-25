/**
 * Sorteo interno y ganador potencial: tipos.
 *
 * ESTADO: ANDAMIAJE. Aqui NO hay seleccion aleatoria, y no la habra hasta que
 * exista autorizacion explicita (DEC-017, principio #11 de CLAUDE.md).
 *
 * Los cinco cerrojos de DEC-017, todos necesarios:
 *   1. flag persistido en base de datos, `false` por defecto;
 *   2. `DrawAuthorization` viva, con referencia al documento de aprobacion;
 *   3. separacion de funciones: quien finaliza el snapshot no sortea;
 *   4. entrada inmutable: snapshot `FINALIZED` con hash recalculado al sortear;
 *   5. CSPRNG del sistema operativo con rechazo de muestreo.
 *
 * Que estos tipos existan no autoriza nada. Es la diferencia entre tener la
 * cerradura instalada y tener permiso para abrir la puerta.
 */

/** Autorizacion documental. Sin una viva, el endpoint responde 403. */
export interface DrawAuthorization {
  readonly id: string;
  readonly promotionId: string;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  /** Referencia al documento de aprobacion del cliente y su abogado. */
  readonly authorizationReference: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}

/** Registro inmutable de un sorteo ejecutado. */
export interface DrawingEvent {
  readonly id: string;
  readonly promotionId: string;
  readonly snapshotId: string;
  /** Hash recalculado en el momento del sorteo, no el guardado. */
  readonly snapshotHashAtDraw: string;
  readonly authorizationId: string;
  readonly algorithmVersion: string;
  readonly initiatedBy: string;
  readonly initiatedAt: string;
  readonly secondApproverId: string;
  readonly totalEligibleEntries: number;
  /** Evidencia del valor seleccionado. Entero en [1, totalEligibleEntries]. */
  readonly selectedOrdinal: number;
  readonly selectedEntryReference: string;
  readonly selectedParticipantReference: string;
  readonly completedAt: string;
  readonly auditEventId: string;
}

/**
 * Estados del ganador potencial.
 *
 * `SELECTED` no es `CONFIRMED`. Entre uno y otro hay verificacion de
 * elegibilidad, y los requisitos exactos los fija el abogado del cliente.
 * Una descalificacion no borra al seleccionado: se registra y se pasa a
 * alternate segun las Official Rules.
 */
export type PotentialWinnerStatus =
  | "SELECTED"
  | "CONTACT_PENDING"
  | "CONTACTED"
  | "DOCUMENTS_PENDING"
  | "ELIGIBILITY_REVIEW"
  | "VERIFIED"
  | "DISQUALIFIED"
  | "ALTERNATE_REQUIRED"
  | "CONFIRMED";

export interface PotentialWinner {
  readonly id: string;
  readonly promotionId: string;
  readonly drawingEventId: string | null;
  /** Origen: sorteo interno autorizado o resultado del administrador externo. */
  readonly source: "INTERNAL_DRAW" | "EXTERNAL_ADMINISTRATOR";
  readonly participantReference: string;
  readonly entryReference: string;
  readonly rank: number;
  readonly status: PotentialWinnerStatus;
  readonly replacesPotentialWinnerId: string | null;
  readonly statusChangedAt: string;
  readonly statusReasonCode: string | null;
}
