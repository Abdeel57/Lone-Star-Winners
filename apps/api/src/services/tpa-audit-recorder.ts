/**
 * `AuditRecorder` de `@lsw/tpa` sobre la tabla `audit_events`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE REUTILIZA `PersistentAuditSink`
 * ---------------------------------------------------------------------------
 *
 * Porque son dos puertos con dos formas distintas, y no por casualidad.
 *
 *   `AuditSink` (`@lsw/sweepstakes`) recibe un `DomainAuditEvent`: el hecho, y
 *   nada del transporte. El `requestId`, los roles efectivos y el agente de
 *   usuario los aporta `AsyncLocalStorage` desde la peticion HTTP.
 *
 *   `AuditRecorder` (`@lsw/tpa`) recibe un `AuditEventDraft` que YA lleva actor,
 *   roles y `requestId` dentro, porque el servicio de sorteo los recibe en su
 *   comando: quien inicia un sorteo y con que roles es un dato DEL HECHO, no del
 *   transporte, y tiene que quedar registrado aunque el sorteo se dispare desde
 *   un job y no desde una ruta.
 *
 * Adaptar uno al otro obligaria a inventar un contexto de peticion donde no lo
 * hay -o a perder los roles que el comando si traia-. Los dos escriben en la
 * MISMA tabla, por el MISMO repositorio y con la MISMA cadena; lo unico que
 * cambia es de donde sale cada columna.
 *
 * ---------------------------------------------------------------------------
 * TRES COLUMNAS QUE ESTE ADAPTADOR NO COPIA TAL CUAL
 * ---------------------------------------------------------------------------
 *
 * 1. `source_ip`. El borrador puede traer una direccion; la tabla exige un
 *    DIGEST y un CHECK lo impone. El digest tiene que ser CON CLAVE -un SHA-256
 *    a secas de una IPv4 se invierte por fuerza bruta- y esa clave todavia no
 *    existe (HO-032, punto 1). Hasta entonces se escribe `null`, que es la
 *    respuesta correcta: preferimos no saber la direccion a guardarla en claro
 *    en una tabla que no admite DELETE.
 *
 * 2. `before` / `after`. El saneado de `@lsw/audit` trabaja con una ALLOWLIST
 *    por operacion, y un `AuditEventDraft` no la trae. Un diff sin allowlist es
 *    un diff que nadie reviso, guardado para siempre. Se escribe `null` y queda
 *    constancia en `metadata` de que se descarto, para que un auditor pueda
 *    distinguir "no habia diff" de "habia y no se guardo".
 *
 * 3. `canonicalization_version`. La escribe el REPOSITORIO con la del puerto de
 *    encadenado, porque es la version con la que se construye el hash. Si el
 *    borrador trae otra -por ejemplo la de un snapshot antiguo- se conserva en
 *    `metadata`; no se pisa la del hash, que dejaria la fila imposible de
 *    verificar.
 */

import { randomUUID } from "node:crypto";

import type { AuditEventFieldsInput, AuditJsonObject } from "@lsw/database";
import type { AuditEventDraft, AuditRecorder } from "@lsw/tpa";

import type { AuditEventWriter, AuditUnitOfWork } from "./audit-sink.js";

export interface TpaAuditRecorderDependencies {
  readonly repository: AuditEventWriter;
  readonly unitOfWork: AuditUnitOfWork;
  /** Inyectables para poder fijarlos en un test. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

/**
 * Grabador que se NIEGA cuando falta el puerto de encadenado.
 *
 * Mismo criterio que `UnconfiguredAuditSink`: un sorteo o una entrega que se
 * confirman sin dejar rastro son peores que un sorteo que no ocurre.
 */
export class UnconfiguredTpaAuditRecorder implements AuditRecorder {
  public record(event: AuditEventDraft): Promise<void> {
    return Promise.reject(
      new Error(
        `No se puede registrar el hecho auditable "${event.action}": no hay puerto de encadenado ` +
          "de auditoria montado (`createAuditEventChainPort()` de `@lsw/audit`). La operacion no " +
          "se confirma (principio 12).",
      ),
    );
  }
}

class PersistentTpaAuditRecorder implements AuditRecorder {
  private readonly deps: TpaAuditRecorderDependencies;

  public constructor(deps: TpaAuditRecorderDependencies) {
    this.deps = deps;
  }

  public async record(event: AuditEventDraft): Promise<void> {
    const now = this.deps.now ?? ((): Date => new Date());
    const newId = this.deps.newId ?? randomUUID;

    const fields: AuditEventFieldsInput = {
      id: newId(),
      occurredAt: event.occurredAt,
      recordedAt: now().toISOString(),
      actorType: event.actor.type,
      actorId: event.actor.id,
      actorRoles: event.actor.roles,
      action: event.action,
      targetEntityType: event.targetEntityType,
      targetEntityId: event.targetEntityId,
      promotionId: event.promotionId,
      requestId: event.requestId,
      // Ver la cabecera, punto 2.
      before: null,
      after: null,
      reasonCode: event.reasonCode,
      reasonText: event.reasonText,
      // Ver la cabecera, punto 1.
      sourceIp: null,
      userAgent: event.userAgent,
      metadata: metadataWith(event),
    };

    // Sin `try`: si el hecho no se puede registrar, el efecto no se confirma.
    await this.deps.unitOfWork.withTransaction(() => this.deps.repository.append(fields));
  }
}

function metadataWith(event: AuditEventDraft): AuditJsonObject {
  const extra = new Map<string, unknown>();

  if (event.before !== null || event.after !== null) {
    extra.set("audit_diff_suppressed", "NO_ALLOWLIST_DECLARED");
  }
  if (event.sourceIp !== null) {
    // No se guarda la direccion, pero SI que la habia: un auditor que vea
    // `source_ip` nulo tiene que poder distinguir "no se conocia" de "se conocia
    // y no se pudo sellar".
    extra.set("audit_source_ip_suppressed", "NO_KEYED_DIGEST_CONFIGURED");
  }
  extra.set("tpa_canonicalization_version", event.canonicalizationVersion);

  return { ...event.metadata, ...Object.fromEntries(extra) };
}

export interface CreateTpaAuditRecorderOptions {
  readonly repository: AuditEventWriter;
  readonly unitOfWork: AuditUnitOfWork;
}

/** Monta el grabador, o uno que se niega si falta el puerto de encadenado. */
export function createTpaAuditRecorder(options: CreateTpaAuditRecorderOptions): AuditRecorder {
  if (!options.repository.isConfigured) {
    return new UnconfiguredTpaAuditRecorder();
  }
  return new PersistentTpaAuditRecorder({
    repository: options.repository,
    unitOfWork: options.unitOfWork,
  });
}
