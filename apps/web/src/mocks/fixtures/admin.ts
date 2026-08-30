import type {
  AdjustmentPreview,
  AdminAdjustment,
  AdminAdjustmentPage,
  AdminAmoeSubmission,
  AdminAmoeSubmissionPage,
  AdminAuditEvent,
  AdminAuditEventPage,
  AdminDashboard,
  AdminDrawAuthorization,
  AdminDrawAuthorizationPage,
  AdminExportSnapshot,
  AdminExportSnapshotPage,
  AdminFeatureFlagsResponse,
  AdminOrderPage,
  AdminOrderRow,
  AdminParticipantPage,
  AdminParticipantRow,
  AdminProductCategoryListResponse,
  AdminProductPage,
  AdminProductRow,
  AdminPromotionPage,
  AdminPromotionRow,
  AdminRulesVersion,
  AdminRulesVersionPage,
  AdminSettingChangeRequestPage,
  SessionState,
} from "@/lib/api";

import { participant } from "./account";
import { activePromotion, publicPromotions } from "./promotions";

/**
 * Fixtures del panel de administracion.
 *
 * TODAS LAS CIFRAS ESTAN ESCRITAS A MANO, igual que en el portal. Ni un saldo,
 * ni un total, ni una participacion se derivan aqui de nada, y el fixture de
 * previsualizacion de ajuste es el que mas cuidado tiene: su `entries_after` es
 * un numero TECLEADO y no la suma de los otros dos. Si sumara, existiria en el
 * repositorio una segunda implementacion del motor de participaciones -viviendo
 * en el frontend- y los tests comprobarian que esa copia coincide consigo misma
 * (DEC-023, requisito R13 de `security`).
 *
 * LAS SESIONES DE PERSONAL USAN ROLES REALES
 * ------------------------------------------
 * `PROMOTION_MANAGER` y `COMPLIANCE_OFFICER` son identificadores de
 * `ROLE_IDS` en `packages/security/src/roles.ts`. El fixture antiguo
 * (`staffSession`) usa `CATALOG_MANAGER`, que es el nombre que aparece en el
 * EJEMPLO de la seccion 10 del contrato y que NO existe en el catalogo de
 * roles. No se toca -hay tests que dependen de el- y la divergencia queda
 * anotada para el informe del hito.
 *
 * Los dos roles elegidos no son intercambiables: uno PROPONE ajustes y el otro
 * los APRUEBA, que es la separacion que el panel tiene que poder demostrar.
 */

const PROMOTION_ID = activePromotion.id;

/**
 * Las dos formas en que un correo llega SIN PII al panel (seccion 11.7).
 *
 * No son la misma cosa y por eso son dos constantes:
 *
 *   - `MASKED_EMAIL`: hay correo y esta oculto. El backend conserva la inicial y
 *     el dominio, y usa un numero FIJO de asteriscos -tres- para no publicar de
 *     paso cuantos caracteres tiene la parte tapada, que en un correo corto es
 *     casi el dato entero.
 *   - `ANONYMIZED_EMAIL`: no hay correo. La cuenta esta anonimizada.
 *
 * Fundirlas en un solo caso dejaria a la interfaz sin poder distinguirlas, y una
 * celda vacia se leeria como un fallo de la pantalla.
 */
const MASKED_EMAIL = "a***@example.test";
const ANONYMIZED_EMAIL = "";

// ---------------------------------------------------------------------------
// Sesiones de personal
// ---------------------------------------------------------------------------

/** Personal que opera la promocion. Propone ajustes; no los aprueba. */
export const promotionManagerSession: SessionState = {
  authenticated: true,
  state: "ACTIVE",
  scope: "STAFF",
  email: "promotions@example.com",
  email_verified: true,
  roles: ["PROMOTION_MANAGER"],
  // Lo que publica la API para este rol: copia LITERAL de ROLE_CAPABILITIES
  // (packages/security/src/permissions.ts) en el momento de escribirla. Es un
  // fixture de la respuesta, no una politica: si el catalogo cambia, cambia
  // aqui tambien, y el test de menu lo delata.
  capabilities: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "participant.list",
    "participant.read",
    "pii.view.masked",
    "order.read",
    "order.refund.initiate",
    "entry.ledger.read",
    "entry.adjust.create",
    "amoe.review.read",
    "amoe.review.approve",
    "amoe.review.reject",
    "product.read",
    "product.write",
    "product.publish",
    "promotion.read",
    "promotion.create",
    "promotion.update",
    "promotion.activate",
    "promotion.close",
    "rules.version.read",
    "rules.version.create",
    "flag.read",
    "reconciliation.read",
  ],
};

/** Personal de cumplimiento. Aprueba ajustes; no los propone. */
export const complianceOfficerSession: SessionState = {
  authenticated: true,
  state: "ACTIVE",
  scope: "STAFF",
  email: "compliance@example.com",
  email_verified: true,
  roles: ["COMPLIANCE_OFFICER"],
  capabilities: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "promotion.read",
    "product.read",
    "participant.list",
    "participant.read",
    "pii.view.masked",
    "pii.view.full",
    "order.read",
    "payment.webhook.read",
    "entry.ledger.read",
    "entry.adjust.approve",
    "participant.disqualify",
    "amoe.review.read",
    "amoe.review.approve",
    "amoe.review.reject",
    "rules.version.read",
    "rules.version.create",
    "rules.version.activate",
    "flag.read",
    "flag.update.legally_material",
    "reconciliation.read",
    "audit.read",
    "audit.integrity.verify",
    "rbac.admin.read",
    "tpa.config.read",
    "export.snapshot.read",
    "export.snapshot.create",
    "export.snapshot.validate",
    "export.finalize",
    "draw.authorization.create",
    "draw.result.read",
    "winner.workflow.read",
    "winner.status.update",
    "winner.publish",
  ],
};

/** Personal a la espera del segundo factor. No da acceso a nada. */
export const staffMfaPendingSession: SessionState = {
  ...promotionManagerSession,
  authenticated: false,
  state: "MFA_PENDING",
};

/**
 * Sesion de personal con un SUBCONJUNTO de capacidades publicado.
 *
 * Sirve para probar que el panel pinta lo que la API dice y no lo que el rol
 * sugiere: `PROMOTION_MANAGER` tendria `entry.adjust.create`, y aqui la
 * respuesta no la trae, asi que el menu tampoco.
 */
export const staffSessionWithPublishedCapabilities: SessionState = {
  ...promotionManagerSession,
  capabilities: [
    "dashboard.read",
    "promotion.read",
    "amoe.review.read",
    "amoe.review.approve",
    "amoe.review.reject",
  ],
};

/** Sesion de personal SIN ninguna capacidad de panel. Ve el 403 deliberado. */
export const staffSessionWithoutCapabilities: SessionState = {
  ...promotionManagerSession,
  roles: [],
  capabilities: [],
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const adminDashboard: AdminDashboard = {
  promotion_id: PROMOTION_ID,
  promotion_status: "ACTIVE",
  active_entries: 1_284_500,
  participants: 3_412,
  orders_last_24h: 87,
  amoe_pending_review: 4,
  adjustments_pending_approval: 2,
  as_of: "2026-09-15T12:00:00.000Z",
};

/**
 * Sin promocion abierta.
 *
 * `promotion_id` y `promotion_status` son `null`, y los conteos SIGUEN
 * llegando: el contrato dice que entonces no se acotan por promocion, no que
 * desaparezcan.
 */
export const adminDashboardWithoutPromotion: AdminDashboard = {
  promotion_id: null,
  promotion_status: null,
  active_entries: 1_284_500,
  participants: 3_412,
  orders_last_24h: 0,
  amoe_pending_review: 0,
  adjustments_pending_approval: 0,
  as_of: "2026-09-15T12:00:00.000Z",
};

/**
 * El actor tiene `dashboard.read` pero NO `entry.ledger.read`.
 *
 * Es el SEGUNDO motivo de `null`, y no tiene nada que ver con el primero: las
 * dos cifras del ledger llegan sin poblar porque esa capacidad no las cubre. El
 * resto del panel se ve entero.
 *
 * Este fixture existe para que la pantalla no pueda pintar un `0` ahi sin que
 * un test lo vea: "no hay participaciones activas" y "no puedo decirtelo" son
 * afirmaciones distintas, y la segunda es la verdadera.
 */
export const adminDashboardWithoutLedgerCapability: AdminDashboard = {
  ...adminDashboard,
  active_entries: null,
  participants: null,
};

// ---------------------------------------------------------------------------
// Promociones y versiones de reglas
// ---------------------------------------------------------------------------

/**
 * Promociones del panel, con la FORMA REAL de la seccion 12: `public_name` e
 * `internal_name` -no `title`-, `active_rules_version_id` -no
 * `rules_version_id`-, y ventana que puede ser `null`. Una forma imaginada aqui
 * convertiria los tests en un espejo (ver `admin-reads.test.ts`).
 */
export const adminPromotions: readonly AdminPromotionRow[] = publicPromotions.map(
  (promotion): AdminPromotionRow => ({
    id: promotion.id,
    slug: promotion.slug,
    internal_name: `${promotion.title["en-US"]} (${promotion.status})`,
    status: promotion.status,
    legal_timezone: promotion.legal_timezone,
    starts_at: promotion.starts_at,
    ends_at: promotion.ends_at,
    active_rules_version_id: promotion.rules_version_id,
    public_name: promotion.title,
    created_at: "2026-08-01T12:00:00.000Z",
    updated_at: "2026-08-20T12:00:00.000Z",
  }),
);

export const adminPromotionPage: AdminPromotionPage = {
  items: adminPromotions,
  next_cursor: null,
};

/**
 * Versiones de reglas, con el veredicto del validador de activacion (DEC-012).
 *
 * EL BORRADOR TRAE CLAVES FALTANTES A PROPOSITO, y son las que hoy siguen en
 * `docs/LEGAL_PENDING.md`. Es el fixture que hace visible el cerrojo: sin el,
 * la pantalla se probaria solo en el caso feliz, que es justo el que no importa.
 *
 * `activatable` NO se deriva de que la lista de claves este vacia, ni siquiera
 * aqui: el borrador tiene claves y no es activable, y la ACTIVA y la ARCHIVADA
 * no tienen ninguna y tampoco lo son -`activatable` exige `DRAFT` (§13.7)-.
 * Deducirlo seria reimplementar el cerrojo.
 */
export const adminRulesVersions: readonly AdminRulesVersion[] = [
  {
    id: "prv_0000000000000003",
    promotion_id: "prm_0000000000000001",
    version: 3,
    status: "ACTIVE",
    effective_at: "2026-09-01T05:00:00.000Z",
    created_at: "2026-08-20T10:00:00.000Z",
    created_by_admin_user_id: "adm_0000000000000001",
    activated_at: "2026-09-01T05:00:00.000Z",
    archived_at: null,
    attorney_approval_reference: "DRAFT v2 (2026-08-29)",
    unresolved_required_keys: [],
    // ACTIVA: ya no es "activable" porque `activatable` exige `DRAFT` (§13.7).
    activatable: false,
    validation: { calculation: "OK", amoe: "OK", bonus_rules: "OK", issues: [] },
    /*
     * LA CONFIGURACION DEL SEGUNDO BORRADOR (§13.2), TAL CUAL.
     *
     * Es la que el panel tiene que poder redactar y la API validar. Las claves
     * en `"TBD"` son las que SIGUEN sin resolver -y siguen bloqueando la
     * activacion (DEC-012)-: el fixture las trae en ese estado porque es el
     * real, no porque falte rellenarlas. Rellenarlas aqui seria inventar una
     * respuesta legal (CLAUDE.md #2).
     */
    config: {
      eligibility:
        "DRAFT v2 §1 — residente legal de EE. UU. (50 estados + D.C.) salvo AK, FL, HI, NY; 18+ y mayoría de edad; excluidos empleados/afiliados y convivientes; cribado BIS/SDN/TDO",
      allowed_jurisdictions: { mode: "DENY_LIST", regions: ["US-AK", "US-FL", "US-HI", "US-NY"] },
      minimum_age: 18,
      promotion_start_end_rules:
        "DRAFT v2 §2 — 12:00:00 a.m. CT [START DATE] a 11:59:59 p.m. CT [END DATE]",
      entry_limits: { per_order_max: null, per_participant_max: 10000 },
      product_eligibility: { mode: "ALL_PRODUCTS" },
      purchase_entry_formula: {
        mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
        rates: {
          MERCHANDISE: {
            amount_unit_minor: "100",
            entries_per_amount_unit: { numerator: 1, denominator: 1 },
          },
          ENTRY_PACKAGE: {
            amount_unit_minor: "100",
            entries_per_amount_unit: { numerator: 2, denominator: 1 },
          },
        },
        rounding_policy: "FLOOR",
      },
      partial_refund_rounding_policy: "TBD",
      entry_expiration: "TBD",
      official_rules_document: "TBD",
      controlling_language: "TBD",
      winner_drawing_method:
        "DRAFT v2 §7 — sorteo aleatorio por el Administrador 14 días tras el cierre, RNG auditado, 3 sorteos alternos",
      multipliers: { conflict_strategy: "HIGHEST_WINS", periods: [] },
      bonus_rules: {
        max_multiplier: { numerator: 10, denominator: 1 },
        applies_to_product_kinds: ["MERCHANDISE", "ENTRY_PACKAGE"],
        applies_to_amoe: false,
      },
      amoe: {
        mode: "MAIL_IN_REVIEW",
        submission_window: {
          starts_at: "2026-08-01T05:00:00.000Z",
          ends_at: "2027-01-07T05:59:00.000Z",
        },
        entries_per_approved_submission: 2000,
        requires_review: true,
        limit: { max_per_participant_per_period: 5, period: "PROMOTION" },
        duplicate_policy: "FLAG_FOR_REVIEW",
        identity_requirements: [
          "full_name",
          "mailing_address",
          "email",
          "phone",
          "date_of_birth",
          "signature_present",
          "postmark_date",
        ],
        mail_in: {
          max_cards_per_envelope: 2,
          postmark_by: "2026-12-31T05:59:00.000Z",
          received_by: "2027-01-07T05:59:00.000Z",
        },
      },
    },
    documents: [
      {
        locale: "en-US",
        title: "Official Rules",
        body: "Served by the backend and rendered as it arrives. In production this is the attorney's approved text.",
        is_legally_controlling: false,
        is_informational_translation: false,
      },
      {
        locale: "es-US",
        title: "Reglas Oficiales",
        body: "Lo sirve el backend y se renderiza tal como llega. En producción es el texto aprobado por el abogado.",
        is_legally_controlling: false,
        is_informational_translation: true,
      },
    ],
  },
  {
    id: "prv_0000000000000004",
    promotion_id: "prm_0000000000000001",
    version: 4,
    status: "DRAFT",
    effective_at: null,
    created_at: "2026-09-10T16:30:00.000Z",
    created_by_admin_user_id: "adm_0000000000000001",
    activated_at: null,
    archived_at: null,
    attorney_approval_reference: null,
    unresolved_required_keys: [
      "minimum_age",
      "eligible_states",
      "amoe_mechanism",
      "odds_statement",
    ],
    // BORRADOR con claves sin resolver: el backend dice que no es activable, y
    // la pantalla ademas lista cuales faltan.
    activatable: false,
    /*
     * UN BORRADOR CON PROBLEMAS DE VALIDACION, Y ESE ES EL FIXTURE.
     *
     * `INVALID` y `UNRESOLVED` no son lo mismo: el primero dice que lo escrito
     * no parsea y el segundo que falta por escribir. Con un solo caso, la
     * pantalla se probaria solo en el camino feliz, que es justo el que no
     * importa cuando alguien no puede activar y no sabe por que.
     */
    validation: {
      calculation: "UNRESOLVED",
      amoe: "INVALID",
      bonus_rules: "ABSENT",
      issues: [
        { path: "amoe.limit.period", code: "INVALID_ENUM_VALUE" },
        { path: "purchase_entry_formula.rounding_policy", code: "REQUIRED" },
      ],
    },
    config: { minimum_age: "TBD", eligible_states: "TBD" },
    documents: [],
  },
  {
    id: "prv_0000000000000002",
    promotion_id: "prm_0000000000000001",
    version: 2,
    status: "ARCHIVED",
    effective_at: "2026-06-01T05:00:00.000Z",
    created_at: "2026-05-15T09:00:00.000Z",
    created_by_admin_user_id: "adm_0000000000000001",
    activated_at: "2026-06-01T05:00:00.000Z",
    archived_at: "2026-09-01T05:00:00.000Z",
    attorney_approval_reference: "DRAFT v1 (2026-08-27)",
    unresolved_required_keys: [],
    activatable: false,
    validation: { calculation: "OK", amoe: "OK", bonus_rules: "ABSENT", issues: [] },
    config: {},
    documents: [],
  },
];

export const adminRulesVersionPage: AdminRulesVersionPage = {
  items: adminRulesVersions,
  next_cursor: null,
};

// ---------------------------------------------------------------------------
// Catalogo, pedidos y participantes
// ---------------------------------------------------------------------------

/**
 * Catalogo del panel, con la forma real de la seccion 12.
 *
 * Los tres estados a proposito, y un producto SIN existencias gestionadas
 * (`stock_quantity: null`): la pantalla tiene que decir "sin gestionar" y no
 * "0", que son dos afirmaciones distintas delante de quien vende.
 */
export const adminProducts: readonly AdminProductRow[] = [
  {
    id: "prd_0000000000000001",
    sku: "HW-TEE-001",
    slug: "heavyweight-tee",
    status: "ACTIVE",
    currency: "USD",
    name: { "en-US": "Heavyweight Cotton Tee", "es-US": "Camiseta de algodón grueso" },
    price_amount_minor: "2500",
    stock_quantity: 120,
    variant_id: "var_0000000000000001",
    created_at: "2026-08-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
    kind: "MERCHANDISE",
    category_key: null,
    image_url: null,
    variants: [
      {
        id: "var_0000000000000001",
        sku: "HW-TEE-001-1",
        name: null,
        price_amount_minor: "2500",
        stock_quantity: 120,
        status: "ACTIVE",
        image_url: null,
        position: 1,
      },
    ],
  },
  {
    /*
     * PRODUCTO CON VARIAS VARIANTES CON NOMBRE (DEC-053).
     *
     * Es el fixture que obliga al editor de variantes a existir: con una sola
     * variante sin nombre, el formulario de siempre bastaba. Aqui hay cinco
     * colores, uno de ellos ARCHIVADO -no hay borrado, se archiva- y otro sin
     * existencias gestionadas.
     */
    id: "prd_cap_premium",
    sku: "CAP-TX",
    slug: "premium-cap",
    status: "ACTIVE",
    currency: "USD",
    name: { "en-US": "Premium Cap", "es-US": "Gorra premium" },
    price_amount_minor: "3500",
    stock_quantity: 40,
    variant_id: "var_cap_black",
    created_at: "2026-08-25T08:00:00.000Z",
    updated_at: "2026-08-28T08:00:00.000Z",
    kind: "MERCHANDISE",
    category_key: "caps",
    image_url: "/products/premium-cap.jpg",
    variants: [
      {
        id: "var_cap_black",
        sku: "CAP-TX-BLACK",
        name: { "en-US": "Black", "es-US": "Negro" },
        price_amount_minor: "3500",
        stock_quantity: 40,
        status: "ACTIVE",
        image_url: "/products/premium-cap-black.jpg",
        position: 1,
      },
      {
        id: "var_cap_sand",
        sku: "CAP-TX-SAND",
        name: { "en-US": "Sand", "es-US": "Arena" },
        price_amount_minor: "3500",
        stock_quantity: 25,
        status: "ACTIVE",
        image_url: "/products/premium-cap-sand.jpg",
        position: 2,
      },
      {
        id: "var_cap_navy",
        sku: "CAP-TX-NAVY",
        name: { "en-US": "Navy", "es-US": "Azul marino" },
        price_amount_minor: "3500",
        stock_quantity: 1,
        status: "ACTIVE",
        image_url: "/products/premium-cap-navy.jpg",
        position: 3,
      },
      {
        id: "var_cap_red",
        sku: "CAP-TX-RED",
        name: { "en-US": "Red", "es-US": "Rojo" },
        price_amount_minor: "3500",
        stock_quantity: null,
        status: "ACTIVE",
        image_url: "/products/premium-cap-red.jpg",
        position: 4,
      },
      {
        id: "var_cap_olive",
        sku: "CAP-TX-OLIVE",
        name: { "en-US": "Olive", "es-US": "Verde olivo" },
        price_amount_minor: "3500",
        stock_quantity: 0,
        status: "ARCHIVED",
        image_url: "/products/premium-cap-olive.jpg",
        position: 5,
      },
    ],
  },
  {
    /*
     * PAQUETE DE PARTICIPACIONES (DEC-052).
     *
     * Ninguna columna dice cuantas participaciones da: eso lo dice la version
     * de reglas. Lo unico que lo distingue de la mercancia es `kind`.
     */
    id: "prd_pkg_20",
    sku: "PKG-20",
    slug: "entry-package-20",
    status: "ACTIVE",
    currency: "USD",
    name: {
      "en-US": "$20 Entry Package",
      "es-US": "Paquete de participaciones de $20",
    },
    price_amount_minor: "2000",
    stock_quantity: null,
    variant_id: "var_pkg_20",
    created_at: "2026-08-26T08:00:00.000Z",
    updated_at: "2026-08-26T08:00:00.000Z",
    kind: "ENTRY_PACKAGE",
    category_key: "entry-packages",
    image_url: "/products/entry-package-20.jpg",
    variants: [
      {
        id: "var_pkg_20",
        sku: "PKG-20-1",
        name: null,
        price_amount_minor: "2000",
        stock_quantity: null,
        status: "ACTIVE",
        image_url: null,
        position: 1,
      },
    ],
  },
  {
    id: "prd_0000000000000002",
    sku: "EN-MUG-001",
    slug: "enamel-mug",
    status: "DRAFT",
    currency: "USD",
    name: { "en-US": "Enamel Camp Mug", "es-US": "Taza esmaltada de campamento" },
    price_amount_minor: "1800",
    stock_quantity: null,
    variant_id: "var_0000000000000002",
    created_at: "2026-09-08T08:00:00.000Z",
    updated_at: "2026-09-08T08:00:00.000Z",
    kind: "MERCHANDISE",
    category_key: "tumblers",
    image_url: null,
    variants: [
      {
        id: "var_0000000000000002",
        sku: "EN-MUG-001-1",
        name: null,
        price_amount_minor: "1800",
        stock_quantity: null,
        status: "DRAFT",
        image_url: null,
        position: 1,
      },
    ],
  },
  {
    /*
     * PRODUCTO SIN `kind`, tal como lo sirve una API anterior a §13.
     *
     * `undefined` NO significa mercancia: significa que no se sabe. El
     * formulario tiene que decirlo y no preseleccionar una opcion, porque el
     * tipo decide QUE TASA se aplica a cada compra de ese producto.
     */
    id: "prd_0000000000000003",
    sku: "LS-CAP-2024",
    slug: "cap-2024",
    status: "ARCHIVED",
    currency: "USD",
    name: { "en-US": "2024 Cap", "es-US": "Gorra 2024" },
    price_amount_minor: "2200",
    stock_quantity: 0,
    variant_id: "var_0000000000000003",
    created_at: "2025-11-01T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
];

/**
 * Categorias del catalogo en el panel (DEC-053).
 *
 * Las ocho que siembra la migracion `0026`, como DATOS. El panel puede crear
 * mas: por eso el nombre viaja localizado desde el backend y no vive en
 * `messages/*.json`.
 */
export const adminProductCategories: AdminProductCategoryListResponse = {
  items: [
    {
      key: "airtag-holders",
      name: { "en-US": "AirTag holders", "es-US": "Soportes AirTag" },
      position: 1,
    },
    {
      key: "phone-holders",
      name: { "en-US": "Phone holders", "es-US": "Soportes de teléfono" },
      position: 2,
    },
    {
      key: "power-banks",
      name: { "en-US": "Power banks", "es-US": "Baterías portátiles" },
      position: 3,
    },
    { key: "notebooks", name: { "en-US": "Notebooks", "es-US": "Libretas" }, position: 4 },
    {
      key: "neck-lights",
      name: { "en-US": "Neck lights", "es-US": "Luces de cuello" },
      position: 5,
    },
    { key: "tumblers", name: { "en-US": "Tumblers", "es-US": "Termos" }, position: 6 },
    { key: "caps", name: { "en-US": "Caps", "es-US": "Gorras" }, position: 7 },
    {
      key: "entry-packages",
      name: { "en-US": "Entry packages", "es-US": "Paquetes de participaciones" },
      position: 8,
    },
  ],
};

/**
 * Feature flags con su materialidad legal (§13.9, DEC-054 punto 3).
 *
 * LOS DOS CASOS QUE IMPORTAN ESTAN AQUI: un flag legalmente material -que exige
 * `flag.update.legally_material` y step-up- y uno que no lo es. Con un solo
 * caso, la advertencia de la pantalla no se podria probar contra su ausencia.
 *
 * `legal_dependency` es la clave de `docs/LEGAL_PENDING.md` de la que depende el
 * flag. Se pinta con su identificador: es lo que hay que buscar en ese
 * documento, y traducirlo lo haria inencontrable.
 */
export const adminFeatureFlags: AdminFeatureFlagsResponse = {
  items: [
    {
      /*
       * FLAG MATERIAL CON UNA SOLICITUD PENDIENTE.
       *
       * Es el caso que obliga a la pantalla a retirar el interruptor: con una
       * solicitud viva habria dos gestos compitiendo por el mismo valor, y el
       * segundo dejaria a alguien aprobando un cambio que ya no es el actual.
       */
      key: "amoe_enabled",
      enabled: false,
      is_legally_material: true,
      dec032_default: false,
      legal_dependency: "amoe_mechanism",
      updated_at: "2026-08-20T10:00:00.000Z",
      pending_change_request_id: "scr_0000000000000001",
    },
    {
      key: "entry_multipliers_enabled",
      enabled: false,
      is_legally_material: true,
      dec032_default: false,
      legal_dependency: "multipliers",
      updated_at: null,
    },
    {
      key: "entry_caps_enabled",
      enabled: true,
      is_legally_material: true,
      dec032_default: false,
      legal_dependency: "entry_limits",
      updated_at: "2026-08-29T09:00:00.000Z",
    },
    {
      key: "visible_entry_numbers_enabled",
      enabled: false,
      is_legally_material: false,
      dec032_default: false,
      legal_dependency: null,
      updated_at: null,
    },
    {
      key: "internal_draw_enabled",
      enabled: false,
      is_legally_material: true,
      dec032_default: false,
      legal_dependency: "winner_selection_method",
      updated_at: null,
    },
  ],
  amoe_mode: "MAIL_IN_REVIEW",
};

/**
 * Solicitudes de cambio de ajustes (HO-041, resolucion fase 1).
 *
 * DOS FILAS Y LA DIFERENCIA ES QUIEN LA PIDIO. La primera la pidio otra
 * persona -se puede decidir- y la segunda la pidio quien mira, que NO puede
 * aprobarla: es la `CHECK` de la tabla y el 409
 * `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` del servicio. Sin las dos, la
 * pantalla se probaria solo en el caso en el que el boton se ofrece.
 *
 * La segunda ademas es de `AMOE_MODE`, que es el otro `setting_kind`: la
 * modalidad AMOE dejo de tener ruta propia y viaja por el mismo control dual.
 */
export const adminSettingChangeRequests: AdminSettingChangeRequestPage = {
  items: [
    {
      id: "scr_0000000000000001",
      setting_kind: "FEATURE_FLAG",
      setting_key: "amoe_enabled",
      requested_value: { enabled: true },
      status: "PENDING_APPROVAL",
      reason_code: "COMPLIANCE_DIRECTIVE",
      reason_text: "Publicación de la vía gratuita conforme a las Reglas Oficiales.",
      requested_by_admin_user_id: "adm_0000000000000002",
      requested_at: "2026-08-29T09:30:00.000Z",
      decided_by_admin_user_id: null,
      decided_at: null,
      decision_notes: null,
      requested_by_me: false,
    },
    {
      id: "scr_0000000000000002",
      setting_kind: "AMOE_MODE",
      setting_key: "amoe_mode",
      requested_value: { amoe_mode: "MAIL_IN_REVIEW" },
      status: "PENDING_APPROVAL",
      reason_code: "OPERATIONAL_ROLLOUT",
      reason_text: null,
      requested_by_admin_user_id: "adm_0000000000000001",
      requested_at: "2026-08-29T10:05:00.000Z",
      decided_by_admin_user_id: null,
      decided_at: null,
      decision_notes: null,
      requested_by_me: true,
    },
  ],
  next_cursor: null,
};

export const adminProductPage: AdminProductPage = {
  items: adminProducts,
  next_cursor: null,
};

/**
 * Pedidos del panel.
 *
 * LOS DOS CORREOS LLEGAN SIN PII, Y NO DE LA MISMA MANERA (seccion 11.7).
 * El primero esta ENMASCARADO -hay correo y esta oculto- y el segundo es CADENA
 * VACIA -cuenta anonimizada, no hay correo-. Son dos afirmaciones distintas y la
 * tabla tiene que pintarlas distinto; con un solo caso, el hueco de la segunda
 * pasaria por un fallo de la pantalla.
 *
 * `order.read` NO es una capacidad de PII: el enmascarado no depende del actor.
 */
export const adminOrders: readonly AdminOrderRow[] = [
  {
    id: "ord_0000000000000001",
    order_number: "LSW-10524",
    status: "FULFILLED",
    entry_state: "GRANTED",
    placed_at: "2026-09-04T17:45:00.000Z",
    total: { amount_minor: "5000", currency: "USD" },
    participant_email: MASKED_EMAIL,
    participant_id: participant.id,
  },
  {
    id: "ord_0000000000000002",
    order_number: "LSW-10608",
    status: "PAID",
    entry_state: "PENDING_QUALIFICATION",
    placed_at: "2026-09-14T09:12:00.000Z",
    total: { amount_minor: "2500", currency: "USD" },
    participant_email: ANONYMIZED_EMAIL,
    participant_id: "par_0000000000000002",
  },
];

export const adminOrderPage: AdminOrderPage = { items: adminOrders, next_cursor: null };

/**
 * Participantes.
 *
 * `pii_masked` es `true` en LOS DOS, porque en esta ruta lo es siempre: la
 * forma sin enmascarar vive detras de `pii.view.full`, en otra ruta.
 *
 * El segundo esta ANONIMIZADO y por eso su correo es cadena vacia. Es el caso
 * que separa "hay correo y esta oculto" de "no hay correo", y sin el nadie
 * notaria que la tabla pinta una celda en blanco.
 */
export const adminParticipants: readonly AdminParticipantRow[] = [
  {
    id: participant.id,
    email: MASKED_EMAIL,
    display_name: participant.display_name,
    created_at: participant.created_at,
    disqualified: false,
    pii_masked: true,
  },
  {
    id: "par_0000000000000002",
    email: ANONYMIZED_EMAIL,
    display_name: null,
    created_at: "2026-08-19T09:15:00.000Z",
    disqualified: true,
    pii_masked: true,
  },
];

export const adminParticipantPage: AdminParticipantPage = {
  items: adminParticipants,
  next_cursor: null,
};

// ---------------------------------------------------------------------------
// Cola de revision AMOE
// ---------------------------------------------------------------------------

/**
 * Envios pendientes de decision.
 *
 * LOS DOS TRAEN `entries_before` -siempre es un numero: cero es un saldo
 * conocido- y se diferencian en la PROYECCION: el primero la trae completa y el
 * segundo la trae en `null`, que es lo que sirve el backend cuando la version de
 * reglas DEL ENVIO ya no declara AMOE legible. Ese caso tiene que verse en
 * pantalla como "sin publicar" y no como un cero, porque la aprobacion fallaria
 * y una cifra que no se va a cumplir es peor que ninguna.
 *
 * LAS TRES CIFRAS ESTAN TECLEADAS, no calculadas: 11.450 + 200 = 11.650 hoy y
 * podria no serlo manana -con un tope, una caducidad o una descalificacion de
 * por medio-, y ese es exactamente el caso que estos fixtures tienen que poder
 * representar.
 *
 * NO SON ACUMULATIVAS ENTRE FILAS: cada una contesta "si apruebo ESTA".
 */
export const adminAmoeSubmissions: readonly AdminAmoeSubmission[] = [
  {
    submission_id: "amo_0000000000000001",
    promotion_id: PROMOTION_ID,
    participant_id: participant.id,
    participant_email: participant.email,
    status: "PENDING_REVIEW",
    submitted_at: "2026-09-12T15:04:00.000Z",
    payload: {
      full_name: "Alex Rivera",
      email: "participant@example.com",
      postal_code: "78701",
    },
    transcribed_by_me: false,
    entries_awarded: null,
    entries_before: 11_450,
    entries_if_approved: 200,
    entries_after_if_approved: 11_650,
    /*
     * SIN TOPE APLICABLE: las dos cifras coinciden y `cap_applies` es `false`.
     * Es el caso normal, y esta escrito -no derivado- por la misma razon que
     * las tres de arriba.
     */
    entries_if_approved_after_cap: 200,
    cap_applies: false,
  },
  {
    /*
     * FICHA POSTAL TRANSCRITA, CON EL TOPE RECORTANDO (§13.3, §13.10).
     *
     * Dos cosas a la vez, y las dos nuevas de esta ronda:
     *
     *   1. La ficha vale 2,000 y el participante solo tiene sitio para 550, asi
     *      que `entries_if_approved_after_cap` es MENOR. Las dos cifras viajan
     *      porque quien aprueba tiene que ver el recorte ANTES de causarlo, y
     *      la pantalla no puede calcularlo: el "espacio restante" sale del
     *      predicado de saldo del motor, no de una resta (requisito R13).
     *   2. La transcribio alguien del equipo, asi que esa persona NO puede
     *      aprobarla (`SEPARATION_OF_DUTIES`). La pantalla lo advierte; el
     *      control sigue siendo el 409 del backend.
     */
    submission_id: "amo_0000000000000008",
    promotion_id: PROMOTION_ID,
    participant_id: "par_0000000000000003",
    participant_email: "m****@example.com",
    status: "PENDING_REVIEW",
    submitted_at: "2026-09-14T10:12:00.000Z",
    entries_awarded: null,
    entries_before: 9_450,
    entries_if_approved: 2_000,
    entries_after_if_approved: 11_450,
    entries_if_approved_after_cap: 550,
    cap_applies: true,
    /*
     * LA TRANSCRIBIO QUIEN MIRA, y ese es el fixture: el panel retira el
     * formulario de aprobar y lo explica. Rechazar SI se ofrece -la separacion
     * de funciones protege la concesion, no la negativa- y el control sigue
     * siendo el 409 `SEPARATION_OF_DUTIES`.
     */
    transcribed_by_me: true,
    transcribed_by_admin_user_id: "adm_0000000000000002",
    envelope_reference: "SOBRE-0012",
    cards_in_envelope: 3,
    // Tres fichas en un sobre que admite dos: entra MARCADO y va a revision.
    // No se rechaza solo (§13.10).
    flagged_envelope: true,
  },
  {
    /*
     * SIN `payload`, que es lo que sirve la cola de verdad: "lleva
     * `participant_id` interno; nunca el payload". La pantalla tiene que decir
     * que no esta publicado, y no dejar un hueco que parece un envio vacio.
     */
    submission_id: "amo_0000000000000007",
    promotion_id: PROMOTION_ID,
    participant_id: "par_0000000000000002",
    participant_email: "a****@example.com",
    status: "PENDING_REVIEW",
    submitted_at: "2026-09-13T08:31:00.000Z",
    transcribed_by_me: false,
    entries_awarded: null,
    entries_before: 0,
    entries_if_approved: null,
    entries_after_if_approved: null,
  },
];

/**
 * Envio YA APROBADO con recorte por tope (HO-041, resolucion fase 1, punto 4).
 *
 * `entries_awarded` dice cuanto valia la ficha y `granted_entries` cuanto
 * entro de verdad en el ledger; `applied_cap` explica la diferencia. Los tres
 * viajan porque restar los dos primeros seria una segunda aritmetica de
 * participaciones en el cliente, y ademas el motor puede recortar por mas de un
 * motivo a la vez.
 */
export const adminApprovedCappedSubmission: AdminAmoeSubmission = {
  submission_id: "amo_0000000000000009",
  promotion_id: PROMOTION_ID,
  participant_id: "par_0000000000000003",
  participant_email: "m****@example.com",
  status: "APPROVED",
  submitted_at: "2026-09-14T10:12:00.000Z",
  entries_awarded: 2_000,
  entries_before: 9_450,
  entries_if_approved: 2_000,
  entries_after_if_approved: 11_450,
  entries_if_approved_after_cap: 550,
  cap_applies: true,
  transcribed_by_me: false,
  granted_entries: 550,
  applied_cap: { kind: "PER_PARTICIPANT", limit: 10_000, requested: 2_000, granted: 550 },
};

export const adminAmoeSubmissionPage: AdminAmoeSubmissionPage = {
  items: [...adminAmoeSubmissions, adminApprovedCappedSubmission],
  next_cursor: null,
};

export const emptyAdminAmoePage: AdminAmoeSubmissionPage = { items: [], next_cursor: null };

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

/**
 * Cola de ajustes pendientes de segunda aprobacion.
 *
 * El primero lo propuso `promotions@example.com` y el segundo
 * `compliance@example.com`: con esos dos, cualquiera de las dos sesiones de
 * personal ve un ajuste que puede aprobar y otro que no, que es lo que hace
 * comprobable la prohibicion de autoaprobarse.
 */
export const adminAdjustments: readonly AdminAdjustment[] = [
  {
    id: "adj_0000000000000001",
    promotion_id: PROMOTION_ID,
    participant_id: participant.id,
    participant_email: participant.email,
    status: "PENDING_APPROVAL",
    quantity_delta: 500,
    reason_key: "SYSTEM_ERROR_CORRECTION",
    reason_note: "Duplicated webhook left the order short.",
    created_at: "2026-09-14T10:05:00.000Z",
    created_by_actor_id: "act_0000000000000001",
    created_by_actor_email: promotionManagerSession.email,
    approved_at: null,
    approved_by_actor_id: null,
    approved_by_actor_email: null,
  },
  {
    id: "adj_0000000000000002",
    promotion_id: PROMOTION_ID,
    participant_id: "par_0000000000000002",
    participant_email: "a****@example.com",
    status: "PENDING_APPROVAL",
    quantity_delta: -250,
    reason_key: "OTHER",
    reason_note: "Reversal requested by the payment provider.",
    created_at: "2026-09-14T11:20:00.000Z",
    created_by_actor_id: "act_0000000000000002",
    created_by_actor_email: complianceOfficerSession.email,
    approved_at: null,
    approved_by_actor_id: null,
    approved_by_actor_email: null,
  },
];

export const adminAdjustmentPage: AdminAdjustmentPage = {
  items: adminAdjustments,
  next_cursor: null,
};

export const emptyAdjustmentPage: AdminAdjustmentPage = { items: [], next_cursor: null };

/**
 * Previsualizacion de un ajuste.
 *
 * `after` ES UN NUMERO TECLEADO. No es `before` mas `proposed_delta` calculado
 * aqui, aunque lo parezca: el dia que exista un tope o una regla de caducidad
 * dejaria de coincidir, y ese es exactamente el caso que este fixture tiene que
 * poder representar.
 *
 * `as_of` esta porque un saldo es una FOTO. Sin el instante, la pantalla que lo
 * ensena parece hablar del presente aunque lleve media hora abierta.
 */
export const adjustmentPreview: AdjustmentPreview = {
  before: 11_450,
  proposed_delta: 500,
  after: 11_950,
  would_make_balance_negative: false,
  requires_second_approval: true,
  as_of: "2026-09-14T12:00:00.000Z",
};

/**
 * Debito que dejaria el saldo por debajo de cero.
 *
 * `would_make_balance_negative` lo contesta LA MISMA funcion que rechaza el
 * ajuste al aplicarlo, asi que este fixture representa una previsualizacion que
 * la interfaz NO debe dejar firmar. El `after` sigue tecleado -aqui es el saldo
 * que quedaria, no un cero de cortesia- porque quien mira tiene derecho a ver
 * por que no se le deja continuar.
 */
export const adjustmentPreviewNegative: AdjustmentPreview = {
  ...adjustmentPreview,
  proposed_delta: -12_000,
  after: -550,
  would_make_balance_negative: true,
};

// ---------------------------------------------------------------------------
// Exportaciones y sorteo
// ---------------------------------------------------------------------------

export const adminExportSnapshots: readonly AdminExportSnapshot[] = [
  {
    id: "exp_0000000000000001",
    promotion_id: PROMOTION_ID,
    status: "FINALIZED",
    created_at: "2026-09-14T20:00:00.000Z",
    finalized_at: "2026-09-14T20:40:00.000Z",
    row_count: 1_284_500,
    checksum: "9f2c4a1de5b7c3a086f41d2e7b9c05a3d8e6f10b24c7593ae1f0b8d6c42a7e935",
    rules_version_id: "prv_0000000000000003",
  },
  {
    id: "exp_0000000000000002",
    promotion_id: PROMOTION_ID,
    status: "DRAFT",
    created_at: "2026-09-15T06:00:00.000Z",
    finalized_at: null,
    row_count: null,
    checksum: null,
    rules_version_id: null,
  },
];

export const adminExportSnapshotPage: AdminExportSnapshotPage = {
  items: adminExportSnapshots,
  next_cursor: null,
};

/**
 * Autorizaciones de sorteo.
 *
 * La primera tiene UNA aprobacion de DOS y sus condiciones sin cumplir: es el
 * estado normal mientras `internal_draw_enabled` sigue apagado (DEC-032) y
 * DEC-017 sin satisfacer. La segunda esta autorizada con dos aprobaciones de
 * PERSONAS DISTINTAS, que es lo que hay que poder comprobar en pantalla.
 */
export const adminDrawAuthorizations: readonly AdminDrawAuthorization[] = [
  {
    id: "dra_0000000000000001",
    promotion_id: PROMOTION_ID,
    status: "PENDING_APPROVAL",
    created_at: "2026-09-15T07:00:00.000Z",
    created_by_actor_id: "act_0000000000000002",
    created_by_actor_email: complianceOfficerSession.email,
    approvals: [
      {
        actor_id: "act_0000000000000002",
        actor_email: complianceOfficerSession.email,
        approved_at: "2026-09-15T07:00:00.000Z",
      },
    ],
    required_approvals: 2,
    export_snapshot_id: null,
    blocking_conditions: [
      "INTERNAL_DRAW_DISABLED",
      "NO_FINALIZED_SNAPSHOT",
      "PROMOTION_NOT_CLOSED",
      "SECOND_APPROVAL_MISSING",
    ],
  },
  {
    id: "dra_0000000000000002",
    promotion_id: PROMOTION_ID,
    status: "AUTHORIZED",
    created_at: "2026-09-15T07:30:00.000Z",
    created_by_actor_id: "act_0000000000000002",
    created_by_actor_email: complianceOfficerSession.email,
    approvals: [
      {
        actor_id: "act_0000000000000002",
        actor_email: complianceOfficerSession.email,
        approved_at: "2026-09-15T07:30:00.000Z",
      },
      {
        actor_id: "act_0000000000000003",
        actor_email: "draw@example.com",
        approved_at: "2026-09-15T08:05:00.000Z",
      },
    ],
    required_approvals: 2,
    export_snapshot_id: "exp_0000000000000001",
    blocking_conditions: ["INTERNAL_DRAW_DISABLED"],
  },
];

export const adminDrawAuthorizationPage: AdminDrawAuthorizationPage = {
  items: adminDrawAuthorizations,
  next_cursor: null,
};

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Eventos de auditoria.
 *
 * Hay uno de `SYSTEM` a proposito: distinguir un job de una persona es el punto
 * entero de la traza, y una lista solo con humanos dejaria ese camino sin
 * probar.
 *
 * `actor_email` es `null` EN TODOS, porque el contrato dice que lo es siempre:
 * la tabla guarda `actor_id`, un identificador interno, y resolverlo en la
 * lectura meteria en la traza justo el dato que la escritura decidio no guardar.
 * Un fixture con correos habria dejado a la pantalla pintando una columna que en
 * produccion sale vacia en todas las filas.
 */
export const adminAuditEvents: readonly AdminAuditEvent[] = [
  {
    id: "aud_0000000000000001",
    occurred_at: "2026-09-14T10:05:12.000Z",
    actor_type: "HUMAN",
    actor_id: "act_0000000000000001",
    actor_email: null,
    actor_roles: ["PROMOTION_MANAGER"],
    action: "entry.adjust.create",
    entity_type: "EntryAdjustment",
    entity_id: "adj_0000000000000001",
    promotion_id: PROMOTION_ID,
    reason_key: "SYSTEM_ERROR_CORRECTION",
    request_id: "req_0000000000000001",
  },
  {
    id: "aud_0000000000000002",
    occurred_at: "2026-09-14T09:12:44.000Z",
    actor_type: "SYSTEM",
    actor_id: null,
    actor_email: null,
    actor_roles: ["SYSTEM"],
    action: "payment.webhook.replay",
    entity_type: "PaymentWebhook",
    entity_id: "pwh_0000000000000009",
    promotion_id: null,
    reason_key: null,
    request_id: "req_0000000000000002",
  },
  {
    id: "aud_0000000000000003",
    occurred_at: "2026-09-13T18:00:03.000Z",
    actor_type: "HUMAN",
    actor_id: "act_0000000000000002",
    actor_email: null,
    actor_roles: ["COMPLIANCE_OFFICER"],
    action: "amoe.review.approve",
    entity_type: "AmoeSubmission",
    entity_id: "amo_0000000000000002",
    promotion_id: PROMOTION_ID,
    reason_key: "MEETS_REQUIREMENTS",
    request_id: "req_0000000000000003",
  },
];

export const adminAuditEventPage: AdminAuditEventPage = {
  items: adminAuditEvents,
  next_cursor: null,
};
