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
  AdminOrderPage,
  AdminOrderRow,
  AdminParticipantPage,
  AdminParticipantRow,
  AdminProductPage,
  AdminProductRow,
  AdminPromotionPage,
  AdminPromotionRow,
  AdminRulesVersion,
  AdminRulesVersionPage,
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
};

/** Personal de cumplimiento. Aprueba ajustes; no los propone. */
export const complianceOfficerSession: SessionState = {
  authenticated: true,
  state: "ACTIVE",
  scope: "STAFF",
  email: "compliance@example.com",
  email_verified: true,
  roles: ["COMPLIANCE_OFFICER"],
};

/** Personal a la espera del segundo factor. No da acceso a nada. */
export const staffMfaPendingSession: SessionState = {
  ...promotionManagerSession,
  authenticated: false,
  state: "MFA_PENDING",
};

/**
 * Sesion de personal con las capacidades PUBLICADAS por el backend.
 *
 * Es el escenario que hay que poder probar hoy aunque el backend todavia no lo
 * sirva: cuando publique `capabilities`, el espejo local de la matriz deja de
 * usarse y el panel tiene que seguir pintando lo mismo.
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

export const adminPromotions: readonly AdminPromotionRow[] = publicPromotions.map(
  (promotion): AdminPromotionRow => ({
    id: promotion.id,
    slug: promotion.slug,
    status: promotion.status,
    title: promotion.title,
    legal_timezone: promotion.legal_timezone,
    starts_at: promotion.starts_at,
    ends_at: promotion.ends_at,
    rules_version_id: promotion.rules_version_id,
    active_rules_version: promotion.rules_version_id === null ? null : 3,
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
 * `activatable` NO se deriva de que `missing_keys` este vacio, ni siquiera
 * aqui: el borrador tiene claves y no es activable, y la archivada no tiene
 * ninguna y tampoco lo es. Deducirlo seria reimplementar el cerrojo.
 */
export const adminRulesVersions: readonly AdminRulesVersion[] = [
  {
    id: "prv_0000000000000003",
    version: 3,
    status: "ACTIVE",
    effective_at: "2026-09-01T05:00:00.000Z",
    created_at: "2026-08-20T10:00:00.000Z",
    missing_keys: [],
    activatable: false,
  },
  {
    id: "prv_0000000000000004",
    version: 4,
    status: "DRAFT",
    effective_at: null,
    created_at: "2026-09-10T16:30:00.000Z",
    missing_keys: ["minimum_age", "eligible_states", "amoe_mechanism", "odds_statement"],
    activatable: false,
  },
  {
    id: "prv_0000000000000002",
    version: 2,
    status: "ARCHIVED",
    effective_at: "2026-06-01T05:00:00.000Z",
    created_at: "2026-05-15T09:00:00.000Z",
    missing_keys: [],
    activatable: false,
  },
];

export const adminRulesVersionPage: AdminRulesVersionPage = {
  items: adminRulesVersions,
  next_cursor: null,
};

// ---------------------------------------------------------------------------
// Catalogo, pedidos y participantes
// ---------------------------------------------------------------------------

export const adminProducts: readonly AdminProductRow[] = [
  {
    id: "prd_0000000000000001",
    slug: "heavyweight-tee",
    title: { "en-US": "Heavyweight Cotton Tee", "es-US": "Camiseta de algodón grueso" },
    published: true,
    variant_count: 6,
    price: { amount_minor: "2500", currency: "USD" },
    updated_at: "2026-09-10T08:00:00.000Z",
  },
  {
    id: "prd_0000000000000002",
    slug: "enamel-mug",
    title: { "en-US": "Enamel Camp Mug", "es-US": "Taza esmaltada de campamento" },
    published: false,
    variant_count: 1,
    price: { amount_minor: "1800", currency: "USD" },
    updated_at: "2026-09-08T08:00:00.000Z",
  },
];

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
    id: "amo_0000000000000001",
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
    entries_awarded: null,
    entries_before: 11_450,
    entries_if_approved: 200,
    entries_after_if_approved: 11_650,
  },
  {
    /*
     * SIN `payload`, que es lo que sirve la cola de verdad: "lleva
     * `participant_id` interno; nunca el payload". La pantalla tiene que decir
     * que no esta publicado, y no dejar un hueco que parece un envio vacio.
     */
    id: "amo_0000000000000007",
    promotion_id: PROMOTION_ID,
    participant_id: "par_0000000000000002",
    participant_email: "a****@example.com",
    status: "PENDING_REVIEW",
    submitted_at: "2026-09-13T08:31:00.000Z",
    entries_awarded: null,
    entries_before: 0,
    entries_if_approved: null,
    entries_after_if_approved: null,
  },
];

export const adminAmoeSubmissionPage: AdminAmoeSubmissionPage = {
  items: adminAmoeSubmissions,
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
