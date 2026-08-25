/**
 * Promocion, version de reglas y documentos legales.
 * Espejo de `drizzle/0002_promotions.sql`.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";
import { localeCodeEnum, promotionStatusEnum, rulesVersionStatusEnum } from "./enums.js";

export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    internalName: text("internal_name").notNull(),
    status: promotionStatusEnum("status").notNull().default("DRAFT"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /**
     * DEC-011: zona horaria legal IANA. Todos los deadlines se evaluan en el
     * servidor contra esta zona, nunca contra la del navegador ni la del
     * proceso. Sin default a proposito.
     */
    legalTimezone: text("legal_timezone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    activeRulesVersionId: uuid("active_rules_version_id").references(
      (): AnyPgColumn => promotionRulesVersions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("promotions_status_idx").on(table.status)],
);

/** Copy de marketing. El texto legalmente controlante vive en `promotionRulesDocuments`. */
export const promotionTranslations = pgTable(
  "promotion_translations",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    locale: localeCodeEnum("locale").notNull(),
    publicName: text("public_name").notNull(),
    tagline: text("tagline"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "promotion_translations_pkey", columns: [table.promotionId, table.locale] })],
);

/**
 * DEC-012: configuracion legal inmutable y versionada.
 *
 * `unresolvedRequiredKeys` es una columna GENERADA por PostgreSQL a partir de
 * `config`. La aplicacion no puede escribirla, luego no puede declarar
 * "resuelto" nada que no lo este. Un trigger impide activar la promocion
 * mientras esa lista no este vacia.
 */
export const promotionRulesVersions = pgTable(
  "promotion_rules_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: rulesVersionStatusEnum("status").notNull().default("DRAFT"),
    /** Configuracion aprobada por el abogado. El repositorio la consume; no la produce. */
    config: jsonb("config").notNull().default({}),
    unresolvedRequiredKeys: text("unresolved_required_keys")
      .array()
      .generatedAlwaysAs(sql`lsw_unresolved_required_keys(config)`),
    attorneyApprovalReference: text("attorney_approval_reference"),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(() => adminUsers.id, { onDelete: "restrict" }),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    activatedByAdminUserId: uuid("activated_by_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("promotion_rules_versions_one_active_per_promotion")
      .on(table.promotionId)
      .where(sql`status = 'ACTIVE'`),
    index("promotion_rules_versions_promotion_idx").on(table.promotionId, table.version.desc()),
  ],
);

/**
 * DEC-022, excepcion de contenido legalmente controlante: este texto viaja
 * desde el backend por locale y el frontend lo renderiza tal cual llega, sin
 * traducirlo ni autotraducirlo.
 */
export const promotionRulesDocuments = pgTable(
  "promotion_rules_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    locale: localeCodeEnum("locale").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /**
     * Cual de los dos idiomas es el legalmente controlante sigue en `TBD`
     * (`docs/LEGAL_PENDING.md`). Por eso ambos campos son booleanos explicitos
     * y el sistema admite que todavia no haya ninguno marcado: no lo adivina.
     */
    isLegallyControlling: boolean("is_legally_controlling").notNull().default(false),
    isInformationalTranslation: boolean("is_informational_translation").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("promotion_rules_documents_unique_locale").on(table.rulesVersionId, table.locale),
    uniqueIndex("promotion_rules_documents_one_controlling_per_version")
      .on(table.rulesVersionId)
      .where(sql`is_legally_controlling`),
  ],
);

/** Transiciones legitimas del ciclo de vida, como datos consultables. */
export const promotionStatusTransitions = pgTable(
  "promotion_status_transitions",
  {
    fromStatus: promotionStatusEnum("from_status").notNull(),
    toStatus: promotionStatusEnum("to_status").notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    primaryKey({ name: "promotion_status_transitions_pkey", columns: [table.fromStatus, table.toStatus] }),
  ],
);
