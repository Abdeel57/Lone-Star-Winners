/**
 * Versiones de reglas, periodos bonus, feature flags y control dual de los
 * ajustes legalmente materiales (DEC-012, DEC-032, DEC-054; contrato 13.7 a
 * 13.9).
 *
 * ---------------------------------------------------------------------------
 * RUTAS
 * ---------------------------------------------------------------------------
 *
 *   GET   /admin/promotions/:id/rules-versions ................ `rules.version.read`
 *   POST  /admin/promotions/:id/rules-versions ................ `rules.version.create`
 *   GET   /admin/promotions/:id/rules-versions/:rv ............ `rules.version.read`
 *   PATCH /admin/promotions/:id/rules-versions/:rv ............ `rules.version.create`
 *   PUT   /admin/promotions/:id/rules-versions/:rv/documents/:locale  `rules.version.create`
 *   POST  /admin/promotions/:id/rules-versions/:rv/activate ... `rules.version.activate`  motivo + step-up
 *   POST  /admin/promotions/:id/bonus-periods ................. `rules.version.activate`  motivo + step-up
 *
 *   GET   /admin/feature-flags ................................ `flag.read`
 *   PATCH /admin/feature-flags/:key ........................... `flag.update`             motivo
 *
 *   POST  /admin/settings/change-requests ..................... `flag.update.legally_material`  motivo + step-up
 *   GET   /admin/settings/change-requests ..................... `flag.read`
 *   POST  /admin/settings/change-requests/:id/approve ......... `flag.update.legally_material`  motivo + step-up
 *   POST  /admin/settings/change-requests/:id/reject .......... `flag.update.legally_material`  motivo + step-up
 *
 * ---------------------------------------------------------------------------
 * POR QUE DOS RUTAS PARA CAMBIAR UN AJUSTE Y NO UNA
 * ---------------------------------------------------------------------------
 *
 * Porque el autorizador decide con la capacidad DECLARADA por la ruta, y eso es
 * estatico. Con una sola ruta `PATCH /admin/feature-flags/:key`, la capacidad
 * correcta dependeria de la clave que viniera en la url -`flag.update` para las
 * no materiales, `flag.update.legally_material` para las demas- y la puerta
 * tendria que adivinarla antes de conocerla. Declarar la debil y comprobar
 * despues significaria que un flag material se cambia sin step-up.
 *
 * Asi que hay dos caminos: el PATCH para lo no material, y una SOLICITUD para
 * lo material y para `amoe_mode`. Quien se equivoque de camino recibe un 409
 * `FLAG_REQUIRES_CHANGE_REQUEST` que dice a donde ir, sin tocar nada.
 *
 * ---------------------------------------------------------------------------
 * CONTROL DUAL: MISMO PATRON QUE LOS AJUSTES MANUALES
 * ---------------------------------------------------------------------------
 *
 * `flag.update.legally_material` declara `requiresSecondApproval`, y una
 * capacidad asi se deniega en la puerta salvo que la ruta nombre DONDE se
 * impone. Los dos sitios que la imponen de verdad:
 *
 *   - este archivo, que rechaza la auto-aprobacion antes de aplicar nada;
 *   - `CONSTRAINT setting_change_requests_approver_differs` de la migracion
 *     `0028`, que lo impide aunque la aplicacion fallara.
 *
 * LA SOLICITUD NACE SIEMPRE `PENDING_APPROVAL`, con el flag encendido o
 * apagado (S-02). `flag.update.legally_material` es CRITICAL y exige segunda
 * aprobacion siempre; `packages/security/src/flags.ts` dice que apagar
 * `dual_approval_for_sensitive_actions_enabled` NO relaja esa exigencia, solo
 * puede anadirla en mas sitios. Ese flag, ademas, solo se cambia por esta misma
 * cola: desarmar el control dual cuesta control dual.
 *
 * ---------------------------------------------------------------------------
 * AQUI NO SE RELLENA NINGUNA CLAVE LEGAL
 * ---------------------------------------------------------------------------
 *
 * La validacion de `config` es POR REBANADAS y solo comprueba lo que el dominio
 * sabe parsear. Lo que falta se devuelve como problema con su `path`; la API no
 * completa nada (principio 2). Y quien impide activar una version con claves
 * sin resolver sigue siendo el trigger de DEC-012, no este archivo.
 */

import {
  amoeConfigSchema,
  bonusRulesSchema,
  calculationConfigSchema,
  multiplierConfigSchema,
  readBonusRules,
  BonusRulesConfigError,
  type AmoeMode,
  type JsonValue,
} from "@lsw/sweepstakes";
/**
 * QUE AJUSTES EXIGEN PASAR POR LA COLA DE SOLICITUDES LO DECIDE EL CATALOGO (S-02).
 *
 * `flagRequiresDualControl` cubre las dos clases: los flags legalmente
 * materiales y `dual_approval_for_sensitive_actions_enabled`, que no lo es -no
 * cambia lo que se le promete al participante- pero es el interruptor que arma
 * el control dual de todo lo demas. Desarmar el control dual tiene que costar
 * control dual.
 *
 * Se importa en vez de repetirse. Este archivo llego a llevar su propia copia
 * de esa regla, con la clave escrita a mano, mientras `@lsw/security` publicaba
 * la suya: dos listas para una sola pregunta divergen en cuanto alguien anada
 * un flag a una y no a la otra, y la que se quedaria corta es siempre la copia.
 */
import { FEATURE_FLAGS, flagRequiresDualControl } from "@lsw/security";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { requireReasonCode } from "../http/authorization-inputs.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "../http/feature-flag-catalog.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import { requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { domainServicesFor } from "../services/domain-registry.js";
import {
  createAdminRulesRepository,
  RulesVersionNotFoundError,
  type AdminRulesRepository,
  type RulesVersionRow,
  type SettingChangeRequestRow,
} from "../services/admin-rules.js";

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const promotionParamsSchema = z.object({ promotion_id: z.uuid() });
const rulesVersionParamsSchema = z.object({
  promotion_id: z.uuid(),
  rules_version_id: z.uuid(),
});
const documentParamsSchema = z.object({
  promotion_id: z.uuid(),
  rules_version_id: z.uuid(),
  locale: z.enum(["en-US", "es-US"]),
});
const flagParamsSchema = z.object({ key: z.enum(FEATURE_FLAG_KEYS) });
const changeRequestParamsSchema = z.object({ change_request_id: z.uuid() });

/**
 * `config` es un objeto libre a proposito.
 *
 * Las Official Rules contienen muchas mas claves de las que el dominio sabe
 * parsear -jurisdicciones, edad, documentos, textos-, y tiparlas aqui seria
 * inventar la forma de un documento que escribe el abogado. Lo que SI se
 * comprueba son las rebanadas que el dominio conoce; ver `validateConfig`.
 */
const rulesConfigSchema = z.record(z.string(), z.unknown());

const createRulesVersionBodySchema = z.object({
  clone_from_rules_version_id: z.uuid().optional(),
  config: rulesConfigSchema.optional(),
  attorney_approval_reference: z.string().min(1).max(200).nullable().default(null),
});

const updateRulesVersionBodySchema = z
  .object({
    config: rulesConfigSchema.optional(),
    attorney_approval_reference: z.string().min(1).max(200).nullable().optional(),
    effective_at: z.iso.datetime().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Un PATCH sin ningun campo no es una edicion.",
  });

const rulesDocumentBodySchema = z.object({
  title: z.string().min(1).max(300),
  /**
   * El texto legal. No hay tope pequeno: unas Official Rules completas ocupan
   * decenas de miles de caracteres, y recortarlas seria publicar un documento
   * distinto del que aprobo el abogado.
   */
  body: z.string().min(1).max(200000),
  is_legally_controlling: z.boolean(),
  is_informational_translation: z.boolean(),
});

/**
 * Motivo obligatorio, en la forma que se persiste en `audit_events.reason_code`.
 *
 * ---------------------------------------------------------------------------
 * OPCIONAL EN EL ESQUEMA, EXIGIDO POR EL AUTORIZADOR
 * ---------------------------------------------------------------------------
 *
 * Quien exige el motivo es la PUERTA, no este esquema: el catalogo de
 * `@lsw/security` marca estas capacidades con `requiresReason`, y `authorize()`
 * las deniega sin el (HO-034.1). El motivo viaja en el cuerpo porque es el
 * canal que publica el contrato y el que acaba en el `AuditEvent`.
 *
 * Declararlo obligatorio AQUI rompia esa cadena: Fastify valida el cuerpo antes
 * del `preHandler`, asi que una peticion sin motivo moria con 422
 * VALIDATION_FAILED y nunca llegaba al control. El efecto practico era que un
 * fallo de AUTORIZACION -"esta operacion exige que digas por que"- se presentaba
 * como un cuerpo mal formado, y el operador no tenia forma de distinguirlo de
 * una errata. Es la misma correccion que ya se hizo en la ruta de aprobacion
 * AMOE por el motivo simetrico.
 *
 * LA FORMA SI SE VALIDA. Un `reason_code` presente pero con otra ortografia
 * sigue siendo 422: la puerta busca exactamente el patron que se persiste en
 * `audit_events.reason_code`, y aceptar aqui lo que alli no cabe dejaria pasar
 * una operacion cuyo motivo no se puede escribir en la traza.
 */
const reasonBodySchema = z.object({
  reason_code: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u)
    .optional(),
  reason_text: z.string().max(2000).nullable().default(null),
});

const bonusPeriodBodySchema = reasonBodySchema.extend({
  multiplier: z.object({
    numerator: z.number().int().min(0),
    denominator: z.number().int().min(1),
  }),
  starts_at: z.iso.datetime(),
  ends_at: z.iso.datetime(),
  product_kind_scope: z
    .array(z.enum(["MERCHANDISE", "ENTRY_PACKAGE"]))
    .min(1)
    .nullable(),
  sku_scope: z.array(z.string().min(1)).min(1).nullable(),
  /**
   * La estrategia de conflicto, SI la version activa no la declara todavia.
   *
   * No se supone ninguna: la eleccion cambia lo que recibe el participante
   * cuando dos periodos se solapan, y un motor que "apila porque es lo natural"
   * estaria decidiendo una regla promocional por su cuenta.
   */
  conflict_strategy: z
    .enum(["STACK", "HIGHEST_WINS", "EXCLUSIVE", "PRIORITY_ORDER"])
    .nullable()
    .default(null),
});

const updateFlagBodySchema = reasonBodySchema.extend({ enabled: z.boolean() });

const createChangeRequestBodySchema = reasonBodySchema
  .extend({
    setting_kind: z.enum(["FEATURE_FLAG", "AMOE_MODE"]),
    setting_key: z.string().min(1).max(100),
    enabled: z.boolean().optional(),
    amoe_mode: z
      .enum(["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"])
      .nullable()
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.setting_kind === "FEATURE_FLAG" && body.enabled === undefined) {
      ctx.addIssue({ code: "custom", path: ["enabled"], message: "required_for_feature_flag" });
    }
    if (body.setting_kind === "AMOE_MODE" && body.amoe_mode === undefined) {
      ctx.addIssue({ code: "custom", path: ["amoe_mode"], message: "required_for_amoe_mode" });
    }
  });

const decideChangeRequestBodySchema = reasonBodySchema.extend({
  notes: z.string().max(2000).nullable().default(null),
});

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

const validationSliceSchema = z.enum(["OK", "INVALID", "UNRESOLVED", "ABSENT"]);

const rulesVersionSchema = z.object({
  id: z.uuid(),
  promotion_id: z.uuid(),
  version: z.number().int(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  config: z.record(z.string(), z.unknown()),
  /** Columna GENERADA por PostgreSQL. La aplicacion no la puede escribir. */
  unresolved_required_keys: z.array(z.string()),
  /**
   * Si ESTA version se puede activar ahora mismo. Tres condiciones a la vez:
   *
   *   1. `unresolved_required_keys` vacia -lo dice PostgreSQL, no la API-;
   *   2. ninguna rebanada `INVALID` en `validation`;
   *   3. `status === "DRAFT"`: una `ACTIVE` ya lo esta y una `ARCHIVED` no vuelve.
   *
   * Es un ATAJO DE PRESENTACION, no el control. Quien impide activar de verdad
   * sigue siendo el trigger de DEC-012, y por eso el panel puede fiarse de este
   * campo para pintar un boton pero nunca para dar por hecho el resultado: si
   * la version cambia entre la lectura y la pulsacion, manda el motor.
   */
  activatable: z.boolean(),
  /**
   * Que dice el DOMINIO de cada rebanada que sabe parsear. No es una opinion de
   * la API: es el resultado de aplicar los mismos esquemas que usara el motor.
   */
  validation: z.object({
    calculation: validationSliceSchema,
    amoe: validationSliceSchema,
    bonus_rules: validationSliceSchema,
    issues: z.array(z.object({ path: z.string(), code: z.string() })),
  }),
  attorney_approval_reference: z.string().nullable(),
  effective_at: z.string().nullable(),
  created_at: z.string(),
  created_by_admin_user_id: z.uuid().nullable(),
  activated_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  documents: z.array(
    z.object({
      locale: z.enum(["en-US", "es-US"]),
      title: z.string(),
      body: z.string(),
      is_legally_controlling: z.boolean(),
      is_informational_translation: z.boolean(),
    }),
  ),
});

/** El atajo bonus devuelve la version nueva MAS lo que el operador debe saber. */
const bonusPeriodResultSchema = rulesVersionSchema.extend({
  /**
   * Avisos que no impiden la operacion pero cambian su efecto. El caso real: el
   * bonus queda escrito y NO se aplica porque `entry_multipliers_enabled` esta
   * apagado. Callarlo dejaria a alguien esperando un 5X que no llega.
   */
  warnings: z.array(z.string()),
});

const featureFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  is_legally_material: z.boolean(),
  dec032_default: z.boolean(),
  legal_dependency: z.string().nullable(),
  updated_at: z.string(),
  /**
   * Solicitud de cambio PENDIENTE que afecta a este ajuste, si la hay.
   *
   * El panel la necesita para no ofrecer un interruptor que va a chocar con una
   * solicitud ya abierta, y para poder enlazar con ella. `null` no significa
   * "nunca hubo": significa "ahora mismo no hay ninguna sin decidir".
   */
  pending_change_request_id: z.uuid().nullable(),
});

const featureFlagsResponseSchema = z.object({
  items: z.array(featureFlagSchema),
  amoe_mode: z.enum(["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"]).nullable(),
  /** Igual que en las filas, para el ajuste `amoe_mode`, que no es un flag. */
  amoe_mode_pending_change_request_id: z.uuid().nullable(),
});

const changeRequestSchema = z.object({
  id: z.uuid(),
  setting_kind: z.enum(["FEATURE_FLAG", "AMOE_MODE"]),
  setting_key: z.string(),
  requested_value: z.record(z.string(), z.unknown()),
  status: z.enum(["PENDING_APPROVAL", "APPLIED", "REJECTED"]),
  reason_code: z.string(),
  reason_text: z.string().nullable(),
  requested_by_admin_user_id: z.uuid(),
  /**
   * `true` si la pidio QUIEN ESTA MIRANDO.
   *
   * Un booleano y no el identificador del actor en la sesion: el panel solo
   * necesita saber si puede aprobar ESTA fila, y repartir identificadores de
   * cuentas administrativas por una respuesta de listado es regalar el mapa del
   * equipo. Con esto la pantalla deshabilita el boton con conocimiento de causa
   * en vez de mandar a alguien contra un 409 evitable; el 409
   * `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` sigue siendo el control.
   */
  requested_by_me: z.boolean(),
  requested_at: z.string(),
  decided_by_admin_user_id: z.uuid().nullable(),
  decided_at: z.string().nullable(),
  decision_notes: z.string().nullable(),
  applied_before: z.record(z.string(), z.unknown()).nullable(),
  applied_after: z.record(z.string(), z.unknown()).nullable(),
});

// ---------------------------------------------------------------------------
// Validacion por rebanadas
// ---------------------------------------------------------------------------

type SliceState = z.infer<typeof validationSliceSchema>;

interface ConfigValidation {
  readonly calculation: SliceState;
  readonly amoe: SliceState;
  readonly bonus_rules: SliceState;
  readonly issues: readonly { readonly path: string; readonly code: string }[];
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Valida SOLO lo que el dominio sabe parsear, y solo cuando esta presente.
 *
 * Una clave en `"TBD"` no es un error: es el estado honesto de algo que el
 * abogado todavia no ha respondido, y quien impide activar con ella es el
 * trigger de DEC-012. Lo que si es un error es una rebanada PRESENTE y mal
 * formada, porque el motor no podria ejecutarla.
 */
function validateConfig(config: unknown): ConfigValidation {
  const issues: { path: string; code: string }[] = [];
  const record =
    typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};

  let calculation: SliceState = "OK";
  const unresolvedCalculation = ["product_eligibility", "purchase_entry_formula", "entry_limits"]
    .map((key) => record[key])
    .some((value) => value === undefined || value === "TBD");

  if (unresolvedCalculation) {
    calculation = "UNRESOLVED";
  } else {
    const parsed = calculationConfigSchema.safeParse(config);
    if (!parsed.success) {
      calculation = "INVALID";
      for (const issue of parsed.error.issues) {
        issues.push({ path: issuePath(issue.path), code: issue.code });
      }
    }
  }

  let amoe: SliceState = "ABSENT";
  const rawAmoe = record.amoe;
  if (rawAmoe !== undefined && rawAmoe !== null && rawAmoe !== "TBD") {
    const parsed = amoeConfigSchema.safeParse(rawAmoe);
    amoe = parsed.success ? "OK" : "INVALID";
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: `amoe.${issuePath(issue.path)}`, code: issue.code });
      }
    }
  }

  let bonus: SliceState = "ABSENT";
  const rawBonus = record.bonus_rules;
  if (rawBonus !== undefined && rawBonus !== null && rawBonus !== "TBD") {
    const parsed = bonusRulesSchema.safeParse(rawBonus);
    bonus = parsed.success ? "OK" : "INVALID";
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: `bonus_rules.${issuePath(issue.path)}`, code: issue.code });
      }
    }
  }

  return { calculation, amoe, bonus_rules: bonus, issues };
}

function presentRulesVersion(row: RulesVersionRow): z.infer<typeof rulesVersionSchema> {
  const validation = validateConfig(row.config);
  return {
    id: row.id,
    promotion_id: row.promotionId,
    version: row.version,
    status: row.status,
    config: (typeof row.config === "object" && row.config !== null ? row.config : {}) as Record<
      string,
      unknown
    >,
    unresolved_required_keys: [...row.unresolvedRequiredKeys],
    activatable:
      row.status === "DRAFT" &&
      row.unresolvedRequiredKeys.length === 0 &&
      validation.calculation !== "INVALID" &&
      validation.amoe !== "INVALID" &&
      validation.bonus_rules !== "INVALID",
    validation: {
      calculation: validation.calculation,
      amoe: validation.amoe,
      bonus_rules: validation.bonus_rules,
      issues: validation.issues.map((issue) => ({ path: issue.path, code: issue.code })),
    },
    attorney_approval_reference: row.attorneyApprovalReference,
    effective_at: row.effectiveAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    created_by_admin_user_id: row.createdByAdminUserId,
    activated_at: row.activatedAt?.toISOString() ?? null,
    archived_at: row.archivedAt?.toISOString() ?? null,
    documents: row.documents.map((document) => ({
      locale: document.locale,
      title: document.title,
      body: document.body,
      is_legally_controlling: document.isLegallyControlling,
      is_informational_translation: document.isInformationalTranslation,
    })),
  };
}

function presentChangeRequest(
  row: SettingChangeRequestRow,
  /** El administrador de la sesion, para resolver `requested_by_me`. */
  viewerAdminUserId: string,
): z.infer<typeof changeRequestSchema> {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

  return {
    id: row.id,
    setting_kind: row.settingKind,
    setting_key: row.settingKey,
    requested_value: asRecord(row.requestedValue) ?? {},
    status: row.status,
    reason_code: row.reasonCode,
    reason_text: row.reasonText,
    requested_by_admin_user_id: row.requestedByAdminUserId,
    requested_by_me: row.requestedByAdminUserId === viewerAdminUserId,
    requested_at: row.requestedAt.toISOString(),
    decided_by_admin_user_id: row.decidedByAdminUserId,
    decided_at: row.decidedAt?.toISOString() ?? null,
    decision_notes: row.decisionNotes,
    applied_before: asRecord(row.appliedBefore),
    applied_after: asRecord(row.appliedAfter),
  };
}

/** El mensaje del motor viaja en `details`, nunca en el codigo: el codigo es contrato. */
function translateLifecycleError(error: unknown): never {
  const code = pgCode(error);
  if (code === "55006" || code === "23514" || code === "22023" || code === "23505") {
    throw new ApiError({
      statusCode: 409,
      code: "LIFECYCLE_REFUSED",
      details: { engine: pgMessage(error) },
    });
  }
  throw error;
}

function pgField(error: unknown, field: "code" | "message"): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const value: unknown = (current as Record<string, unknown>)[field];
    if (field === "code" && typeof value === "string") return value;
    if (field === "message" && typeof value === "string" && !value.startsWith("Failed query")) {
      return value;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const pgCode = (error: unknown): string | null => pgField(error, "code");
const pgMessage = (error: unknown): string | null => pgField(error, "message");

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function buildAdminRulesRoutes(dependencies: AppDependencies): RouteDefinition[] {
  /** Perezoso: el emisor del contrato construye las rutas sin base de datos. */
  let repository: AdminRulesRepository | null = null;
  const repo = (): AdminRulesRepository => {
    repository ??= createAdminRulesRepository(dependencies.database.db);
    return repository;
  };

  /**
   * El valor VIGENTE del ajuste, para poder congelarlo como `applied_before`.
   *
   * Se lee en el momento de aplicar y no al solicitar: entre una cosa y otra
   * puede haber pasado cualquier cosa, y un "antes" leido hace dos dias no
   * describe el cambio que se acaba de hacer.
   */
  async function currentSettingValue(
    row: SettingChangeRequestRow,
  ): Promise<Record<string, unknown>> {
    const flags = await repo().listFlags();
    if (row.settingKind === "AMOE_MODE") {
      return { amoe_mode: flags.amoeMode };
    }
    const flag = flags.items.find((candidate) => candidate.key === row.settingKey);
    return { enabled: flag?.enabled ?? null };
  }

  /**
   * Aplica el cambio solicitado. Devuelve el estado ANTES.
   *
   * `amoe_mode` se vuelve a validar contra la version de reglas ACTIVA en el
   * momento de aplicar, no al solicitar: entre las dos cosas puede publicarse
   * una version nueva, y las dos fuentes tienen que coincidir (ver
   * `AmoeService.readConfig`).
   */
  async function applySettingChange(
    row: SettingChangeRequestRow,
    adminUserId: string,
  ): Promise<Record<string, unknown>> {
    const before = await currentSettingValue(row);
    const value = (
      typeof row.requestedValue === "object" && row.requestedValue !== null
        ? row.requestedValue
        : {}
    ) as Record<string, unknown>;

    if (row.settingKind === "AMOE_MODE") {
      const mode = (value.amoe_mode ?? null) as AmoeMode | null;
      await repo().setAmoeMode(mode, row.reasonCode, adminUserId);
      return before;
    }

    const enabled = value.enabled === true;
    const updated = await repo().updateFlag(
      row.settingKey as FeatureFlagKey,
      enabled,
      row.reasonCode,
      adminUserId,
    );
    if (updated === null) {
      throw ApiErrors.notFound();
    }
    return before;
  }

  return [
    {
      method: "GET",
      url: "/api/v1/admin/promotions/:promotion_id/rules-versions",
      operationId: "listRulesVersions",
      summary: "Versiones de reglas de una promocion, de la mas reciente a la mas antigua.",
      description:
        "Incluye borradores. Un borrador es texto legal todavia no aprobado por el abogado, y por eso `rules.version.read` es una capacidad SENSIBLE y no rutinaria.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.read" },
      schema: {
        params: promotionParamsSchema,
        response: {
          200: z.object({ items: z.array(rulesVersionSchema) }),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const rows = await repo().listRulesVersions(params.promotion_id);
        return { items: rows.map(presentRulesVersion) };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/rules-versions",
      operationId: "createRulesVersion",
      summary: "Crear un borrador de version de reglas, vacio o clonado.",
      description:
        "Sin `clone_from_rules_version_id`, la `config` nace con TODAS las claves requeridas en `TBD`: es el estado honesto de algo que nadie ha respondido, y lo que `lsw_unresolved_required_keys` cuenta para impedir la activacion. La API no rellena ningun valor legal.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.create" },
      schema: {
        params: promotionParamsSchema,
        body: createRulesVersionBodySchema,
        response: {
          201: rulesVersionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const body = request.body as z.infer<typeof createRulesVersionBodySchema>;
        const domain = domainServicesFor(dependencies);

        if (body.config !== undefined) {
          assertConfigValid(body.config);
        }

        try {
          const created = await repo().createRulesVersion({
            promotionId: params.promotion_id,
            cloneFromRulesVersionId: body.clone_from_rules_version_id ?? null,
            config: body.config ?? null,
            attorneyApprovalReference: body.attorney_approval_reference,
            createdByAdminUserId: staff.adminUserId,
          });

          await domain.audit.emit({
            action: "rules.version.created",
            actor: { type: "ADMIN", adminUserId: staff.adminUserId },
            promotionId: params.promotion_id,
            targetEntityType: "PromotionRulesVersion",
            targetEntityId: created.id,
            reasonKey: null,
            reasonDetail: null,
            occurredAt: new Date(),
            metadata: {
              version: created.version,
              cloned_from_rules_version_id: body.clone_from_rules_version_id ?? null,
              // Las CLAVES, no el contenido: la configuracion legal entera
              // puede ocupar decenas de miles de caracteres y acabaria en el
              // preimage de la hash chain de cada evento. Lo que un auditor
              // necesita saber es que se redacto, y el contenido esta en la
              // propia version, que es inmutable en cuanto se activa.
              config_keys: Object.keys(
                (created.config as Record<string, unknown> | null) ?? {},
              ).sort(),
              unresolved_required_keys: [...created.unresolvedRequiredKeys],
            },
          });

          void reply.code(201);
          return presentRulesVersion(created);
        } catch (error) {
          if (error instanceof RulesVersionNotFoundError) {
            throw ApiErrors.notFound();
          }
          return translateLifecycleError(error);
        }
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/promotions/:promotion_id/rules-versions/:rules_version_id",
      operationId: "getRulesVersion",
      summary: "Una version de reglas con su configuracion y sus documentos.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.read" },
      schema: {
        params: rulesVersionParamsSchema,
        response: {
          200: rulesVersionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof rulesVersionParamsSchema>;
        const row = await repo().findRulesVersion(params.promotion_id, params.rules_version_id);
        if (row === null) throw ApiErrors.notFound();
        return presentRulesVersion(row);
      },
    },

    {
      method: "PATCH",
      url: "/api/v1/admin/promotions/:promotion_id/rules-versions/:rules_version_id",
      operationId: "updateRulesVersion",
      summary: "Editar un borrador de version de reglas.",
      description:
        "Solo `DRAFT`. Que una version ACTIVE no se pueda tocar lo impone el trigger `lsw_rules_versions_enforce_immutability` (DEC-012), no este handler: aqui solo se traduce su negativa a un 409 que lleva SU mensaje.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.create" },
      schema: {
        params: rulesVersionParamsSchema,
        body: updateRulesVersionBodySchema,
        response: {
          200: rulesVersionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof rulesVersionParamsSchema>;
        const body = request.body as z.infer<typeof updateRulesVersionBodySchema>;
        const domain = domainServicesFor(dependencies);

        if (body.config !== undefined) {
          assertConfigValid(body.config);
        }

        // El ANTES se lee antes de escribir: despues ya no existe.
        const previous = await repo().findRulesVersion(
          params.promotion_id,
          params.rules_version_id,
        );
        const previousConfigKeys = Object.keys(
          (previous?.config as Record<string, unknown> | null) ?? {},
        ).sort();

        try {
          const updated = await repo().updateRulesVersion(
            params.promotion_id,
            params.rules_version_id,
            {
              ...(body.config === undefined ? {} : { config: body.config }),
              ...(body.attorney_approval_reference === undefined
                ? {}
                : { attorneyApprovalReference: body.attorney_approval_reference }),
              ...(body.effective_at === undefined
                ? {}
                : {
                    effectiveAt: body.effective_at === null ? null : new Date(body.effective_at),
                  }),
            },
          );

          if (updated === null) throw ApiErrors.notFound();

          // QUE cambio, no el config entero. Un DRAFT es mutable y es el texto
          // que despues pasa a ser legalmente controlante: sin evento no se
          // puede reconstruir que se toco en el borrador ni quien lo toco,
          // solo quien lo creo.
          await domain.audit.emit({
            action: "rules.version.updated",
            actor: { type: "ADMIN", adminUserId: staff.adminUserId },
            promotionId: params.promotion_id,
            targetEntityType: "PromotionRulesVersion",
            targetEntityId: updated.id,
            reasonKey: null,
            reasonDetail: null,
            occurredAt: new Date(),
            metadata: {
              version: updated.version,
              changed_fields: Object.keys(body).sort(),
              config_keys_before: previousConfigKeys,
              config_keys_after: Object.keys(
                (updated.config as Record<string, unknown> | null) ?? {},
              ).sort(),
              unresolved_required_keys: [...updated.unresolvedRequiredKeys],
            },
          });

          return presentRulesVersion(updated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateLifecycleError(error);
        }
      },
    },

    {
      method: "PUT",
      url: "/api/v1/admin/promotions/:promotion_id/rules-versions/:rules_version_id/documents/:locale",
      operationId: "putRulesVersionDocument",
      summary: "Redactar el texto legal de una version en un idioma.",
      description:
        "PUT y no PATCH: el texto legal se sustituye entero, nunca por partes. Solo mientras la version es `DRAFT`; en cuanto se activa, el trigger de `0002` congela el documento que vera el participante.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.create" },
      schema: {
        params: documentParamsSchema,
        body: rulesDocumentBodySchema,
        response: {
          200: rulesVersionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof documentParamsSchema>;
        const body = request.body as z.infer<typeof rulesDocumentBodySchema>;
        const domain = domainServicesFor(dependencies);

        try {
          const updated = await repo().upsertRulesDocument(
            params.promotion_id,
            params.rules_version_id,
            {
              locale: params.locale,
              title: body.title,
              body: body.body,
              isLegallyControlling: body.is_legally_controlling,
              isInformationalTranslation: body.is_informational_translation,
            },
          );

          if (updated === null) throw ApiErrors.notFound();

          // El TEXTO no entra en la metadata: son decenas de miles de
          // caracteres y acabarian en el preimage de la hash chain. Lo que se
          // registra es que se redacto ese locale y con que marcas legales.
          await domain.audit.emit({
            action: "rules.version.document_upserted",
            actor: { type: "ADMIN", adminUserId: staff.adminUserId },
            promotionId: params.promotion_id,
            targetEntityType: "PromotionRulesVersion",
            targetEntityId: updated.id,
            reasonKey: null,
            reasonDetail: null,
            occurredAt: new Date(),
            metadata: {
              version: updated.version,
              locale: params.locale,
              title: body.title,
              body_length: body.body.length,
              is_legally_controlling: body.is_legally_controlling,
              is_informational_translation: body.is_informational_translation,
            },
          });

          return presentRulesVersion(updated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateLifecycleError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/rules-versions/:rules_version_id/activate",
      operationId: "activateRulesVersion",
      summary: "Activar una version de reglas. Archiva la anterior.",
      description:
        "En UNA transaccion: archiva la ACTIVE anterior, activa esta y escribe `promotions.active_rules_version_id`. NO cambia el estado de la promocion. El trigger de DEC-012 se niega si quedan claves legales sin resolver, y su mensaje viaja en `details.engine`.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.activate" },
      schema: {
        params: rulesVersionParamsSchema,
        body: reasonBodySchema,
        response: {
          200: rulesVersionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof rulesVersionParamsSchema>;
        const body = request.body as z.infer<typeof reasonBodySchema>;
        const domain = domainServicesFor(dependencies);
        const now = new Date();
        // ANTES de activar nada: si faltara el motivo, la negativa tiene que
        // ocurrir sin haber tocado la version de reglas.
        const reasonCode = requireReasonCode(body.reason_code);

        try {
          const activated = await repo().activateRulesVersion(
            params.promotion_id,
            params.rules_version_id,
            staff.adminUserId,
            now,
          );
          if (activated === null) throw ApiErrors.notFound();

          await domain.audit.emit({
            action: "rules.version.activated",
            actor: { type: "ADMIN", adminUserId: staff.adminUserId },
            promotionId: params.promotion_id,
            targetEntityType: "PromotionRulesVersion",
            targetEntityId: activated.id,
            reasonKey: reasonCode,
            reasonDetail: body.reason_text,
            occurredAt: now,
            metadata: { version: activated.version },
          });

          return presentRulesVersion(activated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateLifecycleError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/bonus-periods",
      operationId: "createBonusPeriod",
      summary: "Atajo: clonar la version activa, anadir un periodo bonus y activarla.",
      description:
        "Es el gesto '5X durante 12 horas' expresado como lo que DEC-012 dice que es: una VERSION DE REGLAS NUEVA, con su traza. No hay tabla de bonus aparte, porque seria una segunda fuente de verdad sobre cuanto vale una compra y la traza del motor dejaria de reproducirse con `rules_version_id`.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "rules.version.activate" },
      schema: {
        params: promotionParamsSchema,
        body: bonusPeriodBodySchema,
        response: {
          201: bonusPeriodResultSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const body = request.body as z.infer<typeof bonusPeriodBodySchema>;
        const domain = domainServicesFor(dependencies);
        const now = new Date();
        // ANTES de clonar y activar: la negativa por falta de motivo no puede
        // dejar una version de reglas nueva detras.
        const reasonCode = requireReasonCode(body.reason_code);

        if (Date.parse(body.ends_at) <= Date.parse(body.starts_at)) {
          throw ApiErrors.validationFailed([
            { path: ["ends_at"], code: "must_end_after_it_starts" },
          ]);
        }

        const versions = await repo().listRulesVersions(params.promotion_id);
        const active = versions.find((version) => version.status === "ACTIVE");
        if (active === undefined) {
          throw ApiErrors.rulesVersionNotActive(params.promotion_id);
        }

        const config = (
          typeof active.config === "object" && active.config !== null
            ? { ...(active.config as Record<string, unknown>) }
            : {}
        ) as Record<string, unknown>;

        // El techo legal, si la version lo declara. `bonus_rules` es opcional:
        // sin el no hay techo que comprobar, y la API no se inventa uno.
        let bonusRules;
        try {
          bonusRules = readBonusRules(config);
        } catch (error) {
          if (!(error instanceof BonusRulesConfigError)) throw error;
          throw ApiErrors.rulesConfigInvalid([{ path: "bonus_rules", code: "invalid" }]);
        }

        if (bonusRules !== null) {
          const requested =
            BigInt(body.multiplier.numerator) * BigInt(bonusRules.max_multiplier.denominator);
          const ceiling =
            BigInt(bonusRules.max_multiplier.numerator) * BigInt(body.multiplier.denominator);
          if (requested > ceiling) {
            throw ApiErrors.validationFailed([
              { path: ["multiplier"], code: "exceeds_max_multiplier" },
            ]);
          }

          const scope = body.product_kind_scope ?? [...bonusRules.applies_to_product_kinds];
          const outside = scope.filter(
            (kind) => !bonusRules.applies_to_product_kinds.includes(kind),
          );
          if (outside.length > 0) {
            throw ApiErrors.validationFailed([
              { path: ["product_kind_scope"], code: "outside_bonus_rules_scope" },
            ]);
          }
        }

        const existing = multiplierConfigSchema.safeParse(config.multipliers);
        const strategy = existing.success
          ? existing.data.conflict_strategy
          : body.conflict_strategy;

        if (strategy === null) {
          // No se supone ninguna: la eleccion cambia lo que recibe el
          // participante cuando dos periodos se solapan.
          throw ApiErrors.validationFailed([
            { path: ["conflict_strategy"], code: "required_when_absent_from_active_version" },
          ]);
        }

        const periods = existing.success ? [...existing.data.periods] : [];
        const nextPriority = periods.reduce((max, period) => Math.max(max, period.priority + 1), 0);
        const startsDate = body.starts_at.slice(0, 10);

        config.multipliers = {
          conflict_strategy: strategy,
          periods: [
            ...periods.map((period) => ({
              id: period.id,
              multiplier: period.multiplier,
              starts_at: period.starts_at,
              ends_at: period.ends_at,
              priority: period.priority,
              sku_scope: period.sku_scope,
              product_kind_scope: period.product_kind_scope,
            })),
            {
              id: `bonus-${String(periods.length + 1)}-${startsDate}`,
              multiplier: body.multiplier,
              starts_at: body.starts_at,
              ends_at: body.ends_at,
              priority: nextPriority,
              sku_scope: body.sku_scope,
              product_kind_scope: body.product_kind_scope,
            },
          ],
        };

        try {
          // Clonar, activar y auditar EN LA MISMA transaccion. Con la version
          // creada y sin activar, la promocion se quedaria con un borrador
          // huerfano y el operador creyendo que el bonus esta vivo.
          const created = await domain.repositories.unitOfWork.withTransaction(async () => {
            const draft = await repo().createRulesVersion({
              promotionId: params.promotion_id,
              cloneFromRulesVersionId: active.id,
              config,
              attorneyApprovalReference: active.attorneyApprovalReference,
              createdByAdminUserId: staff.adminUserId,
            });

            const activated = await repo().activateRulesVersion(
              params.promotion_id,
              draft.id,
              staff.adminUserId,
              now,
            );
            if (activated === null) throw ApiErrors.notFound();

            await domain.audit.emit({
              action: "bonus.period.created",
              actor: { type: "ADMIN", adminUserId: staff.adminUserId },
              promotionId: params.promotion_id,
              targetEntityType: "PromotionRulesVersion",
              targetEntityId: activated.id,
              reasonKey: reasonCode,
              reasonDetail: body.reason_text,
              occurredAt: now,
              metadata: {
                version: activated.version,
                multiplier_numerator: body.multiplier.numerator,
                multiplier_denominator: body.multiplier.denominator,
                starts_at: body.starts_at,
                ends_at: body.ends_at,
              },
            });

            return activated;
          });

          const flags = await repo().listFlags();
          const multipliersOn =
            flags.items.find((flag) => flag.key === "entry_multipliers_enabled")?.enabled ?? false;

          void reply.code(201);
          return {
            ...presentRulesVersion(created),
            // El bonus EXISTE y no se aplica. Callarlo dejaria a alguien
            // esperando un 5X que el motor no va a conceder.
            warnings: multipliersOn ? [] : ["entry_multipliers_enabled is off"],
          };
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateLifecycleError(error);
        }
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/feature-flags",
      operationId: "listFeatureFlags",
      summary: "Los feature flags con su postura de arranque y su dependencia legal.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "flag.read" },
      schema: {
        response: {
          200: featureFlagsResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaffContext(dependencies, request);
        const flags = await repo().listFlags();

        const items = await Promise.all(
          flags.items.map(async (flag) => {
            const pending = await repo().findPendingSettingChangeRequest("FEATURE_FLAG", flag.key);
            return {
              key: flag.key,
              enabled: flag.enabled,
              is_legally_material: flag.isLegallyMaterial,
              dec032_default: flag.dec032Default,
              legal_dependency: flag.legalDependency,
              updated_at: flag.updatedAt.toISOString(),
              pending_change_request_id: pending?.id ?? null,
            };
          }),
        );

        const pendingMode = await repo().findPendingSettingChangeRequest("AMOE_MODE", "amoe_mode");

        return {
          items,
          amoe_mode: flags.amoeMode,
          amoe_mode_pending_change_request_id: pendingMode?.id ?? null,
        };
      },
    },

    {
      method: "PATCH",
      url: "/api/v1/admin/feature-flags/:key",
      operationId: "updateFeatureFlag",
      summary: "Cambiar un flag NO legalmente material, con motivo.",
      description:
        "Solo los flags que NO exigen control dual. Los legalmente materiales, y `dual_approval_for_sensitive_actions_enabled` -el interruptor que arma el control dual de todo lo demas-, responden 409 `FLAG_REQUIRES_CHANGE_REQUEST` y no se tocan: exigen segunda aprobacion, y para eso existe `POST /admin/settings/change-requests`. La capacidad de esta ruta es ESTATICA a proposito -el autorizador corre antes de conocer la clave- y por eso hay dos caminos y no uno.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "flag.update" },
      schema: {
        params: flagParamsSchema,
        body: updateFlagBodySchema,
        response: {
          200: featureFlagSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof flagParamsSchema>;
        const body = request.body as z.infer<typeof updateFlagBodySchema>;
        const domain = domainServicesFor(dependencies);
        const reasonCode = requireReasonCode(body.reason_code);

        // Quien decide que capacidad exige cada clave es `@lsw/security`, no
        // este handler: la lista de flags materiales vive en el catalogo y una
        // segunda copia aqui divergiria en cuanto se anadiera uno.
        if (flagRequiresDualControl(params.key)) {
          throw ApiErrors.flagRequiresChangeRequest(params.key);
        }

        const before = await repo().listFlags();
        const previous = before.items.find((flag) => flag.key === params.key);

        const updated = await repo().updateFlag(
          params.key,
          body.enabled,
          reasonCode,
          staff.adminUserId,
        );
        if (updated === null) throw ApiErrors.notFound();

        await domain.audit.emit({
          action: "flag.updated",
          actor: { type: "ADMIN", adminUserId: staff.adminUserId },
          promotionId: null,
          targetEntityType: "FeatureFlag",
          targetEntityId: params.key,
          reasonKey: reasonCode,
          reasonDetail: body.reason_text,
          occurredAt: new Date(),
          metadata: {
            key: params.key,
            before: previous?.enabled ?? null,
            after: updated.enabled,
          },
        });

        const pending = await repo().findPendingSettingChangeRequest("FEATURE_FLAG", params.key);

        return {
          key: updated.key,
          enabled: updated.enabled,
          is_legally_material: updated.isLegallyMaterial,
          dec032_default: updated.dec032Default,
          legal_dependency: updated.legalDependency,
          updated_at: updated.updatedAt.toISOString(),
          pending_change_request_id: pending?.id ?? null,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/settings/change-requests",
      operationId: "createSettingChangeRequest",
      summary: "Solicitar el cambio de un ajuste legalmente material.",
      description:
        "Con `dual_approval_for_sensitive_actions_enabled` encendido -la postura de arranque- queda PENDING_APPROVAL y NO toca nada hasta que otra persona lo apruebe. Con el apagado se aplica en el acto, igual que un ajuste manual.",
      tags: ["admin"],
      authorization: {
        kind: "PERMISSION",
        permission: "flag.update.legally_material",
        /*
         * SEGUNDA APROBACION: la impone el flujo, no esta puerta. Crear NO
         * cambia el ajuste cuando el control dual esta encendido, y el efecto
         * solo ocurre cuando OTRA persona lo aprueba. Los dos sitios que lo
         * imponen de verdad, para poder auditarlo leyendolos:
         *   - este archivo, en el handler de `/approve`, que rechaza con
         *     SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN si el aprobador es el
         *     solicitante;
         *   - packages/database/drizzle/0028_setting_change_requests.sql,
         *     CONSTRAINT setting_change_requests_approver_differs, que lo
         *     impide aunque la aplicacion fallara.
         */
        secondApprovalEnforcedBy:
          "apps/api/src/routes/admin-rules.ts#approveSettingChangeRequest (decided_by !== requested_by) y packages/database/drizzle/0028_setting_change_requests.sql#setting_change_requests_approver_differs",
      },
      schema: {
        body: createChangeRequestBodySchema,
        response: {
          201: changeRequestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const body = request.body as z.infer<typeof createChangeRequestBodySchema>;
        const domain = domainServicesFor(dependencies);
        const now = new Date();
        const reasonCode = requireReasonCode(body.reason_code);

        if (body.setting_kind === "FEATURE_FLAG") {
          const key = body.setting_key;
          if (!isFeatureFlagKey(key)) {
            throw ApiErrors.validationFailed([{ path: ["setting_key"], code: "unknown_flag" }]);
          }
          // Un flag que NO exige control dual no pasa por aqui: para eso existe
          // el PATCH. Admitirlo convertiria este camino en el unico y el
          // control dual en un tramite para todo.
          if (!flagRequiresDualControl(key)) {
            throw ApiErrors.validationFailed([
              { path: ["setting_key"], code: "flag_does_not_require_dual_control" },
            ]);
          }
        } else if (body.setting_key !== "amoe_mode") {
          throw ApiErrors.validationFailed([{ path: ["setting_key"], code: "must_be_amoe_mode" }]);
        }

        const requestedValue: Record<string, unknown> =
          body.setting_kind === "FEATURE_FLAG"
            ? { enabled: body.enabled === true }
            : { amoe_mode: body.amoe_mode ?? null };

        // SIEMPRE NACE `PENDING_APPROVAL`, CON O SIN FLAG (S-02).
        //
        // Antes, con `dual_approval_for_sensitive_actions_enabled` apagado, la
        // solicitud nacia APPLIED y aplicaba el cambio en el acto: una sola
        // persona movia un ajuste legalmente material mientras la ruta
        // declaraba `secondApprovalEnforcedBy`, con lo que `authorize()`
        // recibia `secondApprovalGranted: true`. Y `packages/security/src/flags.ts`
        // dice de ese flag, literalmente, que APAGARLO NO RELAJA
        // `requiresSecondApproval` de las capacidades CRITICAL: solo puede
        // ANADIR la exigencia.
        //
        // Asi que el flag no se consulta aqui. `flag.update.legally_material`
        // es CRITICAL y exige segunda aprobacion siempre; el flag solo puede
        // extender el control dual a mas sitios, nunca quitarlo de este.
        const created = await domain.repositories.unitOfWork.withTransaction(async () => {
          const row = await repo().createSettingChangeRequest({
            settingKind: body.setting_kind,
            settingKey: body.setting_key,
            requestedValue,
            reasonCode,
            reasonText: body.reason_text,
            requestedByAdminUserId: staff.adminUserId,
            status: "PENDING_APPROVAL",
            decidedByAdminUserId: null,
            decidedAt: null,
            appliedBefore: null,
            appliedAfter: null,
          });

          await domain.audit.emit({
            action: "setting.change.requested",
            actor: { type: "ADMIN", adminUserId: staff.adminUserId },
            promotionId: null,
            targetEntityType: "SettingChangeRequest",
            targetEntityId: row.id,
            reasonKey: reasonCode,
            reasonDetail: body.reason_text,
            occurredAt: now,
            metadata: { setting_kind: row.settingKind, setting_key: row.settingKey },
          });
          return row;
        });

        void reply.code(201);
        return presentChangeRequest(created, staff.adminUserId);
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/settings/change-requests",
      operationId: "listSettingChangeRequests",
      summary: "Solicitudes de cambio de ajustes, filtrables por estado.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "flag.read" },
      schema: {
        querystring: paginationQuerySchema.extend({
          status: z.enum(["PENDING_APPROVAL", "APPLIED", "REJECTED"]).optional(),
        }),
        response: {
          200: pageSchema(changeRequestSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const query = request.query as z.infer<typeof paginationQuerySchema> & {
          status?: SettingChangeRequestRow["status"];
        };
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).id;

        const rows = await repo().listSettingChangeRequests({
          status: query.status ?? null,
          limit: query.limit + 1,
          after,
        });
        const page = buildPage(rows, query.limit, (row) => ({ sortKey: row.id, id: row.id }));

        return {
          items: page.items.map((row) => presentChangeRequest(row, staff.adminUserId)),
          next_cursor: page.next_cursor,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/settings/change-requests/:change_request_id/approve",
      operationId: "approveSettingChangeRequest",
      summary: "Aprobar una solicitud de cambio y aplicarla.",
      description:
        "Quien la pidio NO puede aprobarla: lo comprueba este handler y lo impone ademas la CHECK `setting_change_requests_approver_differs`. Para `amoe_mode`, la modalidad se valida contra la version de reglas ACTIVA en el momento de APLICAR, no al solicitar.",
      tags: ["admin"],
      authorization: {
        kind: "PERMISSION",
        permission: "flag.update.legally_material",
        secondApprovalEnforcedBy:
          "apps/api/src/routes/admin-rules.ts#approveSettingChangeRequest (decided_by !== requested_by) y packages/database/drizzle/0028_setting_change_requests.sql#setting_change_requests_approver_differs",
      },
      schema: {
        params: changeRequestParamsSchema,
        body: decideChangeRequestBodySchema,
        response: {
          200: changeRequestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof changeRequestParamsSchema>;
        const body = request.body as z.infer<typeof decideChangeRequestBodySchema>;
        const domain = domainServicesFor(dependencies);
        const now = new Date();
        const reasonCode = requireReasonCode(body.reason_code);

        const row = await repo().findSettingChangeRequest(params.change_request_id);
        if (row === null) throw ApiErrors.notFound();
        if (row.status !== "PENDING_APPROVAL") {
          throw ApiErrors.settingChangeNotPending(row.status);
        }
        if (row.requestedByAdminUserId === staff.adminUserId) {
          throw ApiErrors.settingChangeSelfApprovalForbidden(row.requestedByAdminUserId);
        }

        const requestedValue = (
          typeof row.requestedValue === "object" && row.requestedValue !== null
            ? row.requestedValue
            : {}
        ) as Record<string, unknown>;

        // `amoe_mode` se valida contra la version de reglas ACTIVA AQUI, no al
        // solicitar: entre las dos cosas puede publicarse una version nueva, y
        // las dos fuentes tienen que coincidir.
        if (row.settingKind === "AMOE_MODE") {
          await assertAmoeModeMatchesActiveRules(
            dependencies,
            (requestedValue.amoe_mode ?? null) as AmoeMode | null,
          );
        }

        const applied = await domain.repositories.unitOfWork.withTransaction(async () => {
          const before = await applySettingChange(row, staff.adminUserId);
          const decided = await repo().decideSettingChangeRequest(row.id, {
            status: "APPLIED",
            decidedByAdminUserId: staff.adminUserId,
            decidedAt: now,
            decisionNotes: body.notes,
            appliedBefore: before,
            appliedAfter: requestedValue,
          });
          if (decided === null) {
            // Otra aprobacion gano la carrera. Se responde 409 y no se aplica
            // dos veces: la condicion `status = PENDING_APPROVAL` del UPDATE es
            // quien decide, no el orden de ejecucion.
            throw ApiErrors.settingChangeNotPending();
          }

          await domain.audit.emit({
            action: "setting.change.applied",
            actor: { type: "ADMIN", adminUserId: staff.adminUserId },
            promotionId: null,
            targetEntityType: "SettingChangeRequest",
            targetEntityId: row.id,
            reasonKey: reasonCode,
            reasonDetail: body.reason_text,
            occurredAt: now,
            metadata: {
              setting_kind: row.settingKind,
              setting_key: row.settingKey,
              before: asJsonObject(before),
              after: asJsonObject(requestedValue),
              requested_by_admin_user_id: row.requestedByAdminUserId,
            },
          });

          return decided;
        });

        return presentChangeRequest(applied, staff.adminUserId);
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/settings/change-requests/:change_request_id/reject",
      operationId: "rejectSettingChangeRequest",
      summary: "Rechazar una solicitud de cambio, con motivo.",
      description:
        "Una solicitud rechazada NO se borra: es la evidencia de que alguien pidio algo y otra persona dijo que no.",
      tags: ["admin"],
      authorization: {
        kind: "PERMISSION",
        permission: "flag.update.legally_material",
        secondApprovalEnforcedBy:
          "apps/api/src/routes/admin-rules.ts#approveSettingChangeRequest (decided_by !== requested_by) y packages/database/drizzle/0028_setting_change_requests.sql#setting_change_requests_approver_differs",
      },
      schema: {
        params: changeRequestParamsSchema,
        body: decideChangeRequestBodySchema,
        response: {
          200: changeRequestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof changeRequestParamsSchema>;
        const body = request.body as z.infer<typeof decideChangeRequestBodySchema>;
        const domain = domainServicesFor(dependencies);
        const now = new Date();
        const reasonCode = requireReasonCode(body.reason_code);

        const row = await repo().findSettingChangeRequest(params.change_request_id);
        if (row === null) throw ApiErrors.notFound();
        if (row.status !== "PENDING_APPROVAL") {
          throw ApiErrors.settingChangeNotPending(row.status);
        }
        if (row.requestedByAdminUserId === staff.adminUserId) {
          // Mismo criterio que al aprobar: quien la pidio no la decide. Poder
          // rechazar la propia solicitud parece inofensivo, pero la CHECK del
          // motor la rechazaria igual y el error seria un 500 sin explicacion.
          throw ApiErrors.settingChangeSelfApprovalForbidden(row.requestedByAdminUserId);
        }

        const rejected = await repo().decideSettingChangeRequest(row.id, {
          status: "REJECTED",
          decidedByAdminUserId: staff.adminUserId,
          decidedAt: now,
          decisionNotes: body.notes,
          appliedBefore: null,
          appliedAfter: null,
        });
        if (rejected === null) {
          throw ApiErrors.settingChangeNotPending();
        }

        await domain.audit.emit({
          action: "setting.change.rejected",
          actor: { type: "ADMIN", adminUserId: staff.adminUserId },
          promotionId: null,
          targetEntityType: "SettingChangeRequest",
          targetEntityId: row.id,
          reasonKey: reasonCode,
          reasonDetail: body.reason_text,
          occurredAt: now,
          metadata: { setting_kind: row.settingKind, setting_key: row.settingKey },
        });

        return presentChangeRequest(rejected, staff.adminUserId);
      },
    },
  ];
}

/**
 * Un objeto de configuracion como JSON puro, para la traza de auditoria.
 *
 * `AuditSink` exige `JsonValue`, y con razon: lo que entra en `metadata` acaba
 * en el preimage de la hash chain (DEC-035), asi que un `undefined` o una
 * funcion romperian la cadena en vez de fallar aqui. El viaje por
 * `JSON.stringify` los elimina de forma explicita en lugar de confiar en que no
 * los haya.
 */
function asJsonObject(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

/** 422 con `path` por cada problema. La API no completa ninguna clave ausente. */
function assertConfigValid(config: Record<string, unknown>): void {
  const validation = validateConfig(config);
  if (validation.issues.length > 0) {
    throw ApiErrors.rulesConfigInvalid(
      validation.issues.map((issue) => ({ path: issue.path, code: issue.code })),
    );
  }
}

function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(value);
}

/**
 * Las DOS fuentes de la modalidad AMOE tienen que coincidir.
 *
 * `amoe_mode` vive en los ajustes (DEC-032) y `amoe.mode` en la version de
 * reglas (DEC-012). Que existan las dos es un hecho del diseno heredado, y aqui
 * se convierte en un control en vez de en un riesgo: manda la version de reglas
 * -es lo que aprueba el abogado- y una discrepancia se rechaza en vez de dejar
 * que cada capa lea la suya.
 */
async function assertAmoeModeMatchesActiveRules(
  dependencies: AppDependencies,
  mode: AmoeMode | null,
): Promise<void> {
  if (mode === null) {
    // `null` es "modalidad todavia no elegida" y nunca contradice a nada.
    return;
  }

  const promotion = await dependencies.repositories.promotions.findActive();
  const activeRulesVersionId = promotion?.rulesVersionId ?? null;
  if (activeRulesVersionId === null) {
    // Sin promocion activa no hay con que contradecirse. La modalidad se
    // guarda y la comprobacion vuelve a hacerse cuando exista una version.
    return;
  }

  const rulesVersion =
    await dependencies.repositories.promotions.findRulesVersion(activeRulesVersionId);
  if (rulesVersion === null) {
    return;
  }

  const declared = amoeConfigSchema.safeParse(
    (rulesVersion.config as { amoe?: unknown } | null)?.amoe,
  );
  if (declared.success && declared.data.mode !== mode) {
    throw new ApiError({
      statusCode: 409,
      code: "AMOE_CONFIG_INVALID",
      details: { flag_mode: mode, rules_mode: declared.data.mode },
    });
  }
}

/** Se importa para que un flag nuevo del catalogo no pase inadvertido aqui. */
void FEATURE_FLAGS;
