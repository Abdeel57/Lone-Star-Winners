/**
 * Tipos del subsistema de auditoria.
 *
 * ESTADO: ANDAMIAJE. Aqui hay tipos y catalogos, no implementacion.
 *
 * La hash chain de DEC-008 y el escritor de `AuditEvent` NO se implementan
 * todavia a proposito: dependen del esquema del ledger, que pertenece a
 * `backend` (`packages/database`) y aun no existe. Escribir ahora la
 * canonicalizacion significaria fijar el orden y el tipo de unos campos que
 * todavia no estan definidos, y una canonicalizacion que cambia despues
 * invalida todos los hashes anteriores.
 *
 * Ver handoff HO-009.
 */

/** Quien actua. La distincion humano/sistema es la primera pregunta de un auditor. */
export type AuditActorType = "PARTICIPANT" | "STAFF" | "SYSTEM" | "ANONYMOUS";

export interface AuditActor {
  readonly type: AuditActorType;
  /** Identificador interno. Nunca un correo ni un nombre. */
  readonly id: string | null;
  /** Roles efectivos en el momento de la accion, no los actuales. */
  readonly roles: readonly string[];
}

/**
 * Un `AuditEvent` es inmutable.
 *
 * DEC-007: sin UPDATE ni DELETE, garantizado por permisos de base de datos,
 * triggers y test de invariante. Corregir un evento consiste en escribir otro.
 */
export interface AuditEvent {
  readonly id: string;
  /** Instante en que ocurrio, en UTC (DEC-011). */
  readonly occurredAt: string;
  /** Instante en que la base de datos lo registro. Puede diferir. */
  readonly recordedAt: string;
  readonly actor: AuditActor;
  /** Identificador estable del catalogo de acciones. */
  readonly action: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string | null;
  readonly promotionId: string | null;
  /** Correlacion con la peticion HTTP (`error.request_id`, DEC-022). */
  readonly requestId: string | null;
  /**
   * Estado antes y despues, ya saneados. Nunca contrasenas, tokens, datos de
   * pago en claro ni documentos de identidad.
   */
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  /** Codigo estable de motivo. DEC-022: enum, nunca prosa traducible. */
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** DEC-008: SHA256(canonical(payload) || prev_hash), encadenado por promocion. */
  readonly hash: string;
  readonly previousHash: string | null;
  readonly canonicalizationVersion: number;
}

/**
 * Versiones de canonicalizacion soportadas.
 *
 * Cambiar la canonicalizacion cambia todos los hashes futuros: por eso la
 * version viaja en cada registro y las antiguas siguen siendo verificables.
 */
export const SUPPORTED_CANONICALIZATION_VERSIONS: readonly number[] = Object.freeze([1]);

/** Destino de escritura. Lo implementara `apps/api` sobre la misma transaccion. */
export interface AuditSink {
  record(event: Omit<AuditEvent, "id" | "recordedAt" | "hash" | "previousHash">): Promise<void>;
}
