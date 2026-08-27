/**
 * Hechos auditables encadenados (DEC-007, DEC-008, DEC-035).
 * Espejo de `drizzle/0024_audit_events.sql`.
 *
 * NINGUNA COLUMNA DEL PAYLOAD LLEVA `.default(...)`, Y ES DELIBERADO
 *
 *   `id`, `recorded_at`, `actor_roles` y `metadata` forman parte del preimage
 *   de la hash chain. Un `DEFAULT` los volveria opcionales en el INSERT, y
 *   entonces el adaptador podria hashear un valor y la base de datos guardar
 *   otro: la cadena no se rompe mas tarde, NACE ROTA (DEC-035, DEC-047).
 *
 *   Sin `DEFAULT`, olvidarlos deja de ser posible: TypeScript exige el campo y
 *   la base de datos exige el NOT NULL. Es el mismo criterio que en
 *   `drawingEvents`, y una mejora sobre `entryTransactions`, que arrastra un
 *   `DEFAULT` historico y depende de que el escritor se acuerde.
 *
 * EL ENUM VIVE AQUI Y NO EN `enums.ts`
 *
 *   `audit_actor_type` solo lo usa esta tabla, y sus valores NO son los de
 *   `entry_actor_type`: aqui el actor administrativo es STAFF -la palabra del
 *   ambito de sesion y del catalogo de `@lsw/audit`- y existe ANONYMOUS, que en
 *   el ledger no tendria sentido. Dos enums con nombres parecidos y valores
 *   distintos juntos en el mismo fichero es como se acaba usando el equivocado.
 */

import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { promotions } from "./promotions.js";

/** Quien actua. ANONYMOUS existe porque un intento fallido tambien se audita. */
export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "PARTICIPANT",
  "STAFF",
  "SYSTEM",
  "ANONYMOUS",
]);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    /**
     * Orden total de escritura. Fuera del payload -la base de datos lo asigna
     * durante el INSERT-, protegido por la topologia de la cadena.
     */
    sequenceNo: bigint("sequence_no", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    /**
     * Clave de cadena: `promotion_id` en texto, o `global`. Un CHECK la ata a
     * la columna, de modo que poner una fila en la cadena equivocada no es
     * posible.
     */
    chainKey: text("chain_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    /** Identificador interno. Nunca un correo ni un nombre. */
    actorId: text("actor_id"),
    /** Roles efectivos en el momento de la accion. El orden entra en el hash. */
    actorRoles: jsonb("actor_roles").notNull(),
    action: text("action").notNull(),
    targetEntityType: text("target_entity_type").notNull(),
    targetEntityId: text("target_entity_id"),
    promotionId: uuid("promotion_id").references(() => promotions.id, { onDelete: "restrict" }),
    requestId: text("request_id"),
    /** Diff YA saneado por `redactDiff`. Nunca un objeto de dominio crudo. */
    before: jsonb("before"),
    after: jsonb("after"),
    reasonCode: text("reason_code"),
    /** Texto interno del operador. No se sirve al participante ni va al log. */
    reasonText: text("reason_text"),
    /** DIGEST de la direccion, jamas la direccion. Un CHECK lo impone. */
    sourceIp: text("source_ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    /** NOT NULL: la primera fila guarda el genesis, no NULL. Ver la migracion. */
    chainPrevHash: text("chain_prev_hash").notNull(),
    chainHash: text("chain_hash").notNull(),
  },
  (table) => [
    // La bifurcacion de la cadena, imposible por construccion: dos filas no
    // pueden declarar el mismo antecesor dentro de la misma cadena.
    uniqueIndex("audit_events_unique_chain_link").on(table.chainKey, table.chainPrevHash),
    uniqueIndex("audit_events_unique_chain_hash").on(table.chainKey, table.chainHash),
    index("audit_events_chain_idx").on(table.chainKey, table.sequenceNo),
    index("audit_events_promotion_time_idx").on(table.promotionId, table.occurredAt),
    index("audit_events_action_time_idx").on(table.action, table.occurredAt),
    index("audit_events_target_idx").on(table.targetEntityType, table.targetEntityId),
    index("audit_events_request_idx").on(table.requestId),
    index("audit_events_actor_idx").on(table.actorType, table.actorId),
  ],
);
