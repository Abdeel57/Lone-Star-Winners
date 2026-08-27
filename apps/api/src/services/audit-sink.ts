/**
 * Sumidero de auditoria: persistencia encadenada (HO-028, DEC-007, DEC-008).
 *
 * ---------------------------------------------------------------------------
 * QUE SUSTITUYE, Y POR QUE HABIA QUE SUSTITUIRLO
 * ---------------------------------------------------------------------------
 *
 * Hasta HO-028 esto era `LoggingAuditSink`: los hechos auditables iban al log
 * estructurado con `event: "audit.pending_persistence"`. Su propia cabecera
 * decia lo que era -"NO ES AUDITORIA"- y tenia razon: un log rota, no se
 * encadena, no se sella y no se puede verificar. Las tres cosas que DEC-008
 * exige.
 *
 * Ahora el hecho se escribe en `audit_events`, encadenado. El log SIGUE, pero
 * como ESPEJO operativo -para poder hacer grep durante un incidente-, no como
 * registro. Y sin `reason_detail`: ese campo es texto libre del operador y
 * puede contener datos de una persona, asi que va a la tabla, que esta
 * controlada por permisos, y no al log, que acaba en cualquier agregador.
 *
 * ---------------------------------------------------------------------------
 * SI EL EVENTO NO SE PUEDE PERSISTIR, EL EFECTO NO SE CONFIRMA (principio 12)
 * ---------------------------------------------------------------------------
 *
 * `emit` NO captura errores. Ni los de escritura, ni los de configuracion. Un
 * `catch` que registrara el fallo y siguiera adelante convertiria la auditoria
 * en algo opcional exactamente cuando mas importa: bajo fallo. Y el sistema
 * quedaria con un efecto confirmado del que no hay constancia, que es la forma
 * mas silenciosa de perder trazabilidad.
 *
 * La escritura va por `withTransaction`, y la implementacion de
 * `DrizzleUnitOfWork` REUTILIZA la transaccion viva si la hay. Eso da lo que
 * pide HO-028 sin que el llamante tenga que saber nada:
 *
 *   - emitido DENTRO de la transaccion del efecto -el caso normal-: la fila de
 *     auditoria entra en ESA transaccion. Si falla, el efecto tampoco se
 *     confirma;
 *   - emitido FUERA: abre transaccion propia, y el fallo se propaga igual.
 *
 * HALLAZGO PARA `backend` (handoff): hay emisiones del segundo tipo. Por
 * ejemplo `AwardService.releaseHold` emite `entry.award.hold.released` fuera de
 * la transaccion que resuelve la retencion. No es incorrecto de por si, pero la
 * atomicidad de DEC-007 solo la da el primer caso, y conviene moverlas dentro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE FICHERO NO IMPORTA `@lsw/audit`
 * ---------------------------------------------------------------------------
 *
 * Porque `apps/api` todavia no lo declara como dependencia, y anadirla exige
 * `pnpm install`, que es el punto 2 de HO-028 y corresponde al Team Lead.
 *
 * Asi que las dos piezas que necesitan ese paquete -la construccion del hash y
 * el saneado del diff- entran por PUERTO, y las dos fallan en cerrado si no
 * estan montadas:
 *
 *   - sin puerto de encadenado, `DrizzleAuditEventRepository.append` se niega;
 *   - sin saneador, `before` y `after` se escriben SIEMPRE a `null`.
 *
 * Ese segundo caso merece una linea: la alternativa seria escribir el diff sin
 * sanear "porque todavia no hay saneador". En una tabla append-only que se
 * conserva indefinidamente, un diff sin sanear es un token de sesion o una
 * fecha de nacimiento guardados para siempre y sin forma de retirarlos.
 * Preferimos un registro con menos detalle a un registro con detalle que no
 * deberia estar ahi.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type {
  AppendedAuditEventRecord,
  AuditEventFieldsInput,
  AuditJsonObject,
} from "@lsw/database";
import type { AuditSink, DomainAuditEvent } from "@lsw/sweepstakes";

// ---------------------------------------------------------------------------
// Contexto de peticion
// ---------------------------------------------------------------------------

/**
 * Lo que sabe la peticion HTTP y no sabe el dominio.
 *
 * `DomainAuditEvent` no lleva `requestId`, ni roles, ni agente de usuario, y no
 * debe llevarlos: son datos de TRANSPORTE, y meterlos en el puerto del dominio
 * obligaria a cada servicio a arrastrarlos por sus firmas.
 *
 * Viajan por `AsyncLocalStorage`, igual que la transaccion viva en
 * `packages/database/src/repositories/executor.ts` y por el mismo motivo: una
 * variable de modulo la comparten todas las peticiones del proceso y con dos
 * concurrentes -que es el caso normal- la segunda pisaria a la primera.
 */
export interface AuditRequestContext {
  /** DEC-022: correlacion con `error.request_id`. */
  readonly requestId: string | null;
  /** Roles EFECTIVOS en el momento de la accion, no los de hoy. */
  readonly actorRoles: readonly string[];
  /**
   * DIGEST de la direccion, jamas la direccion.
   *
   * PENDIENTE, y conviene que se lea: un SHA-256 a secas de una IPv4 se
   * invierte por fuerza bruta en segundos -son cuatro mil millones de valores-,
   * asi que el digest tiene que ser CON CLAVE. La clave es un secreto de
   * entorno y su registro vive en `packages/security/src/env/**`, que esta en
   * manos de otra sesion. Hasta que exista, quien monta la aplicacion NO debe
   * rellenar este campo: `null` es la respuesta correcta.
   */
  readonly sourceIpDigest: string | null;
  readonly userAgent: string | null;
  /**
   * Estado antes y despues, con la allowlist de ESTA operacion.
   *
   * `allow` es una lista cerrada de nombres de campo. Lo que no este, no se
   * guarda. Ver `redactDiff` en `packages/audit/src/safe-diff.ts`.
   */
  readonly diff?: {
    readonly allow: readonly string[];
    readonly before: AuditJsonObject | null;
    readonly after: AuditJsonObject | null;
  };
}

const contextStorage = new AsyncLocalStorage<AuditRequestContext>();

/** Ejecuta `work` con el contexto de auditoria de esta peticion. */
export function withAuditContext<T>(context: AuditRequestContext, work: () => T): T {
  return contextStorage.run(context, work);
}

export function currentAuditContext(): AuditRequestContext | undefined {
  return contextStorage.getStore();
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------

/** Saneado del diff. Lo implementa `redactDiff` de `@lsw/audit`. */
export interface AuditDiffRedactor {
  redact(input: {
    readonly allow: readonly string[];
    readonly before: AuditJsonObject | null;
    readonly after: AuditJsonObject | null;
  }): {
    readonly before: AuditJsonObject | null;
    readonly after: AuditJsonObject | null;
    readonly droppedKeys: readonly string[];
    readonly truncatedKeys: readonly string[];
  };
}

/** Unidad de trabajo. Reutiliza la transaccion viva si la hay. */
export interface AuditUnitOfWork {
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Escritor de la cadena. Lo implementa `DrizzleAuditEventRepository`.
 *
 * Es un puerto y no la clase concreta por una razon practica: asi el sumidero
 * se puede ejercitar sin base de datos -y se ejercita, en
 * `test/audit-sink.test.ts`- y lo que se prueba es su contrato, que es donde
 * vive la regla de "si no se puede registrar, no se confirma".
 */
export interface AuditEventWriter {
  readonly isConfigured: boolean;
  append(fields: AuditEventFieldsInput): Promise<AppendedAuditEventRecord>;
}

/** Lo minimo del logger que este modulo usa. */
export interface AuditMirrorLogger {
  info(payload: Readonly<Record<string, unknown>>, message: string): void;
}

export interface PersistentAuditSinkDependencies {
  readonly repository: AuditEventWriter;
  readonly unitOfWork: AuditUnitOfWork;
  readonly logger: AuditMirrorLogger;
  /** Saneador del diff. Sin el, `before` y `after` se escriben a `null`. */
  readonly redactor?: AuditDiffRedactor;
  /** Inyectables para poder fijarlos en un test. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

// ---------------------------------------------------------------------------
// Proyeccion del actor
// ---------------------------------------------------------------------------

interface ActorProjection {
  readonly actorType: AuditEventFieldsInput["actorType"];
  readonly actorId: string | null;
}

/**
 * `DomainActor` -> columnas de `audit_events`.
 *
 * El actor administrativo se llama ADMIN en el ledger y STAFF aqui. No es un
 * descuido: STAFF es la palabra del ambito de sesion (`PRINCIPAL_SCOPES`) y la
 * del catalogo de `@lsw/audit`, y el enum `audit_actor_type` la impone. La
 * traduccion ocurre en este unico sitio.
 */
function projectActor(actor: DomainAuditEvent["actor"]): ActorProjection {
  switch (actor.type) {
    case "ADMIN":
      return { actorType: "STAFF", actorId: actor.adminUserId };
    case "PARTICIPANT":
      return { actorType: "PARTICIPANT", actorId: actor.participantId };
    case "SYSTEM":
      return { actorType: "SYSTEM", actorId: null };
    default: {
      const exhaustive: never = actor;
      throw new RangeError(`Actor desconocido: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// El sumidero
// ---------------------------------------------------------------------------

export class PersistentAuditSink implements AuditSink {
  private readonly deps: PersistentAuditSinkDependencies;

  public constructor(deps: PersistentAuditSinkDependencies) {
    this.deps = deps;
  }

  public async emit(event: DomainAuditEvent): Promise<void> {
    const context = currentAuditContext();
    const actor = projectActor(event.actor);
    const now = this.deps.now ?? ((): Date => new Date());
    const newId = this.deps.newId ?? randomUUID;

    const diff = this.redactedDiff(context);

    const fields: AuditEventFieldsInput = {
      id: newId(),
      // DEC-011: el instante del HECHO lo trae el dominio; el del registro lo
      // pone quien escribe. Los dos entran en el preimage (DEC-035), asi que
      // se calculan aqui una sola vez y se usan tal cual.
      occurredAt: event.occurredAt.toISOString(),
      recordedAt: now().toISOString(),
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorRoles: context?.actorRoles ?? [],
      action: event.action,
      targetEntityType: event.targetEntityType,
      targetEntityId: event.targetEntityId,
      promotionId: event.promotionId,
      requestId: context?.requestId ?? null,
      before: diff.before,
      after: diff.after,
      reasonCode: event.reasonKey,
      reasonText: event.reasonDetail,
      sourceIp: context?.sourceIpDigest ?? null,
      userAgent: context?.userAgent ?? null,
      metadata: this.metadataWith(event, diff),
    };

    // Sin `try`. Ver la cabecera: un fallo aqui debe impedir que el efecto se
    // confirme, y para eso tiene que propagarse.
    const appended = await this.deps.unitOfWork.withTransaction(() =>
      this.deps.repository.append(fields),
    );

    // Espejo operativo. Se escribe DESPUES de persistir: un log que dijera
    // "registrado" antes de que la transaccion confirme mentiria en cuanto
    // hubiera un rollback.
    this.deps.logger.info(
      {
        event: "audit.recorded",
        audit_event_id: appended.id,
        chain_key: appended.chainKey,
        chain_hash: appended.chainHashHex,
        sequence_no: appended.sequence,
        action: fields.action,
        actor_type: fields.actorType,
        actor_id: fields.actorId,
        promotion_id: fields.promotionId,
        target_entity_type: fields.targetEntityType,
        target_entity_id: fields.targetEntityId,
        reason_code: fields.reasonCode,
        request_id: fields.requestId,
        occurred_at: fields.occurredAt,
        // `reason_text` NO se registra: es texto libre del operador y puede
        // contener datos de una persona. Vive en la tabla, que esta controlada
        // por permisos, no en el log, que acaba en cualquier agregador.
      },
      "hecho auditable registrado",
    );
  }

  /**
   * Diff saneado, o nada.
   *
   * Sin saneador montado NO se escribe diff. Escribirlo crudo "hasta que haya
   * saneador" seria guardar para siempre lo que nadie reviso, en una tabla que
   * no admite DELETE.
   */
  private redactedDiff(context: AuditRequestContext | undefined): {
    readonly before: AuditJsonObject | null;
    readonly after: AuditJsonObject | null;
    readonly droppedKeys: readonly string[];
    readonly truncatedKeys: readonly string[];
    readonly suppressed: boolean;
  } {
    const requested = context?.diff;
    if (requested === undefined) {
      return { before: null, after: null, droppedKeys: [], truncatedKeys: [], suppressed: false };
    }

    const redactor = this.deps.redactor;
    if (redactor === undefined) {
      return { before: null, after: null, droppedKeys: [], truncatedKeys: [], suppressed: true };
    }

    return { ...redactor.redact(requested), suppressed: false };
  }

  /**
   * `metadata` del dominio mas la constancia de lo que se descarto.
   *
   * Un auditor que vea un `before` con dos campos tiene que poder distinguir
   * "el objeto tenia dos campos" de "tenia veinte y se guardaron dos". Un
   * saneador silencioso produce registros que parecen completos.
   */
  private metadataWith(
    event: DomainAuditEvent,
    diff: {
      readonly droppedKeys: readonly string[];
      readonly truncatedKeys: readonly string[];
      readonly suppressed: boolean;
    },
  ): AuditJsonObject {
    const extra = new Map<string, unknown>();
    if (diff.droppedKeys.length > 0) {
      extra.set("audit_diff_dropped_keys", [...diff.droppedKeys]);
    }
    if (diff.truncatedKeys.length > 0) {
      extra.set("audit_diff_truncated_keys", [...diff.truncatedKeys]);
    }
    if (diff.suppressed) {
      extra.set("audit_diff_suppressed", "NO_REDACTOR_CONFIGURED");
    }

    return extra.size === 0 ? event.metadata : { ...event.metadata, ...Object.fromEntries(extra) };
  }
}

/**
 * Sumidero que se NIEGA, para cuando falta el montaje.
 *
 * No es un `DiscardingAuditSink` con otro nombre: aquel devuelve exito y este
 * lanza. La diferencia es todo: con el primero, un sistema a medio montar
 * confirma operaciones administrativas sin dejar rastro y nadie se entera hasta
 * que alguien pide el historico. Con este, la operacion falla el primer dia y
 * el montaje que falta se nota.
 */
export class UnconfiguredAuditSink implements AuditSink {
  private readonly reason: string;

  public constructor(reason: string) {
    this.reason = reason;
  }

  public emit(event: DomainAuditEvent): Promise<void> {
    return Promise.reject(
      new Error(
        `No se puede registrar el hecho auditable "${event.action}": ${this.reason} ` +
          "La operacion no se confirma. Un sistema regulado que confirma efectos sin poder " +
          "registrarlos no es un detalle de configuracion, es un incidente (principio 12).",
      ),
    );
  }
}

export interface CreateAuditSinkOptions {
  readonly repository: AuditEventWriter;
  readonly unitOfWork: AuditUnitOfWork;
  readonly logger: AuditMirrorLogger;
  readonly redactor?: AuditDiffRedactor;
}

/**
 * Monta el sumidero, o uno que se niega si falta el puerto de encadenado.
 *
 * La comprobacion se hace UNA vez, al montar, y no en cada `emit`: asi el
 * arranque de la aplicacion refleja el estado real del montaje.
 */
export function createAuditSink(options: CreateAuditSinkOptions): AuditSink {
  if (!options.repository.isConfigured) {
    return new UnconfiguredAuditSink(
      "no hay puerto de encadenado de auditoria montado (`createAuditEventChainPort()` de " +
        "`@lsw/audit`), asi que la fila no se puede encadenar y no se escribe.",
    );
  }

  return new PersistentAuditSink({
    repository: options.repository,
    unitOfWork: options.unitOfWork,
    logger: options.logger,
    ...(options.redactor === undefined ? {} : { redactor: options.redactor }),
  });
}
