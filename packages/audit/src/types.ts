/**
 * Tipos del subsistema de auditoria.
 *
 * La hash chain de DEC-008 ya NO es andamiaje: vive en `chain.ts`, su forma
 * canonica en `canonical.ts` y su verificador en `verifier.ts`. Se escribio
 * cuando `0006_entry_ledger` quedo commiteada, y no antes, porque fijar la
 * canonicalizacion sobre un esquema que aun se movia habria invalidado todos
 * los hashes al primer cambio.
 *
 * Lo que sigue sin implementarse es el ESCRITOR, y es de `apps/api`: escribir
 * un `AuditEvent` exige la misma transaccion que el hecho auditado, y esa
 * transaccion la abre quien atiende la peticion.
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

// `SUPPORTED_CANONICALIZATION_VERSIONS` vivia aqui como constante suelta.
// Ahora vive en `canonicalization.ts` junto al DESCRIPTOR de cada version -sus
// campos, su serializacion y la semantica de bordes del saldo-, porque una
// lista de numeros sin lo que cada numero significa no permite verificar nada.
// Cambiar la canonicalizacion cambia todos los hashes futuros: por eso la
// version viaja en cada registro y las antiguas siguen siendo verificables.

/** Destino de escritura. Lo implementara `apps/api` sobre la misma transaccion. */
export interface AuditSink {
  record(event: Omit<AuditEvent, "id" | "recordedAt" | "hash" | "previousHash">): Promise<void>;
}
