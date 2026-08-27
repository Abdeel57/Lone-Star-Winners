/**
 * Sumidero de auditoria, PROVISIONAL Y DECLARADO COMO TAL.
 *
 * ---------------------------------------------------------------------------
 * LO QUE FALTA, Y POR QUE NO SE FINGE
 * ---------------------------------------------------------------------------
 *
 * DEC-008 asigna el formato del `AuditEvent`, su hash chain y su sellado
 * externo a `packages/audit`, y la tabla `audit_events` todavia NO EXISTE en
 * ninguna migracion: la migracion que la cree es de `security-integration`,
 * junto con las columnas de cadena y el verificador.
 *
 * Mientras tanto hacen falta dos cosas a la vez que parecen incompatibles:
 *
 *   - los servicios de dominio EXIGEN un `AuditSink` en su constructor, porque
 *     emiten hechos auditables en cada operacion;
 *   - `DiscardingAuditSink` no puede usarse en produccion, y su propia
 *     documentacion lo dice: un sumidero que descarta en silencio hechos
 *     auditables en un sistema regulado es un incidente, no un detalle de
 *     configuracion.
 *
 * La salida es esta: los hechos se escriben en el log ESTRUCTURADO, con
 * `event: "audit.pending_persistence"` para que sean localizables de un
 * grep, y el sumidero se llama por lo que es. No es auditoria: es un registro
 * operativo que impide que el hecho se pierda antes de que exista la tabla.
 *
 * NO REEMPLAZA A `audit_events`, y no debe quedarse. Un log rota, no se
 * encadena, no se sella y no se puede verificar; las tres cosas que DEC-008
 * exige. Queda anotado como handoff a `security-integration`.
 */

import type { AuditSink, DomainAuditEvent } from "@lsw/sweepstakes";
import type { FastifyBaseLogger } from "fastify";

/**
 * Proyecta el actor a las tres columnas del futuro `audit_events`.
 *
 * Se escribe ya con la forma de destino para que migrar sea copiar campos, y
 * para que un hecho registrado hoy en el log se pueda reconciliar manana con
 * uno registrado en la tabla.
 */
function actorFields(event: DomainAuditEvent): Readonly<Record<string, unknown>> {
  switch (event.actor.type) {
    case "ADMIN":
      return { actor_type: "ADMIN", actor_admin_user_id: event.actor.adminUserId };
    case "PARTICIPANT":
      return { actor_type: "PARTICIPANT", actor_participant_id: event.actor.participantId };
    case "SYSTEM":
    default:
      return { actor_type: "SYSTEM" };
  }
}

export class LoggingAuditSink implements AuditSink {
  private readonly logger: FastifyBaseLogger;

  public constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  public emit(event: DomainAuditEvent): Promise<void> {
    this.logger.info(
      {
        // Clave fija y buscable: es lo que permite localizar todo lo que habra
        // que reconciliar el dia que exista `audit_events`.
        event: "audit.pending_persistence",
        action: event.action,
        promotion_id: event.promotionId,
        target_entity_type: event.targetEntityType,
        target_entity_id: event.targetEntityId,
        reason_key: event.reasonKey,
        // `reason_detail` es texto interno del operador. Puede contener datos
        // de una persona, asi que NO va al log: va a la tabla cuando exista.
        occurred_at: event.occurredAt.toISOString(),
        metadata: event.metadata,
        ...actorFields(event),
      },
      "hecho auditable pendiente de persistir",
    );
    return Promise.resolve();
  }
}
