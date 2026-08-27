/**
 * Participacion sin compra (AMOE).
 * Espejo de `drizzle/0021_amoe_submissions.sql`.
 *
 * UN ENVIO SI ES MUTABLE; SU EFECTO NO
 *
 *   El expediente tiene un antes -se manda, alguien lo revisa- y por eso
 *   admite UPDATE de las columnas de revision. Lo que no cambia es el efecto:
 *   la aprobacion escribe una fila `AMOE_EARNED` en el ledger, con
 *   `source_type = 'AMOE'`, y esa fila es inmutable como cualquier otra.
 *
 *   Compra y AMOE conviven en el MISMO universo elegible conservando su
 *   procedencia (principio 9). No hay dos saldos ni dos tablas de entries.
 *
 * LA HUELLA NO ES UNICA, Y ES A PROPOSITO
 *
 *   La politica de duplicados es configuracion: con `REJECT` el dominio
 *   rechaza el segundo envio identico, y con `FLAG_FOR_REVIEW` lo ACEPTA y lo
 *   manda a revision humana. Una restriccion de unicidad haria imposible la
 *   segunda politica, que es la que permite corregir un dato sin quedarse
 *   fuera de la via gratuita.
 */

import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { entryTransactions } from "./entries.js";
import { amoeModeEnum, amoeSubmissionStatusEnum } from "./enums.js";
import { adminUsers, participants } from "./identity.js";
import { promotionRulesVersions, promotions } from "./promotions.js";

export const amoeSubmissions = pgTable(
  "amoe_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    /** Congelada: si la promocion cambia de modalidad, lo enviado sigue siendo lo que fue. */
    mode: amoeModeEnum("mode").notNull(),
    status: amoeSubmissionStatusEnum("status").notNull().default("SUBMITTED"),
    /** SHA-256 hexadecimal del contenido normalizado. NO es unica por promocion. */
    fingerprint: text("fingerprint").notNull(),
    /**
     * Cubo del periodo en la zona LEGAL de la promocion (DEC-011). Se persiste
     * en vez de recalcularse: la zona legal podria corregirse, y un limite ya
     * evaluado no debe cambiar de resultado despues.
     */
    periodBucket: text("period_bucket").notNull(),
    /**
     * PII de participacion gratuita. Sujeta a la politica de retencion
     * pendiente en `docs/LEGAL_PENDING.md`.
     */
    payload: jsonb("payload").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    reviewedByAdminUserId: uuid("reviewed_by_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    /** DEC-022: clave estable, nunca prosa. El copy es de `frontend`. */
    reviewReasonKey: text("review_reason_key"),
    /** Nota interna del revisor. No se sirve al participante. */
    reviewNotes: text("review_notes"),
    /** Fila de ledger que genero la aprobacion. `null` hasta entonces. */
    entryTransactionId: uuid("entry_transaction_id").references(() => entryTransactions.id, {
      onDelete: "restrict",
    }),
    metadata: jsonb("metadata").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("amoe_submissions_review_queue_idx")
      .on(table.promotionId, table.submittedAt)
      .where(sql`status IN ('SUBMITTED', 'PENDING_REVIEW')`),
    index("amoe_submissions_period_idx")
      .on(table.promotionId, table.participantId, table.periodBucket)
      .where(sql`status IN ('SUBMITTED', 'PENDING_REVIEW', 'APPROVED')`),
    index("amoe_submissions_fingerprint_idx").on(table.promotionId, table.fingerprint),
    index("amoe_submissions_participant_idx").on(table.participantId, sql`submitted_at DESC`),
    uniqueIndex("amoe_submissions_unique_entry_transaction")
      .on(table.entryTransactionId)
      .where(sql`entry_transaction_id IS NOT NULL`),
  ],
);
