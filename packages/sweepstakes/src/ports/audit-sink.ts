/**
 * Punto de emision de auditoria.
 *
 * `packages/audit` es el propietario del formato, de la hash chain y del
 * sellado externo (DEC-008, DEC-035). Este puerto es solo el AGUJERO por el
 * que el dominio entrega hechos; deliberadamente no construye ni hashea nada.
 *
 * POR QUE EL DOMINIO NO DEPENDE DE `@lsw/audit`
 *
 *   Porque entonces la unica forma de ejercitar un servicio en un test seria
 *   arrastrar la canonicalizacion entera, y porque la direccion correcta de la
 *   dependencia es la contraria: la auditoria observa al dominio, no al reves.
 *
 * `action` usa el catalogo estable de `packages/audit/src/actions.ts`. No se
 * repite aqui para no tener dos listas que puedan divergir: el adaptador valida
 * la clave contra el catalogo real.
 */

import type { JsonObject } from "../json.js";
import type { DomainActor } from "./actor.js";

export interface DomainAuditEvent {
  readonly action: string;
  readonly actor: DomainActor;
  readonly promotionId: string | null;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  /** DEC-022: clave estable, nunca prosa traducida. */
  readonly reasonKey: string | null;
  readonly reasonDetail: string | null;
  /** DEC-011: cuando ocurrio el hecho. El `recorded_at` lo pone el adaptador. */
  readonly occurredAt: Date;
  readonly metadata: JsonObject;
}

export interface AuditSink {
  emit(event: DomainAuditEvent): Promise<void>;
}

/**
 * Sumidero que descarta.
 *
 * Existe para tests que no examinan la auditoria. NO debe usarse en produccion,
 * y el nombre lo dice: un sumidero que descarta silenciosamente hechos
 * auditables en un sistema regulado es un incidente, no un detalle de
 * configuracion.
 */
export class DiscardingAuditSink implements AuditSink {
  public emit(_event: DomainAuditEvent): Promise<void> {
    return Promise.resolve();
  }
}

/** Sumidero que acumula en memoria, para poder afirmar sobre lo emitido. */
export class RecordingAuditSink implements AuditSink {
  public readonly events: DomainAuditEvent[] = [];

  public emit(event: DomainAuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  public byAction(action: string): readonly DomainAuditEvent[] {
    return this.events.filter((event) => event.action === action);
  }
}
