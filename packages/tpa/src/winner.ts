/**
 * Entidades del sorteo interno (DEC-017).
 *
 * ESTADO: el modulo existe y funciona; el sorteo SIGUE DESACTIVADO. Que estos
 * tipos y el servicio de `draw.ts` existan no autoriza nada, igual que tener la
 * cerradura instalada no es tener permiso para abrir la puerta.
 *
 * Los cinco cerrojos de DEC-017, todos necesarios y todos comprobados en
 * negativo en `tests/security`:
 *   1. flag `internal_draw_enabled` persistido en base de datos, `false` por
 *      defecto, leido por puerto y nunca por variable de entorno;
 *   2. `DrawAuthorization` viva, con referencia al documento de aprobacion;
 *   3. separacion de funciones: quien finaliza el snapshot no sortea, y el
 *      inicio exige segunda aprobacion de otro actor dentro de un TTL, mas
 *      step-up reciente;
 *   4. entrada inmutable: snapshot `FINALIZED` con el digest RECALCULADO en el
 *      momento y comparado con el manifiesto;
 *   5. CSPRNG con rechazo de muestreo.
 *
 * El resultado es un `PotentialWinner` (ver `potential-winner.ts`), nunca un
 * ganador confirmado, y nunca una publicacion automatica.
 */

/**
 * Alcance de una autorizacion.
 *
 * Existe porque "autorizado a sortear" sin mas es demasiado: una aprobacion
 * firmada para el sorteo principal de una promocion no deberia amparar tres
 * sorteos mas en otra el mes que viene. El alcance convierte el documento
 * firmado en algo que el codigo puede comprobar.
 *
 * Ninguno de estos campos codifica una regla legal: los valores concretos
 * -cuantos sorteos, para que- salen del documento aprobado y llegan como dato.
 */
export interface DrawAuthorizationScope {
  readonly promotionId: string;
  /** `null` = cualquier snapshot FINALIZED de la promocion. */
  readonly snapshotId: string | null;
  /** Cuantos sorteos ampara. Un alternate consume uno mas. */
  readonly maxDraws: number;
  /** Para que se autorizo, tal y como lo dice el documento. Texto, no enum. */
  readonly purpose: string;
}

/**
 * Autorizacion documental. Sin una viva, el servicio se niega aunque el flag
 * este encendido, y esa es exactamente la diferencia entre DEC-017 y "tener un
 * feature flag": un flag se cambia sin dejar constancia de que alguien lo
 * aprobo; esto no.
 */
export interface DrawAuthorization {
  readonly id: string;
  readonly promotionId: string;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  /**
   * Referencia al documento de aprobacion del cliente y su abogado. Es el campo
   * que hace que esta entidad valga algo: sin el, seria un booleano con mas
   * pasos.
   */
  readonly authorizationReference: string;
  readonly scope: DrawAuthorizationScope;
  readonly validFrom: string;
  readonly validUntil: string;
  /** Motivo escrito por quien autorizo. Se conserva; no se traduce. */
  readonly reasonText: string;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}

/**
 * Segunda aprobacion de un sorteo concreto (cerrojo 3).
 *
 * Va atada a `drawRequestId`, no a la promocion: una aprobacion generica seria
 * una firma en blanco. El TTL lo evalua el dominio contra el reloj inyectado,
 * porque una aprobacion de hace tres semanas no es una aprobacion de hoy.
 */
export interface DrawApproval {
  readonly id: string;
  readonly promotionId: string;
  readonly drawRequestId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly reasonText: string;
  readonly revokedAt: string | null;
}

/**
 * De donde salieron los bytes.
 *
 * `CSPRNG` es el camino por defecto. `COMMIT_REVEAL` solo aparece si el cliente
 * aprueba el esquema (ver `commit-reveal.ts`), y entonces el registro lleva
 * ademas el compromiso publicado antes del sorteo.
 */
export type DrawEntropySource = "CSPRNG" | "COMMIT_REVEAL";

/**
 * Un `DrawingEvent` solo se escribe cuando el sorteo se completo.
 *
 * No hay estado `FAILED` ni `VOIDED`: una negativa es un `AuditEvent`
 * `draw.rejected`, no un sorteo a medias, y anular un sorteo ya hecho seria un
 * registro NUEVO que referencia a este. Cambiar el estado del registro
 * existente exigiria un UPDATE sobre una tabla que no lo admite, y ademas
 * borraria la unica prueba de que aquel sorteo ocurrio.
 */
export type DrawingEventStatus = "COMPLETED";

/** Registro inmutable y encadenado de un sorteo ejecutado. */
export interface DrawingEvent {
  readonly id: string;
  readonly promotionId: string;
  /** Distingue dos sorteos del mismo snapshot. Ata tambien la segunda aprobacion. */
  readonly drawRequestId: string;
  readonly snapshotId: string;
  /**
   * Digest RECALCULADO en el momento del sorteo, no el que estaba guardado.
   * Ver `SnapshotRepository.recomputeContentDigest` en `ports.ts`.
   */
  readonly snapshotContentDigest: string;
  readonly authorizationId: string;
  readonly algorithmVersion: string;
  readonly entropySource: DrawEntropySource;
  /** `SHA256(server_seed)` publicado ANTES; `null` si no hubo commit-reveal. */
  readonly commitment: string | null;
  readonly initiatedBy: string;
  readonly initiatedAt: string;
  readonly approvedBy: string;
  readonly totalEligibleEntries: number;
  /** Entero en `[1, totalEligibleEntries]`. */
  readonly selectedOrdinal: number;
  readonly selectedBatchId: string;
  readonly selectedFirstOrdinal: number;
  readonly selectedLastOrdinal: number;
  readonly selectedParticipantReference: string;
  /** Origen del lote que salio: compra, AMOE, ajuste. Procedencia, no criterio. */
  readonly selectedProvenance: string;
  readonly completedAt: string;
  readonly recordedAt: string;
  readonly status: DrawingEventStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** DEC-008 sobre el dominio `drawing_events`. */
  readonly recordHash: string;
  readonly previousRecordHash: string | null;
  readonly canonicalizationVersion: number;
}

/**
 * Proyeccion canonica del registro: EXACTAMENTE los campos que declara
 * `DRAWING_EVENT_CANONICAL_FIELDS_V1` en `@lsw/audit`, con sus nombres de
 * columna.
 *
 * Se escribe a mano, campo a campo, y no con un conversor automatico de
 * camelCase a snake_case. Un conversor automatico haria que anadir una
 * propiedad al tipo cambiara en silencio lo que cubre el hash; asi, anadir una
 * propiedad no hace nada hasta que alguien decide, a proposito, que entre.
 *
 * `recordHash` y `previousRecordHash` no estan: son la cadena, no el hecho.
 */
export function drawingEventCanonicalPayload(
  event: Omit<DrawingEvent, "recordHash" | "previousRecordHash" | "canonicalizationVersion">,
): Readonly<Record<string, unknown>> {
  return {
    algorithm_version: event.algorithmVersion,
    approved_by: event.approvedBy,
    authorization_id: event.authorizationId,
    commitment: event.commitment,
    completed_at: event.completedAt,
    draw_request_id: event.drawRequestId,
    entropy_source: event.entropySource,
    id: event.id,
    initiated_at: event.initiatedAt,
    initiated_by: event.initiatedBy,
    metadata: event.metadata,
    promotion_id: event.promotionId,
    recorded_at: event.recordedAt,
    selected_batch_id: event.selectedBatchId,
    selected_first_ordinal: event.selectedFirstOrdinal,
    selected_last_ordinal: event.selectedLastOrdinal,
    selected_ordinal: event.selectedOrdinal,
    selected_participant_reference: event.selectedParticipantReference,
    selected_provenance: event.selectedProvenance,
    snapshot_content_digest: event.snapshotContentDigest,
    snapshot_id: event.snapshotId,
    status: event.status,
    total_eligible_entries: event.totalEligibleEntries,
  };
}

/** Cabeza de la cadena de sorteos de una promocion. */
export interface DrawingEventChainHead {
  readonly recordHash: string;
  readonly drawingEventId: string;
}

/**
 * Almacen de registros de sorteo.
 *
 * `append` y nada mas: no hay `update` ni `delete` en el puerto, para que el
 * dominio no pueda pedirlos ni por descuido. La tabla lo impedira ademas por
 * permisos y triggers, igual que el ledger (DEC-007), pero un puerto que no
 * ofrece la operacion es la primera barrera y la mas barata.
 */
export interface DrawingEventRepository {
  head(promotionId: string): Promise<DrawingEventChainHead | null>;
  /** Idempotencia: dos peticiones con el mismo `drawRequestId` no sortean dos veces. */
  findByRequestId(promotionId: string, drawRequestId: string): Promise<DrawingEvent | null>;
  countForAuthorization(authorizationId: string): Promise<number>;
  append(event: DrawingEvent): Promise<void>;
}

/** Lectura de autorizaciones y aprobaciones. Solo lectura: crearlas es otro flujo. */
export interface AuthorizationRepository {
  findDrawAuthorization(
    promotionId: string,
    authorizationId: string,
  ): Promise<DrawAuthorization | null>;
  findDrawApproval(promotionId: string, drawRequestId: string): Promise<DrawApproval | null>;
}
