/**
 * Superficie de ESCRITURA de las versiones de reglas, los feature flags y la
 * resolucion de participante por correo (DEC-012, DEC-032, DEC-054).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO EXISTIA HASTA AHORA
 * ---------------------------------------------------------------------------
 *
 * HO-038 dejo escrito que la `PromotionRulesVersion` "no existe todavia como
 * superficie de escritura", y los flags solo tenian lectura. La consecuencia
 * practica era que la unica forma de cargar la configuracion legal que aprueba
 * el abogado era ejecutar SQL contra produccion: sin motivo, sin actor y sin
 * traza. DEC-054 lo convierte en rutas con capacidad, motivo y step-up.
 *
 * ---------------------------------------------------------------------------
 * QUIEN IMPONE LA INMUTABILIDAD
 * ---------------------------------------------------------------------------
 *
 * PostgreSQL, no este archivo. `lsw_rules_versions_enforce_immutability`
 * (migracion `0002`, DEC-012) decide que una version `DRAFT` se puede editar,
 * que una `ACTIVE` solo se puede archivar, que una `ARCHIVED` no se toca y que
 * ninguna se borra. Aqui NO se reimplementa nada de eso: se traduce el error
 * del motor.
 *
 * Reimplementarlo seria una segunda fuente de verdad sobre cuando se puede
 * cambiar una regla legal, y la segunda siempre acaba discrepando. Manda la que
 * no se puede saltar.
 *
 * ---------------------------------------------------------------------------
 * AQUI NO SE RELLENA NINGUNA CLAVE
 * ---------------------------------------------------------------------------
 *
 * Una version nueva sin plantilla nace con las claves requeridas de DEC-012 en
 * `"TBD"`. `"TBD"` NO es un valor: es la forma que tiene el sistema de decir
 * que nadie ha respondido todavia, y es exactamente lo que
 * `lsw_unresolved_required_keys` cuenta para impedir la activacion. Escribir un
 * default -una edad, una jurisdiccion, una politica de redondeo- seria inventar
 * un requisito legal (principio 2).
 */

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@lsw/database";
import {
  adminUsers,
  featureFlagSettings,
  featureFlags,
  identities,
  participants,
  promotionRulesDocuments,
  promotionRulesVersions,
  promotions,
  settingChangeRequests,
} from "@lsw/database";
import { REQUIRED_RULES_KEYS, type AmoeMode, type LocaleCode } from "@lsw/sweepstakes";

import type { FeatureFlagKey } from "../http/feature-flag-catalog.js";

// ---------------------------------------------------------------------------
// Versiones de reglas
// ---------------------------------------------------------------------------

export type RulesVersionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface RulesDocumentRow {
  readonly locale: LocaleCode;
  readonly title: string;
  readonly body: string;
  readonly isLegallyControlling: boolean;
  readonly isInformationalTranslation: boolean;
}

export interface RulesVersionRow {
  readonly id: string;
  readonly promotionId: string;
  readonly version: number;
  readonly status: RulesVersionStatus;
  readonly config: unknown;
  /**
   * Columna GENERADA por PostgreSQL a partir de `config`. La aplicacion no
   * puede escribirla, luego no puede declarar "resuelto" nada que no lo este.
   */
  readonly unresolvedRequiredKeys: readonly string[];
  readonly attorneyApprovalReference: string | null;
  readonly effectiveAt: Date | null;
  readonly createdAt: Date;
  readonly createdByAdminUserId: string | null;
  readonly activatedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly documents: readonly RulesDocumentRow[];
}

export interface CreateRulesVersionInput {
  readonly promotionId: string;
  /** Copia `config` y documentos de esa version. `null` = plantilla en blanco. */
  readonly cloneFromRulesVersionId: string | null;
  /** Sobrescribe lo clonado. `null` = lo que traiga el clon, o la plantilla. */
  readonly config: Record<string, unknown> | null;
  readonly attorneyApprovalReference: string | null;
  readonly createdByAdminUserId: string | null;
}

export interface UpdateRulesVersionInput {
  readonly config?: Record<string, unknown>;
  readonly attorneyApprovalReference?: string | null;
  readonly effectiveAt?: Date | null;
}

export interface UpsertRulesDocumentInput {
  readonly locale: LocaleCode;
  readonly title: string;
  readonly body: string;
  readonly isLegallyControlling: boolean;
  readonly isInformationalTranslation: boolean;
}

/**
 * Plantilla de una version en blanco: TODAS las claves requeridas en `"TBD"`.
 *
 * No es un valor por defecto disfrazado. Es el estado honesto de una
 * configuracion que nadie ha redactado, y el que `lsw_unresolved_required_keys`
 * cuenta para negarse a activar la promocion. Una plantilla con claves ausentes
 * daria el mismo resultado en el trigger, pero dejaria al panel adivinando que
 * campos existen; con `"TBD"` la lista es explicita y se puede pintar.
 */
export function blankRulesConfigTemplate(): Record<string, unknown> {
  return Object.fromEntries(REQUIRED_RULES_KEYS.map((key) => [key, "TBD"]));
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export interface FeatureFlagRow {
  readonly key: FeatureFlagKey;
  readonly enabled: boolean;
  readonly isLegallyMaterial: boolean;
  readonly dec032Default: boolean;
  readonly legalDependency: string | null;
  readonly updatedAt: Date;
}

export interface FeatureFlagsView {
  readonly items: readonly FeatureFlagRow[];
  readonly amoeMode: AmoeMode | null;
}

// ---------------------------------------------------------------------------
// Participante resuelto por correo (transcripcion postal)
// ---------------------------------------------------------------------------

export interface ResolvedParticipant {
  readonly participantId: string;
  /** `true` si esta peticion lo creo. La respuesta lo publica (contrato 13.10). */
  readonly created: boolean;
}

export interface AdminRulesRepository {
  listRulesVersions(promotionId: string): Promise<readonly RulesVersionRow[]>;
  findRulesVersion(promotionId: string, rulesVersionId: string): Promise<RulesVersionRow | null>;
  createRulesVersion(input: CreateRulesVersionInput): Promise<RulesVersionRow>;
  updateRulesVersion(
    promotionId: string,
    rulesVersionId: string,
    input: UpdateRulesVersionInput,
  ): Promise<RulesVersionRow | null>;
  upsertRulesDocument(
    promotionId: string,
    rulesVersionId: string,
    input: UpsertRulesDocumentInput,
  ): Promise<RulesVersionRow | null>;
  /**
   * Activa una version EN UNA SOLA TRANSACCION: archiva la `ACTIVE` anterior,
   * activa esta y escribe `promotions.active_rules_version_id`.
   *
   * Los cerrojos siguen siendo los triggers de `0002` (DEC-012): si la version
   * tiene claves sin resolver, el motor se niega y quien llama traduce el 409.
   */
  activateRulesVersion(
    promotionId: string,
    rulesVersionId: string,
    activatedByAdminUserId: string | null,
    now: Date,
  ): Promise<RulesVersionRow | null>;

  listFlags(): Promise<FeatureFlagsView>;
  /** `null` = clave desconocida. El enum de la base de datos ya la rechazaria. */
  updateFlag(
    key: FeatureFlagKey,
    enabled: boolean,
    reason: string,
    adminUserId: string,
  ): Promise<FeatureFlagRow | null>;
  setAmoeMode(mode: AmoeMode | null, reason: string, adminUserId: string): Promise<AmoeMode | null>;

  /**
   * Participante por correo; lo crea si no existe (DEC-054 punto 4).
   *
   * Las Official Rules NO exigen cuenta para la via gratuita, asi que la
   * identidad nace `PENDING_VERIFICATION` y SIN credenciales: no se puede
   * iniciar sesion con ella, y quien reciba la ficha no ha elegido contrasena
   * alguna. Es un expediente al que asignar participaciones, no una cuenta.
   */
  findOrCreateParticipantByEmail(
    email: string,
    preferredLocale: LocaleCode,
  ): Promise<ResolvedParticipant>;

  // -- Control dual de ajustes legalmente materiales (DEC-032, DEC-054) ------

  listSettingChangeRequests(options: {
    status: SettingChangeStatus | null;
    limit: number;
    after: string | null;
  }): Promise<readonly SettingChangeRequestRow[]>;
  findSettingChangeRequest(id: string): Promise<SettingChangeRequestRow | null>;
  createSettingChangeRequest(input: CreateSettingChangeInput): Promise<SettingChangeRequestRow>;
  /**
   * Marca la solicitud como decidida. NO aplica el cambio: aplicarlo es una
   * escritura sobre otra tabla, y quien la orquesta es el servicio de rutas
   * para poder hacer las dos cosas en la misma transaccion.
   */
  decideSettingChangeRequest(
    id: string,
    input: DecideSettingChangeInput,
  ): Promise<SettingChangeRequestRow | null>;
  /** Solicitud pendiente que ya afecta a este ajuste, si la hay. */
  findPendingSettingChangeRequest(
    kind: SettingChangeKind,
    key: string,
  ): Promise<SettingChangeRequestRow | null>;
}

export type SettingChangeKind = "FEATURE_FLAG" | "AMOE_MODE";
export type SettingChangeStatus = "PENDING_APPROVAL" | "APPLIED" | "REJECTED";

export interface SettingChangeRequestRow {
  readonly id: string;
  readonly settingKind: SettingChangeKind;
  readonly settingKey: string;
  readonly requestedValue: unknown;
  readonly status: SettingChangeStatus;
  readonly reasonCode: string;
  readonly reasonText: string | null;
  readonly requestedByAdminUserId: string;
  readonly requestedAt: Date;
  readonly decidedByAdminUserId: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNotes: string | null;
  readonly appliedBefore: unknown;
  readonly appliedAfter: unknown;
}

export interface CreateSettingChangeInput {
  readonly settingKind: SettingChangeKind;
  readonly settingKey: string;
  readonly requestedValue: Record<string, unknown>;
  readonly reasonCode: string;
  readonly reasonText: string | null;
  readonly requestedByAdminUserId: string;
  /**
   * `APPLIED` cuando `dual_approval_for_sensitive_actions_enabled` esta
   * apagado: el cambio surte efecto en el acto y la solicitud nace ya decidida,
   * exactamente como hace `AdjustmentService`. Con el flag encendido -que es la
   * postura de arranque- nace `PENDING_APPROVAL` y no toca nada.
   */
  readonly status: SettingChangeStatus;
  readonly decidedByAdminUserId: string | null;
  readonly decidedAt: Date | null;
  readonly appliedBefore: Record<string, unknown> | null;
  readonly appliedAfter: Record<string, unknown> | null;
}

export interface DecideSettingChangeInput {
  readonly status: Exclude<SettingChangeStatus, "PENDING_APPROVAL">;
  readonly decidedByAdminUserId: string;
  readonly decidedAt: Date;
  readonly decisionNotes: string | null;
  readonly appliedBefore: Record<string, unknown> | null;
  readonly appliedAfter: Record<string, unknown> | null;
}

/** `Database` cubre el pool y la transaccion: leer dentro de la misma refleja el efecto. */
type Reader = Pick<Database, "select">;

async function readRulesVersion(
  db: Reader,
  promotionId: string,
  rulesVersionId: string,
): Promise<RulesVersionRow | null> {
  const [version] = await db
    .select()
    .from(promotionRulesVersions)
    .where(
      and(
        eq(promotionRulesVersions.id, rulesVersionId),
        // La version tiene que ser DE ESTA promocion. Sin la segunda condicion
        // la ruta seria un oraculo con el que leer -y editar- la configuracion
        // legal de otra promocion sabiendo solo su identificador.
        eq(promotionRulesVersions.promotionId, promotionId),
      ),
    )
    .limit(1);

  if (version === undefined) {
    return null;
  }

  const documents = await db
    .select()
    .from(promotionRulesDocuments)
    .where(eq(promotionRulesDocuments.rulesVersionId, rulesVersionId))
    .orderBy(asc(promotionRulesDocuments.locale));

  return {
    id: version.id,
    promotionId: version.promotionId,
    version: version.version,
    status: version.status,
    config: version.config,
    unresolvedRequiredKeys: version.unresolvedRequiredKeys ?? [],
    attorneyApprovalReference: version.attorneyApprovalReference,
    effectiveAt: version.effectiveAt,
    createdAt: version.createdAt,
    createdByAdminUserId: version.createdByAdminUserId,
    activatedAt: version.activatedAt,
    archivedAt: version.archivedAt,
    documents: documents.map((document) => ({
      locale: document.locale,
      title: document.title,
      body: document.body,
      isLegallyControlling: document.isLegallyControlling,
      isInformationalTranslation: document.isInformationalTranslation,
    })),
  };
}

export function createAdminRulesRepository(db: Database): AdminRulesRepository {
  return {
    async listRulesVersions(promotionId) {
      const rows = await db
        .select({ id: promotionRulesVersions.id })
        .from(promotionRulesVersions)
        .where(eq(promotionRulesVersions.promotionId, promotionId))
        // Descendente: lo primero que quiere ver quien abre la pantalla es la
        // ultima version, no la primera de hace seis meses.
        .orderBy(desc(promotionRulesVersions.version));

      const result: RulesVersionRow[] = [];
      for (const row of rows) {
        const version = await readRulesVersion(db, promotionId, row.id);
        if (version !== null) result.push(version);
      }
      return result;
    },

    findRulesVersion: (promotionId, rulesVersionId) =>
      readRulesVersion(db, promotionId, rulesVersionId),

    async createRulesVersion(input) {
      return await db.transaction(async (tx) => {
        const [highest] = await tx
          .select({ version: promotionRulesVersions.version })
          .from(promotionRulesVersions)
          .where(eq(promotionRulesVersions.promotionId, input.promotionId))
          .orderBy(desc(promotionRulesVersions.version))
          .limit(1);

        const cloned =
          input.cloneFromRulesVersionId === null
            ? null
            : await readRulesVersion(tx, input.promotionId, input.cloneFromRulesVersionId);

        // Clonar de una version que no es de esta promocion es un 404 y no una
        // copia silenciosa: mezclaria configuracion legal de dos promociones.
        if (input.cloneFromRulesVersionId !== null && cloned === null) {
          throw new RulesVersionNotFoundError(input.cloneFromRulesVersionId);
        }

        const config =
          input.config ??
          (cloned?.config as Record<string, unknown> | undefined) ??
          blankRulesConfigTemplate();

        const [created] = await tx
          .insert(promotionRulesVersions)
          .values({
            promotionId: input.promotionId,
            version: (highest?.version ?? 0) + 1,
            // Nace DRAFT SIEMPRE: activar es otra capacidad y otra ruta, con
            // motivo y step-up. Crear ya activa saltaria esa separacion.
            status: "DRAFT",
            config,
            attorneyApprovalReference: input.attorneyApprovalReference,
            createdByAdminUserId: input.createdByAdminUserId,
          })
          .returning({ id: promotionRulesVersions.id });

        if (created === undefined) throw new Error("rules_version_insert_returned_no_row");

        // Los documentos se clonan con la configuracion: una version nueva
        // creada "a partir de" la anterior sin su texto legal seria una version
        // que activar dejaria la promocion sin Reglas Oficiales publicadas.
        if (cloned !== null && cloned.documents.length > 0) {
          await tx.insert(promotionRulesDocuments).values(
            cloned.documents.map((document) => ({
              rulesVersionId: created.id,
              locale: document.locale,
              title: document.title,
              body: document.body,
              isLegallyControlling: document.isLegallyControlling,
              isInformationalTranslation: document.isInformationalTranslation,
            })),
          );
        }

        const row = await readRulesVersion(tx, input.promotionId, created.id);
        if (row === null) throw new Error("rules_version_read_after_insert_failed");
        return row;
      });
    },

    async updateRulesVersion(promotionId, rulesVersionId, input) {
      return await db.transaction(async (tx) => {
        const existing = await readRulesVersion(tx, promotionId, rulesVersionId);
        if (existing === null) return null;

        await tx
          .update(promotionRulesVersions)
          .set({
            ...(input.config === undefined ? {} : { config: input.config }),
            ...(input.attorneyApprovalReference === undefined
              ? {}
              : { attorneyApprovalReference: input.attorneyApprovalReference }),
            ...(input.effectiveAt === undefined ? {} : { effectiveAt: input.effectiveAt }),
          })
          .where(eq(promotionRulesVersions.id, rulesVersionId));

        return await readRulesVersion(tx, promotionId, rulesVersionId);
      });
    },

    async upsertRulesDocument(promotionId, rulesVersionId, input) {
      return await db.transaction(async (tx) => {
        const existing = await readRulesVersion(tx, promotionId, rulesVersionId);
        if (existing === null) return null;

        // `onConflictDoUpdate` y no un `delete` + `insert`: el indice unico por
        // (version, locale) es quien decide, no el orden de dos sentencias. Con
        // dos peticiones simultaneas del mismo locale, borrar primero abriria
        // una ventana en la que el documento no existe.
        await tx
          .insert(promotionRulesDocuments)
          .values({
            rulesVersionId,
            locale: input.locale,
            title: input.title,
            body: input.body,
            isLegallyControlling: input.isLegallyControlling,
            isInformationalTranslation: input.isInformationalTranslation,
          })
          .onConflictDoUpdate({
            target: [promotionRulesDocuments.rulesVersionId, promotionRulesDocuments.locale],
            set: {
              title: input.title,
              body: input.body,
              isLegallyControlling: input.isLegallyControlling,
              isInformationalTranslation: input.isInformationalTranslation,
              updatedAt: new Date(),
            },
          });

        return await readRulesVersion(tx, promotionId, rulesVersionId);
      });
    },

    async activateRulesVersion(promotionId, rulesVersionId, activatedByAdminUserId, now) {
      return await db.transaction(async (tx) => {
        const existing = await readRulesVersion(tx, promotionId, rulesVersionId);
        if (existing === null) return null;

        // ARCHIVAR PRIMERO. El indice unico parcial
        // `promotion_rules_versions_one_active_per_promotion` admite una sola
        // version ACTIVE por promocion: activando antes de archivar, la propia
        // transaccion chocaria contra el indice.
        await tx
          .update(promotionRulesVersions)
          .set({ status: "ARCHIVED", archivedAt: now })
          .where(
            and(
              eq(promotionRulesVersions.promotionId, promotionId),
              eq(promotionRulesVersions.status, "ACTIVE"),
            ),
          );

        await tx
          .update(promotionRulesVersions)
          .set({
            status: "ACTIVE",
            activatedAt: now,
            activatedByAdminUserId,
            // `effective_at` solo se rellena si venia sin fijar: una fecha
            // escrita a mano por el abogado manda sobre el reloj del proceso.
            ...(existing.effectiveAt === null ? { effectiveAt: now } : {}),
          })
          .where(eq(promotionRulesVersions.id, rulesVersionId));

        await tx
          .update(promotions)
          .set({ activeRulesVersionId: rulesVersionId, updatedAt: now })
          .where(eq(promotions.id, promotionId));

        return await readRulesVersion(tx, promotionId, rulesVersionId);
      });
    },

    async listFlags() {
      const [rows, settings] = await Promise.all([
        db.select().from(featureFlags).orderBy(asc(featureFlags.key)),
        db.select({ amoeMode: featureFlagSettings.amoeMode }).from(featureFlagSettings).limit(1),
      ]);

      return {
        items: rows.map((row) => ({
          key: row.key,
          enabled: row.enabled,
          isLegallyMaterial: row.isLegallyMaterial,
          dec032Default: row.dec032Default,
          legalDependency: row.legalDependency,
          updatedAt: row.updatedAt,
        })),
        amoeMode: settings[0]?.amoeMode ?? null,
      };
    },

    async updateFlag(key, enabled, reason, adminUserId) {
      // El motivo y el actor NO son opcionales, y no lo decide este archivo:
      // `lsw_feature_flags_enforce_change` (migracion `0005`, DEC-013) rechaza
      // el UPDATE sin ellos, y un trigger SECURITY DEFINER escribe la fila de
      // historico. Aqui solo se pasan.
      const updated = await db
        .update(featureFlags)
        .set({ enabled, updateReason: reason, updatedByAdminUserId: adminUserId })
        .where(eq(featureFlags.key, key))
        .returning();

      const row = updated[0];
      if (row === undefined) return null;

      return {
        key: row.key,
        enabled: row.enabled,
        isLegallyMaterial: row.isLegallyMaterial,
        dec032Default: row.dec032Default,
        legalDependency: row.legalDependency,
        updatedAt: row.updatedAt,
      };
    },

    async setAmoeMode(mode, reason, adminUserId) {
      const updated = await db
        .update(featureFlagSettings)
        .set({ amoeMode: mode, updateReason: reason, updatedByAdminUserId: adminUserId })
        .where(eq(featureFlagSettings.singleton, true))
        .returning({ amoeMode: featureFlagSettings.amoeMode });

      return updated[0]?.amoeMode ?? null;
    },

    async findOrCreateParticipantByEmail(email, preferredLocale) {
      const normalized = email.trim().toLowerCase();

      return await db.transaction(async (tx) => {
        const [found] = await tx
          .select({ participantId: participants.id })
          .from(participants)
          .innerJoin(identities, eq(identities.id, participants.identityId))
          .where(eq(identities.emailNormalized, normalized))
          .limit(1);

        if (found !== undefined) {
          return { participantId: found.participantId, created: false };
        }

        // La identidad puede existir SIN perfil de participante. En ese caso
        // se reutiliza en vez de intentar crear otra: el indice unico sobre
        // `email_normalized` lo impediria, y el fallo seria un 500 en lugar
        // de una ficha transcrita.
        const [identity] = await tx
          .select({ id: identities.id })
          .from(identities)
          .where(eq(identities.emailNormalized, normalized))
          .limit(1);

        // SALVO QUE SEA UNA CUENTA DE PERSONAL.
        //
        // Tecleando el correo de un companero -o el propio- en una ficha
        // postal se creaba un expediente de participante colgado de una
        // identidad administrativa, y con la aprobacion de otra persona esa
        // identidad acumulaba participaciones. El borrador v2 punto 1 excluye
        // a empleados y afiliados: montar ese estado en silencio, por la via
        // gratuita, es un problema de ELEGIBILIDAD y no de estilo.
        //
        // Se rechaza en vez de crear el envio marcado porque el expediente no
        // deberia llegar a existir: marcarlo dejaria la fila creada y el
        // trabajo de deshacerla para despues.
        if (identity !== undefined) {
          const [staff] = await tx
            .select({ id: adminUsers.id })
            .from(adminUsers)
            .where(eq(adminUsers.identityId, identity.id))
            .limit(1);

          if (staff !== undefined) {
            throw new StaffIdentityNotEligibleError(normalized);
          }
        }

        const identityId =
          identity?.id ??
          (
            await tx
              .insert(identities)
              .values({
                email: normalized,
                // SIN credenciales y `PENDING_VERIFICATION`: es un expediente al
                // que asignar participaciones, no una cuenta. Quien mando la
                // ficha no ha elegido ninguna contrasena.
                status: "PENDING_VERIFICATION",
              })
              .returning({ id: identities.id })
          )[0]?.id;

        if (identityId === undefined) throw new Error("identity_insert_returned_no_row");

        const [participant] = await tx
          .insert(participants)
          .values({ identityId, preferredLocale })
          .returning({ id: participants.id });

        if (participant === undefined) throw new Error("participant_insert_returned_no_row");
        return { participantId: participant.id, created: true };
      });
    },

    async listSettingChangeRequests({ status, limit, after }) {
      const conditions = [];
      if (status !== null) {
        conditions.push(eq(settingChangeRequests.status, status));
      }
      if (after !== null) {
        conditions.push(gt(settingChangeRequests.id, after));
      }

      const rows = await db
        .select()
        .from(settingChangeRequests)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        // Por `id` y no por fecha: dos solicitudes del mismo instante se
        // saltarian o se repetirian entre paginas ordenando por `requested_at`.
        .orderBy(asc(settingChangeRequests.id))
        .limit(limit);

      return rows.map(toSettingChangeRequest);
    },

    async findSettingChangeRequest(id) {
      const [row] = await db
        .select()
        .from(settingChangeRequests)
        .where(eq(settingChangeRequests.id, id))
        .limit(1);
      return row === undefined ? null : toSettingChangeRequest(row);
    },

    async createSettingChangeRequest(input) {
      const [created] = await db
        .insert(settingChangeRequests)
        .values({
          settingKind: input.settingKind,
          settingKey: input.settingKey,
          requestedValue: input.requestedValue,
          status: input.status,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          requestedByAdminUserId: input.requestedByAdminUserId,
          decidedByAdminUserId: input.decidedByAdminUserId,
          decidedAt: input.decidedAt,
          appliedBefore: input.appliedBefore,
          appliedAfter: input.appliedAfter,
        })
        .returning();

      if (created === undefined) throw new Error("setting_change_insert_returned_no_row");
      return toSettingChangeRequest(created);
    },

    async decideSettingChangeRequest(id, input) {
      const updated = await db
        .update(settingChangeRequests)
        .set({
          status: input.status,
          decidedByAdminUserId: input.decidedByAdminUserId,
          decidedAt: input.decidedAt,
          decisionNotes: input.decisionNotes,
          appliedBefore: input.appliedBefore,
          appliedAfter: input.appliedAfter,
        })
        // Solo desde `PENDING_APPROVAL`: sin esta condicion, dos aprobaciones
        // simultaneas aplicarian el cambio dos veces. La segunda no encuentra
        // fila y quien llama lo traduce a "ya no es decidible".
        .where(
          and(
            eq(settingChangeRequests.id, id),
            eq(settingChangeRequests.status, "PENDING_APPROVAL"),
          ),
        )
        .returning();

      const row = updated[0];
      return row === undefined ? null : toSettingChangeRequest(row);
    },

    async findPendingSettingChangeRequest(kind, key) {
      const [row] = await db
        .select()
        .from(settingChangeRequests)
        .where(
          and(
            eq(settingChangeRequests.settingKind, kind),
            eq(settingChangeRequests.settingKey, key),
            eq(settingChangeRequests.status, "PENDING_APPROVAL"),
          ),
        )
        .orderBy(desc(settingChangeRequests.requestedAt))
        .limit(1);

      return row === undefined ? null : toSettingChangeRequest(row);
    },
  };
}

function toSettingChangeRequest(
  row: typeof settingChangeRequests.$inferSelect,
): SettingChangeRequestRow {
  return {
    id: row.id,
    settingKind: row.settingKind,
    settingKey: row.settingKey,
    requestedValue: row.requestedValue,
    status: row.status,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    requestedByAdminUserId: row.requestedByAdminUserId,
    requestedAt: row.requestedAt,
    decidedByAdminUserId: row.decidedByAdminUserId,
    decidedAt: row.decidedAt,
    decisionNotes: row.decisionNotes,
    appliedBefore: row.appliedBefore,
    appliedAfter: row.appliedAfter,
  };
}

/**
 * El correo de la ficha pertenece a una cuenta de PERSONAL.
 *
 * Las Official Rules excluyen a empleados y afiliados, asi que no se le
 * cuelga un expediente de participante a una identidad administrativa. Es un
 * 409 con codigo propio y no un 500: quien transcribe puede corregir el dato.
 */
export class StaffIdentityNotEligibleError extends Error {
  public readonly email: string;

  public constructor(email: string) {
    super("AMOE_PARTICIPANT_INELIGIBLE_STAFF");
    this.name = "StaffIdentityNotEligibleError";
    this.email = email;
  }
}

/** Clonar de una version inexistente -o de otra promocion- es un 404, no una copia vacia. */
export class RulesVersionNotFoundError extends Error {
  public readonly rulesVersionId: string;

  public constructor(rulesVersionId: string) {
    super("RULES_VERSION_NOT_FOUND");
    this.name = "RulesVersionNotFoundError";
    this.rulesVersionId = rulesVersionId;
  }
}

/**
 * Cuenta cuantas promociones hay con esa version activa. Solo para tests de
 * integracion; la API no la usa.
 */
export function activeRulesVersionCount(db: Database, promotionId: string): Promise<number> {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(promotionRulesVersions)
    .where(
      and(
        eq(promotionRulesVersions.promotionId, promotionId),
        eq(promotionRulesVersions.status, "ACTIVE"),
      ),
    )
    .then((rows) => rows[0]?.total ?? 0);
}
