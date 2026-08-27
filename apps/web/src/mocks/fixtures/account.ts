import type {
  ConsentRequirement,
  EntryBatch,
  EntryBatchPage,
  EntryCalculationSnapshot,
  EntrySummary,
  EntryTransaction,
  EntryTransactionPage,
  OrderDetail,
  OrderLine,
  OrderPage,
  OrderSummary,
  ParticipantProfile,
  PostalAddress,
  SessionState,
} from "@/lib/api";

import { eligibleProduct, ineligibleProduct } from "./catalog";
import { mugImage, teeImage } from "./media";
import { activePromotion } from "./promotions";

/**
 * Fixtures del portal del participante.
 *
 * TODAS LAS CIFRAS DE ESTE ARCHIVO ESTAN ESCRITAS A MANO
 * ------------------------------------------------------
 * Ni un saldo, ni un total de linea, ni una participacion se derivan aqui de
 * nada. `active_entries` no es la suma de `purchase_entries` y `amoe_entries`
 * aunque lo parezca: es un numero tecleado, igual que los otros dos.
 *
 * No es pereza, es la misma frontera que rige en produccion. Si estos fixtures
 * sumaran, existiria en el repositorio una segunda implementacion del motor de
 * participaciones -viviendo en el frontend- y los tests pasarian a comprobar
 * que esa copia coincide consigo misma en vez de que la interfaz pinta lo que le
 * mandan (DEC-023, requisito R13 de `security`).
 *
 * Y HAY UN CASO DELIBERADAMENTE DESCUADRADO
 * -----------------------------------------
 * `summaryWithReversals` trae un saldo que NO coincide con la suma de sus dos
 * procedencias, porque incluye un ajuste manual que no pertenece a ninguna de
 * las dos. Es el fixture que rompe cualquier pantalla que se atreva a sumar.
 *
 * Los casos dificiles que cubre
 * -----------------------------
 * - participante con 0 participaciones y sin pedidos;
 * - participante con un solo lote de numeros;
 * - participante con varios lotes;
 * - pedido reembolsado (reversal con delta negativo);
 * - pedido con chargeback;
 * - participaciones AMOE conviviendo con las de compra, con su procedencia;
 * - sesion caducada;
 * - correo sin verificar.
 */

const PARTICIPANT_ID = "par_0000000000000001";

/**
 * Valor de la cookie de sesion en los fixtures.
 *
 * FORMA, NO CONTENIDO. La sesion paralela confirma que el token es OPACO: 43
 * caracteres base64url, y NO un JWT. Aqui se reproduce esa forma para que
 * ningun test pueda depender de lo que hay dentro -no hay nada dentro- y para
 * que un fixture con forma de JWT no sugiera nunca que se puede decodificar.
 *
 * El frontend no lo lee jamas: viaja en una cookie `httpOnly` y todo lo que la
 * interfaz sabe de la sesion llega por `GET /auth/session` (DEC-006).
 */
export const MOCK_SESSION_TOKEN = "Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz"; // gitleaks:allow — token de sesion FICTICIO con la forma opaca real (43 chars base64url), no es un secreto
export const participant: ParticipantProfile = {
  id: PARTICIPANT_ID,
  email: "participant@example.com",
  display_name: "Alex Rivera",
  email_verified: true,
  language_preference: "es-US",
  created_at: "2026-08-02T16:30:00.000Z",
};

/**
 * Participante con el correo SIN verificar.
 *
 * La interfaz muestra el estado y ofrece reenviar el mensaje, y NO AFIRMA
 * NINGUNA CONSECUENCIA. Que un correo sin verificar impida o no acumular
 * participaciones es un TBD legal (`docs/LEGAL_PENDING.md`): decirlo aqui seria
 * inventar un requisito (CLAUDE.md #2).
 */
export const unverifiedParticipant: ParticipantProfile = {
  ...participant,
  id: "par_0000000000000002",
  email: "unverified@example.com",
  display_name: null,
  email_verified: false,
  language_preference: null,
};

/**
 * Sesion de participante, activa.
 *
 * Forma exacta de `SessionState` (seccion 10). NO trae nombre, ni idioma, ni
 * fecha de alta: eso es PERFIL y viaja por `GET /me`. La separacion no es
 * cosmetica -es la del contrato- y tenerla en los fixtures obliga a que las
 * pantallas la respeten.
 *
 * `roles` vacio: un participante no tiene rol de personal.
 */
export const activeSession: SessionState = {
  authenticated: true,
  state: "ACTIVE",
  scope: "PARTICIPANT",
  email: participant.email,
  email_verified: true,
  roles: [],
};

/**
 * Sesion activa con el correo SIN verificar.
 *
 * `email_verified: false` es UN DATO. El propio contrato subraya que si ese
 * dato tiene consecuencias sobre las participaciones es una decision legal que
 * todavia no existe (`docs/LEGAL_PENDING.md`). La sesion esta ACTIVA: no
 * verificar el correo no limita nada, porque nadie ha decidido que lo limite.
 */
export const unverifiedSession: SessionState = {
  ...activeSession,
  email: unverifiedParticipant.email,
  email_verified: false,
};

/**
 * Sin sesion.
 *
 * `200` con `ANONYMOUS`, que es lo que el contrato publica. No un 401: es lo
 * que el frontend consulta en cada render, y un 401 ahi obligaria a tratar el
 * caso normal -un visitante- como un error.
 */
export const anonymousSession: SessionState = {
  authenticated: false,
  state: "ANONYMOUS",
  scope: "PARTICIPANT",
  email: "",
  email_verified: false,
  roles: [],
};

/**
 * Sesion de personal a la espera del segundo factor.
 *
 * `authenticated: false` CON sesion existente. Es el estado que el contrato
 * describe: la contrasena era correcta y la sesion todavia no vale para nada
 * salvo para completar el MFA. No es una pantalla saltable.
 *
 * El alcance es `STAFF` porque el MFA es obligatorio para personal y no para
 * participante; el fixture existe para poder probar que la interfaz NO da
 * acceso a nada en este estado.
 */
export const mfaPendingSession: SessionState = {
  authenticated: false,
  state: "MFA_PENDING",
  scope: "STAFF",
  email: "staff@example.com",
  email_verified: true,
  roles: ["CATALOG_MANAGER"],
};

/** La misma sesion de personal, ya con el segundo factor superado. */
export const staffSession: SessionState = {
  ...mfaPendingSession,
  authenticated: true,
  state: "ACTIVE",
};

/**
 * Consentimientos que exige el alta.
 *
 * NO SON UNA REGLA LEGAL ESCRITA POR EL FRONTEND: son un DATO simulado que
 * ocupa el sitio del que publicara el backend cuando el abogado del cliente
 * decida cuales son. Por eso la clave de copy (`text_key`) es generica y remite
 * a las Reglas Oficiales en vez de afirmar nada concreto sobre edad, residencia
 * o jurisdiccion.
 *
 * `defaultConfig` NO los trae, y eso tambien es deliberado: el escenario por
 * defecto de desarrollo es el de hoy, donde el backend todavia no publica
 * ninguno y el alta no ensena ninguna casilla.
 */
export const requiredConsents: readonly ConsentRequirement[] = [
  {
    key: "OFFICIAL_RULES",
    version: "2026-08-01",
    text_key: "OFFICIAL_RULES",
    required: true,
  },
];

/** Consentimiento cuya clave de copy la interfaz no conoce. */
export const unknownConsent: ConsentRequirement = {
  key: "SOMETHING_THE_FRONTEND_DOES_NOT_KNOW",
  version: "1",
  text_key: "SOMETHING_THE_FRONTEND_DOES_NOT_KNOW",
  required: true,
};

// ---------------------------------------------------------------------------
// Saldos
// ---------------------------------------------------------------------------

const AS_OF = "2026-09-15T12:00:00.000Z";

/** Participante que todavia no tiene ninguna participacion. */
export const emptySummary: EntrySummary = {
  promotion_id: activePromotion.id,
  active_entries: 0,
  purchase_entries: 0,
  amoe_entries: 0,
  as_of: AS_OF,
};

/**
 * Saldo con las dos procedencias.
 *
 * Compra y AMOE conviven en el MISMO universo elegible conservando su
 * procedencia (principio #9). No son dos saldos: son el desglose de uno.
 */
export const entrySummary: EntrySummary = {
  promotion_id: activePromotion.id,
  active_entries: 11_450,
  purchase_entries: 11_250,
  amoe_entries: 200,
  as_of: AS_OF,
};

/**
 * Saldo que NO CUADRA con la suma de sus procedencias, a proposito.
 *
 * 11.250 de compra + 200 de AMOE no dan 11.700: faltan 250 que vienen de un
 * ajuste manual aprobado, que no es ni compra ni AMOE. Cualquier pantalla que
 * calcule el total sumando las dos procedencias falla con este fixture, que es
 * exactamente para lo que existe.
 */
export const summaryWithReversals: EntrySummary = {
  promotion_id: activePromotion.id,
  active_entries: 11_700,
  purchase_entries: 11_250,
  amoe_entries: 200,
  as_of: AS_OF,
};

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * Historial completo, con sus correcciones.
 *
 * LAS DEVOLUCIONES SON FILAS NUEVAS, no la desaparicion de las originales
 * (DEC-007, principios #6 y #7). Aqui se ve: la compra que genero 250
 * participaciones sigue en la lista, y debajo esta la fila con delta -250 que
 * apunta a ella con `reverses_transaction_id`.
 */
export const entryTransactions: readonly EntryTransaction[] = [
  {
    id: "etx_0000000000000001",
    type: "PURCHASE_EARNED",
    source_type: "PURCHASE",
    quantity_delta: 11_000,
    reason_key: "ORDER_QUALIFIED",
    effective_at: "2026-09-01T18:12:00.000Z",
    reverses_transaction_id: null,
  },
  {
    id: "etx_0000000000000002",
    type: "AMOE_EARNED",
    source_type: "AMOE",
    quantity_delta: 200,
    reason_key: "AMOE_APPROVED",
    effective_at: "2026-09-04T09:40:00.000Z",
    reverses_transaction_id: null,
  },
  {
    id: "etx_0000000000000003",
    type: "PURCHASE_EARNED",
    source_type: "PURCHASE",
    quantity_delta: 250,
    reason_key: "ORDER_QUALIFIED",
    effective_at: "2026-09-08T14:05:00.000Z",
    reverses_transaction_id: null,
  },
  {
    id: "etx_0000000000000004",
    type: "REVERSAL",
    source_type: "PURCHASE",
    quantity_delta: -250,
    reason_key: "ORDER_REFUNDED",
    effective_at: "2026-09-10T10:22:00.000Z",
    reverses_transaction_id: "etx_0000000000000003",
  },
  {
    id: "etx_0000000000000005",
    type: "PURCHASE_EARNED",
    source_type: "PURCHASE",
    quantity_delta: 500,
    reason_key: "ORDER_QUALIFIED",
    effective_at: "2026-09-11T11:00:00.000Z",
    reverses_transaction_id: null,
  },
  {
    id: "etx_0000000000000006",
    type: "REVERSAL",
    source_type: "PURCHASE",
    quantity_delta: -500,
    reason_key: "ORDER_CHARGEBACK",
    effective_at: "2026-09-12T08:15:00.000Z",
    reverses_transaction_id: "etx_0000000000000005",
  },
  {
    id: "etx_0000000000000007",
    type: "MANUAL_ADJUSTMENT",
    source_type: "ADJUSTMENT",
    quantity_delta: 250,
    reason_key: "MANUAL_ADJUSTMENT_APPROVED",
    effective_at: "2026-09-13T16:45:00.000Z",
    reverses_transaction_id: null,
  },
  {
    id: "etx_0000000000000008",
    type: "SOMETHING_THE_FRONTEND_DOES_NOT_KNOW_YET",
    source_type: "SOMETHING_ELSE",
    quantity_delta: 25,
    reason_key: "A_REASON_THE_FRONTEND_DOES_NOT_KNOW_YET",
    effective_at: "2026-09-14T12:00:00.000Z",
    reverses_transaction_id: null,
  },
];

export const entryTransactionPage: EntryTransactionPage = {
  items: entryTransactions,
  next_cursor: null,
};

/** Primera pagina de un historial que tiene mas. El cursor es OPACO. */
export const entryTransactionFirstPage: EntryTransactionPage = {
  items: entryTransactions.slice(0, 3),
  next_cursor: "eyJhZnRlciI6ImV0eF8wMDAwMDAwMDAwMDAwMDAzIn0",
};

export const emptyTransactionPage: EntryTransactionPage = { items: [], next_cursor: null };

// ---------------------------------------------------------------------------
// Lotes de numeros (detras de `visible_entry_numbers_enabled`)
// ---------------------------------------------------------------------------

/** Un solo lote. */
export const singleEntryBatch: readonly EntryBatch[] = [
  {
    batch_id: "ebt_0000000000000001",
    quantity: 11_000,
    first_number: "LSW26-000450001",
    last_number: "LSW26-000461000",
  },
];

/** Varios lotes, incluido uno de una sola participacion. */
export const manyEntryBatches: readonly EntryBatch[] = [
  ...singleEntryBatch,
  {
    batch_id: "ebt_0000000000000002",
    quantity: 200,
    first_number: "LSW26-000512400",
    last_number: "LSW26-000512599",
  },
  {
    batch_id: "ebt_0000000000000003",
    quantity: 250,
    first_number: "LSW26-000598120",
    last_number: "LSW26-000598369",
  },
  {
    batch_id: "ebt_0000000000000004",
    quantity: 1,
    first_number: "LSW26-000601777",
    last_number: "LSW26-000601777",
  },
];

export const singleBatchPage: EntryBatchPage = { items: singleEntryBatch, next_cursor: null };
export const manyBatchesPage: EntryBatchPage = { items: manyEntryBatches, next_cursor: null };
export const emptyBatchPage: EntryBatchPage = { items: [], next_cursor: null };

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export const shippingAddress: PostalAddress = {
  full_name: "Alex Rivera",
  line1: "1200 Congress Ave",
  line2: "Apt 4B",
  city: "Austin",
  region: "TX",
  postal_code: "78701",
  country: "US",
};

const ELIGIBLE_LINE: OrderLine = {
  line_id: "oli_0000000000000001",
  sku: "TEE-S",
  product_slug: eligibleProduct.slug,
  product_name: eligibleProduct.name,
  variant_name: { "en-US": "Small", "es-US": "Pequeña" },
  image_url: teeImage,
  quantity: 2,
  unit_price: { amount_minor: "2500", currency: "USD" },
  line_total: { amount_minor: "5000", currency: "USD" },
};

const INELIGIBLE_LINE: OrderLine = {
  line_id: "oli_0000000000000002",
  sku: "MUG-STD",
  product_slug: ineligibleProduct.slug,
  product_name: ineligibleProduct.name,
  variant_name: { "en-US": "Standard", "es-US": "Estándar" },
  image_url: mugImage,
  quantity: 1,
  unit_price: { amount_minor: "1800", currency: "USD" },
  line_total: { amount_minor: "1800", currency: "USD" },
};

/**
 * Traza del calculo persistida.
 *
 * Es lo que permite responder, meses despues, por que esta compra genero esta
 * cifra y no otra: la version de reglas contra la que se evaluo, la version del
 * motor, y el desglose completo. Ninguna de estas cifras se calcula aqui.
 */
const CALCULATION: EntryCalculationSnapshot = {
  rules_version_id: "prv_0000000000000001",
  engine_version: 1,
  evaluated_at: "2026-09-01T18:12:00.000Z",
  eligible_subtotal: { amount_minor: "5000", currency: "USD" },
  entries_before_caps: 500,
  final_entries: 250,
  eligible_items: [
    {
      line_id: ELIGIBLE_LINE.line_id,
      sku: ELIGIBLE_LINE.sku,
      quantity: 2,
      multiplier_ids: ["labor-day-2x"],
    },
  ],
  ineligible_items: [
    {
      line_id: INELIGIBLE_LINE.line_id,
      sku: INELIGIBLE_LINE.sku,
      reason_key: "PRODUCT_NOT_ELIGIBLE",
    },
  ],
  applied_multipliers: [{ id: "labor-day-2x", numerator: 2, denominator: 1 }],
  applied_caps: [{ kind: "PER_ORDER", limit: 250, entries_before: 500, entries_after: 250 }],
};

const GRANTED_SUMMARY: OrderSummary = {
  id: "ord_0000000000000001",
  order_number: "LSW-10524",
  status: "FULFILLED",
  placed_at: "2026-09-01T18:10:00.000Z",
  total: { amount_minor: "7300", currency: "USD" },
  item_count: 3,
  promotion_id: activePromotion.id,
  entry_state: "GRANTED",
  entries_granted: 250,
};

/**
 * Pedido recien pagado.
 *
 * `status: "PAID"` con `entry_state: "PENDING_QUALIFICATION"` es el par que la
 * pagina de confirmacion tiene que saber pintar sin prometer nada: el pago esta
 * hecho y las participaciones todavia no estan otorgadas. `entries_granted` es
 * `null` y no `0`, porque no se sabe todavia no es lo mismo que ninguna.
 */
const PENDING_SUMMARY: OrderSummary = {
  id: "ord_0000000000000002",
  order_number: "LSW-10608",
  status: "PAID",
  placed_at: "2026-09-15T11:58:00.000Z",
  total: { amount_minor: "5000", currency: "USD" },
  item_count: 2,
  promotion_id: activePromotion.id,
  entry_state: "PENDING_QUALIFICATION",
  entries_granted: null,
};

/** Pedido devuelto: las participaciones se revirtieron con una fila nueva. */
const REFUNDED_SUMMARY: OrderSummary = {
  id: "ord_0000000000000003",
  order_number: "LSW-10431",
  status: "REFUNDED",
  placed_at: "2026-09-08T14:00:00.000Z",
  total: { amount_minor: "2500", currency: "USD" },
  item_count: 1,
  promotion_id: activePromotion.id,
  entry_state: "REVERSED",
  entries_granted: 0,
};

/** Pedido con contracargo del banco. No es lo mismo que una devolucion. */
const CHARGEBACK_SUMMARY: OrderSummary = {
  id: "ord_0000000000000004",
  order_number: "LSW-10399",
  status: "CHARGEBACK",
  placed_at: "2026-09-11T10:55:00.000Z",
  total: { amount_minor: "10000", currency: "USD" },
  item_count: 4,
  promotion_id: activePromotion.id,
  entry_state: "REVERSED",
  entries_granted: 0,
};

/** Pedido de una epoca sin promocion abierta: no genera participaciones. */
const NO_PROMOTION_SUMMARY: OrderSummary = {
  id: "ord_0000000000000005",
  order_number: "LSW-10102",
  status: "FULFILLED",
  placed_at: "2026-07-20T15:30:00.000Z",
  total: { amount_minor: "1800", currency: "USD" },
  item_count: 1,
  promotion_id: null,
  entry_state: "NOT_APPLICABLE",
  entries_granted: null,
};

export const orderSummaries: readonly OrderSummary[] = [
  PENDING_SUMMARY,
  GRANTED_SUMMARY,
  REFUNDED_SUMMARY,
  CHARGEBACK_SUMMARY,
  NO_PROMOTION_SUMMARY,
];

export const orderPage: OrderPage = { items: orderSummaries, next_cursor: null };
export const emptyOrderPage: OrderPage = { items: [], next_cursor: null };

/** Pedido con traza completa: multiplicador aplicado y tope aplicado. */
export const grantedOrder: OrderDetail = {
  ...GRANTED_SUMMARY,
  items: [ELIGIBLE_LINE, INELIGIBLE_LINE],
  subtotal: { amount_minor: "6800", currency: "USD" },
  shipping_total: { amount_minor: "500", currency: "USD" },
  tax_total: { amount_minor: "0", currency: "USD" },
  shipping_address: shippingAddress,
  entry_calculation: CALCULATION,
};

/** Pedido pagado del que todavia no hay traza: el backend no ha calculado. */
export const pendingOrder: OrderDetail = {
  ...PENDING_SUMMARY,
  items: [ELIGIBLE_LINE],
  subtotal: { amount_minor: "5000", currency: "USD" },
  shipping_total: null,
  tax_total: null,
  shipping_address: shippingAddress,
  entry_calculation: null,
};

export const refundedOrder: OrderDetail = {
  ...REFUNDED_SUMMARY,
  items: [{ ...ELIGIBLE_LINE, quantity: 1, line_total: { amount_minor: "2500", currency: "USD" } }],
  subtotal: { amount_minor: "2500", currency: "USD" },
  shipping_total: { amount_minor: "0", currency: "USD" },
  tax_total: { amount_minor: "0", currency: "USD" },
  shipping_address: shippingAddress,
  entry_calculation: {
    ...CALCULATION,
    evaluated_at: "2026-09-08T14:05:00.000Z",
    eligible_subtotal: { amount_minor: "2500", currency: "USD" },
    entries_before_caps: 250,
    final_entries: 250,
    applied_multipliers: [],
    applied_caps: [],
    ineligible_items: [],
  },
};

export const chargebackOrder: OrderDetail = {
  ...CHARGEBACK_SUMMARY,
  items: [
    { ...ELIGIBLE_LINE, quantity: 4, line_total: { amount_minor: "10000", currency: "USD" } },
  ],
  subtotal: { amount_minor: "10000", currency: "USD" },
  shipping_total: { amount_minor: "0", currency: "USD" },
  tax_total: { amount_minor: "0", currency: "USD" },
  shipping_address: shippingAddress,
  entry_calculation: {
    ...CALCULATION,
    evaluated_at: "2026-09-11T11:00:00.000Z",
    eligible_subtotal: { amount_minor: "10000", currency: "USD" },
    entries_before_caps: 500,
    final_entries: 500,
    applied_multipliers: [],
    applied_caps: [],
    ineligible_items: [],
  },
};

export const orderWithoutPromotion: OrderDetail = {
  ...NO_PROMOTION_SUMMARY,
  items: [INELIGIBLE_LINE],
  subtotal: { amount_minor: "1800", currency: "USD" },
  shipping_total: { amount_minor: "0", currency: "USD" },
  tax_total: { amount_minor: "0", currency: "USD" },
  shipping_address: shippingAddress,
  entry_calculation: null,
};

/** Los detalles que la API simulada publica, uno por cada resumen. */
export const orderDetails: readonly OrderDetail[] = [
  pendingOrder,
  grantedOrder,
  refundedOrder,
  chargebackOrder,
  orderWithoutPromotion,
];
