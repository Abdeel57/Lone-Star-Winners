/**
 * Esquemas de respuesta del hito B5: comercio, portal, AMOE, ajustes, sorteo y
 * exportacion.
 *
 * Fichero aparte de `schemas.ts` para no tocar un modulo que otra sesion puede
 * estar editando; su contenido pertenece al mismo contrato y acabara plegado
 * alli cuando el repositorio se quede quieto.
 *
 * DOS REGLAS QUE GOBIERNAN TODO LO DE AQUI
 *
 *   DEC-010. El dinero viaja como CADENA de digitos y las participaciones como
 *   entero. En este archivo no hay ni un `z.number()` que represente dinero, ni
 *   un numero que represente un identificador de entry.
 *
 *   DEC-014. El serializador NO deja salir lo que el esquema no declara. Es la
 *   razon por la que estos esquemas son explicitos hasta lo tedioso: un campo
 *   de mas -un correo, un identificador interno de otro participante- no se
 *   filtra por descuido, porque para filtrarse hay que escribirlo aqui.
 */

import { AMOE_FIELD_TYPES } from "@lsw/sweepstakes";
import { z } from "zod";

import { localizedTextSchema, moneySchema } from "./schemas.js";

// ---------------------------------------------------------------------------
// Comercio
// ---------------------------------------------------------------------------

/**
 * Estado del pedido tal y como lo ve el participante.
 *
 * Es una PROYECCION de las cuatro maquinas internas (`status`,
 * `payment_state`, `fulfillment_state`, `chargeback_state`), no una quinta
 * maquina. `frontend` pidio este vocabulario y encaja: `CHARGEBACK` existe
 * separado de `REFUNDED` porque no son lo mismo para quien mira su pedido -uno
 * lo pidio el participante y el otro su banco- y porque las Official Rules
 * pueden tratarlos distinto.
 */
export const orderStatusSchema = z.enum([
  "PENDING_PAYMENT",
  "PAID",
  "FULFILLED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
]);

/**
 * Estado de las participaciones del pedido. CAMPO APARTE de `status`, a
 * proposito: que el pedido este pagado y que las entries esten otorgadas no son
 * la misma afirmacion y no ocurren en el mismo instante.
 *
 * Se DERIVA del ledger en cada lectura; no hay columna que lo guarde. Una
 * columna seria la segunda fuente de verdad sobre lo unico que no admite dos.
 */
export const orderEntryStateSchema = z.enum([
  "NOT_APPLICABLE",
  "PENDING_QUALIFICATION",
  "GRANTED",
  "PARTIALLY_REVERSED",
  "REVERSED",
]);

export const orderLineSchema = z.object({
  line_id: z.uuid(),
  sku: z.string(),
  product_slug: z.string(),
  product_name: localizedTextSchema,
  quantity: z.number().int(),
  unit_price: moneySchema,
  line_total: moneySchema,
  /** Elegibilidad CONGELADA en el momento de la compra. No se recalcula. */
  sweepstakes_eligible: z.boolean(),
  refunded_quantity: z.number().int(),
});

export const orderSummarySchema = z.object({
  id: z.uuid(),
  /** CADENA: no se formatea como cifra ni pierde ceros a la izquierda. */
  order_number: z.string(),
  status: orderStatusSchema,
  placed_at: z.string(),
  total: moneySchema,
  item_count: z.number().int(),
  promotion_id: z.uuid().nullable(),
  entry_state: orderEntryStateSchema,
  /**
   * `null` mientras no haya cifra -pedido pendiente, o sin promocion-. NO es
   * `0`: que no se sepa todavia y que sean cero son dos afirmaciones distintas
   * delante de alguien que acaba de comprar.
   */
  entries_granted: z.number().int().nullable(),
});

export const postalAddressSchema = z.object({
  full_name: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  /** `region`, no `state`: el nombre no debe presuponer la subdivision territorial. */
  region: z.string(),
  postal_code: z.string(),
  country: z.string(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  items: z.array(orderLineSchema),
  subtotal: moneySchema,
  shipping_total: moneySchema.nullable(),
  tax_total: moneySchema.nullable(),
  shipping_address: postalAddressSchema.nullable(),
  /**
   * Traza del calculo que persistio el `EntryCalculationSnapshot`, o `null` si
   * el pedido no ha generado ninguna. Es lo que permite contestar "por que esta
   * compra genero 37 entries y no 36" meses despues.
   */
  entry_calculation: z
    .object({
      rules_version_id: z.uuid(),
      engine_version: z.number().int(),
      evaluated_at: z.string(),
      final_entries: z.number().int(),
      /** Traza legible por maquina, tal cual la produjo el motor. */
      trace: z.record(z.string(), z.unknown()),
    })
    .nullable(),
});

export const checkoutSessionResponseSchema = z.object({
  provider: z.string(),
  mode: z.enum(["hosted_redirect", "embedded_component"]),
  /**
   * DELIBERADAMENTE OPACO. Cada proveedor necesita cosas distintas -una URL,
   * una clave publicable, un identificador de sesion- y tiparlo obligaria a
   * elegir proveedor, que es la decision que no esta tomada.
   */
  client_config: z.record(z.string(), z.unknown()),
  order_draft_id: z.uuid(),
});

export const checkoutSessionStateSchema = z.object({
  order_draft_id: z.uuid(),
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "FAILED"]),
  /**
   * `null` mientras no exista. Es posible con `COMPLETED` y hay que saber
   * pintarlo: el pago puede estar confirmado y el pedido tardar un instante en
   * materializarse.
   */
  order_id: z.uuid().nullable(),
});

export const webhookAckSchema = z.object({ received: z.literal(true) });

// ---------------------------------------------------------------------------
// Portal del participante
// ---------------------------------------------------------------------------

export const entrySummarySchema = z.object({
  promotion_id: z.uuid(),
  active_entries: z.number().int(),
  purchase_entries: z.number().int(),
  amoe_entries: z.number().int(),
  /** Ajustes manuales y correcciones del sistema, con su procedencia. */
  admin_entries: z.number().int(),
  system_entries: z.number().int(),
  as_of: z.string(),
});

export const entryTransactionSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  source_type: z.enum(["PURCHASE", "AMOE", "ADMIN", "SYSTEM"]),
  quantity_delta: z.number().int(),
  /** DEC-022: enum estable. NUNCA prosa: el copy es de `frontend`. */
  reason_key: z.string(),
  effective_at: z.string(),
  /** `null` = no caduca. Con el flag de caducidad apagado es siempre `null`. */
  expires_at: z.string().nullable(),
  reverses_transaction_id: z.uuid().nullable(),
});

export const entryNumberBatchSchema = z.object({
  batch_id: z.uuid(),
  quantity: z.number().int(),
  /** CADENA, jamas numero (DEC-010). */
  first_number: z.string(),
  last_number: z.string(),
});

export const awardHoldSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  promotion_id: z.uuid(),
  /** Enum estable. Hoy solo existe `EMAIL_VERIFICATION_PENDING`. */
  reason: z.string(),
  qualified_at: z.string(),
  held_at: z.string(),
});

export const participantProfileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  display_name: z.string().nullable(),
  email_verified: z.boolean(),
  /** Etiqueta BCP-47, o `null` si no ha elegido (DEC-029). */
  language_preference: z.string().nullable(),
  created_at: z.string(),
});

/**
 * Solo dos campos, y el idioma acotado a los dos locales de DEC-021.
 *
 * La respuesta declara `language_preference` como `string` -etiqueta BCP-47,
 * DEC-029- porque el backend podria soportar un idioma que la interfaz aun no
 * tenga. La ENTRADA es mas estrecha que la salida a proposito: aceptar aqui una
 * etiqueta arbitraria significaria guardar un idioma en el que no existe ni el
 * copy ni las Reglas Oficiales.
 */
export const participantProfilePatchSchema = z.object({
  display_name: z.string().min(1).max(120).nullable().optional(),
  language_preference: z.enum(["en-US", "es-US"]).optional(),
});

// ---------------------------------------------------------------------------
// AMOE
// ---------------------------------------------------------------------------

/**
 * Un campo del formulario de la via gratuita.
 *
 * ES LA PIEZA QUE IMPIDE QUE EL FRONTEND INVENTE EL FORMULARIO. Que datos se
 * piden para participar sin comprar es materia de las Official Rules
 * (principios 1 y 2): la lista sale de `identity_requirements`, y la interfaz
 * pinta exactamente esos campos, en ese orden, y ni uno mas. Uno de mas es
 * recogida de datos personales que nadie autorizo; uno de menos, un envio que
 * el backend rechazara con `AMOE_PAYLOAD_INVALID`.
 *
 * `type` se importa del dominio en vez de reescribirse aqui: un enum del cable
 * que se copia a mano acaba divergiendo del que valida, y entonces el contrato
 * miente sobre lo que el sistema acepta.
 */
export const amoeFieldSpecSchema = z.object({
  /** Clave tal como viaja en el `payload` del envio. */
  key: z.string(),
  type: z.enum(AMOE_FIELD_TYPES),
  required: z.boolean(),
  /** Clave de copy del frontend (DEC-022). NUNCA prosa del backend. */
  label_key: z.string(),
  /** Tope que acepta el transporte. Ayuda al navegador; no valida nada. */
  max_length: z.number().int(),
});

export const amoeConfigSchema = z.object({
  enabled: z.boolean(),
  /**
   * La promocion a la que pertenece esta configuracion.
   *
   * Viaja tambien con la via apagada -es el unico campo que lo hace- porque no
   * es un parametro de AMOE: es el dato con el que se pregunto. La ruta se pide
   * por `slug` y la respuesta se necesita por identificador, asi que sin este
   * campo el cliente tendria que cruzar dos peticiones para saber a que
   * promocion enviar.
   */
  promotion_id: z.uuid(),
  /** Enum, no booleano: las cuatro modalidades exigen pantallas distintas. */
  mode: z.enum(["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"]).nullable(),
  submission_window: z.object({
    opens_at: z.string().nullable(),
    closes_at: z.string().nullable(),
  }),
  /** Claves de los campos que exige la modalidad. No son prosa: son claves. */
  identity_requirements: z.array(z.string()),
  /**
   * Las mismas claves, ya resueltas a campos pintables. `null` con la via
   * apagada.
   *
   * Convive con `identity_requirements` a proposito: aquella es la lista legal
   * en crudo -lo que el dominio exige- y esta su proyeccion para la interfaz.
   * Una sola de las dos obligaria o a que el panel dedujera el control de cada
   * campo, o a que el contrato perdiera la lista tal y como la escribe el
   * abogado.
   */
  required_fields: z.array(amoeFieldSpecSchema).nullable(),
  /**
   * Instrucciones de la via gratuita, en los dos idiomas, o `null`.
   *
   * EXCEPCION CONSCIENTE A DEC-022: aqui el backend SI publica prosa, porque
   * esta prosa es legalmente controlante -direccion postal, formato del sobre,
   * plazos- y la escribe el abogado del cliente en
   * `PromotionRulesVersion.config`. El frontend la renderiza tal cual, como las
   * Reglas Oficiales.
   *
   * `null` significa "no publicadas". La interfaz remite entonces al documento;
   * ni el backend ni el frontend rellenan ese hueco.
   */
  instructions: localizedTextSchema.nullable(),
  /**
   * Destino de `EXTERNAL_INSTRUCTIONS`, o `null`.
   *
   * Solo puede ser `https:`: la configuracion se rechaza en origen si no lo es,
   * de modo que un `javascript:` escrito en la configuracion de una promocion
   * nunca llega a un navegador.
   */
  external_url: z.string().nullable(),
  entries_per_approved_submission: z.number().int().nullable(),
  requires_review: z.boolean().nullable(),
  max_per_participant_per_period: z.number().int().nullable(),
  limit_period: z.enum(["DAY", "WEEK", "MONTH", "PROMOTION"]).nullable(),
});

export const amoeSubmissionSchema = z.object({
  submission_id: z.uuid(),
  promotion_id: z.uuid(),
  status: z.enum(["SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED", "CANCELLED"]),
  mode: z.enum(["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"]),
  submitted_at: z.string(),
  /** Participaciones que genero la aprobacion. `null` mientras no la haya. */
  entries_awarded: z.number().int().nullable(),
});

/**
 * Vista de revision. Lleva el `participant_id` INTERNO y ningun dato personal:
 * el payload del envio contiene PII y no sale por la API de listado.
 */
export const amoeReviewItemSchema = amoeSubmissionSchema.extend({
  participant_id: z.uuid(),
  period_bucket: z.string(),
  /** `true` si la huella coincide con otro envio de la misma promocion. */
  flagged_duplicate: z.boolean(),
  /**
   * ANTES, CAMBIO y DESPUES de la decision. Las tres las calcula el motor.
   *
   * Quien aprueba tiene que ver el efecto antes de causarlo, y ninguna de las
   * tres cifras se puede producir en el panel: el saldo previo esta en el
   * ledger y la cantidad la fija la version de reglas DEL ENVIO. Restar o sumar
   * en el cliente seria una segunda implementacion del motor sobre datos
   * parciales.
   *
   * `entries_before` siempre trae numero -un participante sin filas tiene cero,
   * que es un saldo conocido-. Las otras dos son `null` cuando la version de
   * reglas del envio ya no declara AMOE legible: la aprobacion fallaria, y una
   * cifra que no se va a cumplir es peor que ninguna.
   *
   * NO son acumulativas entre filas: cada una contesta "si apruebo ESTA".
   */
  entries_before: z.number().int(),
  entries_if_approved: z.number().int().nullable(),
  entries_after_if_approved: z.number().int().nullable(),
});

// ---------------------------------------------------------------------------
// Ajustes, descalificacion y webhooks
// ---------------------------------------------------------------------------

/**
 * Previsualizacion de un ajuste manual. NO lo aplica ni lo solicita.
 *
 * POR QUE ESTO ES UNA RUTA Y NO UNA CUENTA EN EL PANEL
 *
 *   La pantalla de confirmacion de un ajuste tiene que ensenar antes, cambio y
 *   despues. El "antes" es el saldo del ledger bajo el predicado de DEC-034
 *   -que decide que filas cuentan al corte y cuales han caducado- y el
 *   "despues" depende de el. Calcularlo en el navegador seria reimplementar el
 *   predicado de saldo en un segundo sitio, y el dia que los dos discreparan la
 *   pantalla ensenaria una cifra y el ledger tendria otra.
 *
 *   `would_make_balance_negative` es el mismo predicado que rechaza el ajuste
 *   al aplicarlo -literalmente la misma funcion- para que no exista el caso de
 *   una previsualizacion en verde seguida de un rechazo.
 */
export const entryAdjustmentPreviewSchema = z.object({
  /** Saldo activo al instante de la lectura. Cero es un saldo, no un vacio. */
  before: z.number().int(),
  /** Con signo: exactamente el que llevaria la fila del ledger. */
  proposed_delta: z.number().int(),
  after: z.number().int(),
  would_make_balance_negative: z.boolean(),
  /**
   * Si haria falta una segunda persona. Lo decide
   * `dual_approval_for_sensitive_actions_enabled`, no el rol de quien pregunta.
   */
  requires_second_approval: z.boolean(),
  /**
   * Instante de la foto. Un saldo no es un hecho permanente: entre esta lectura
   * y la solicitud puede entrar una compra o una descalificacion, y sin el
   * instante una pantalla abierta media hora parece hablar del presente.
   */
  as_of: z.string(),
});

export const adjustmentSchema = z.object({
  id: z.uuid(),
  promotion_id: z.uuid(),
  participant_id: z.uuid(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  quantity: z.number().int(),
  reason_key: z.string(),
  status: z.enum(["PENDING_APPROVAL", "APPLIED", "REJECTED", "CANCELLED"]),
  requested_by: z.uuid(),
  requested_at: z.string(),
  approved_by: z.uuid().nullable(),
  approved_at: z.string().nullable(),
  entry_transaction_id: z.uuid().nullable(),
});

export const disqualificationSchema = z.object({
  id: z.uuid(),
  promotion_id: z.uuid(),
  participant_id: z.uuid(),
  decision_id: z.string(),
  reason_key: z.string(),
  decided_at: z.string(),
  entries_removed: z.number().int(),
  /** Cuantas cohortes `(procedencia, caducidad)` produjo (DEC-047). */
  cohort_count: z.number().int(),
});

export const paymentEventSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  provider_event_id: z.string(),
  event_type: z.string(),
  status: z.enum(["RECEIVED", "PROCESSED", "FAILED", "IGNORED"]),
  attempts: z.number().int(),
  last_error_code: z.string().nullable(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
});

export const refundResultSchema = z.object({
  order_id: z.uuid(),
  provider_refund_id: z.string(),
  amount: moneySchema,
  /** Movimiento de ledger que produjo, o `null` si no hubo nada que revertir. */
  entry_transaction_id: z.uuid().nullable(),
  entries_reversed: z.number().int(),
});

// ---------------------------------------------------------------------------
// Sorteo y exportacion
// ---------------------------------------------------------------------------

export const drawAuthorizationSchema = z.object({
  id: z.uuid(),
  promotion_id: z.uuid(),
  authorized_by: z.string(),
  authorized_at: z.string(),
  /** Referencia al documento aprobado por el cliente y su abogado. */
  authorization_reference: z.string(),
  scope: z.object({
    snapshot_id: z.uuid().nullable(),
    max_draws: z.number().int(),
    purpose: z.string(),
  }),
  valid_from: z.string(),
  valid_until: z.string(),
  revoked_at: z.string().nullable(),
  draws_used: z.number().int(),
});

export const drawingEventSchema = z.object({
  id: z.uuid(),
  promotion_id: z.uuid(),
  draw_request_id: z.string(),
  snapshot_id: z.uuid(),
  authorization_id: z.uuid(),
  entropy_source: z.enum(["CSPRNG", "COMMIT_REVEAL"]),
  total_eligible_entries: z.string(),
  selected_ordinal: z.string(),
  selected_participant_reference: z.string(),
  selected_provenance: z.string(),
  completed_at: z.string(),
  record_hash: z.string(),
  previous_record_hash: z.string().nullable(),
});

export const potentialWinnerSchema = z.object({
  id: z.uuid(),
  promotion_id: z.uuid(),
  drawing_event_id: z.uuid().nullable(),
  source: z.enum(["INTERNAL_DRAW", "EXTERNAL_ADMINISTRATOR"]),
  /** Referencia INTERNA. Nunca nombre ni correo: este registro se ensena. */
  participant_reference: z.string(),
  entry_reference: z.string(),
  rank: z.number().int(),
  status: z.enum([
    "SELECTED",
    "CONTACT_PENDING",
    "CONTACTED",
    "DOCUMENTS_PENDING",
    "ELIGIBILITY_REVIEW",
    "VERIFIED",
    "DISQUALIFIED",
    "ALTERNATE_REQUIRED",
    "CONFIRMED",
  ]),
  status_changed_at: z.string(),
  status_reason_code: z.string().nullable(),
  history: z.array(
    z.object({
      from: z.string().nullable(),
      to: z.string(),
      occurred_at: z.string(),
      actor_id: z.string(),
      reason_code: z.string(),
    }),
  ),
});

export const exportSnapshotManifestSchema = z.object({
  snapshot_id: z.uuid(),
  promotion_id: z.uuid(),
  version: z.number().int(),
  status: z.enum(["DRAFT", "VALIDATING", "FINALIZED", "DELIVERED", "SUPERSEDED"]),
  rules_version_id: z.uuid(),
  cutoff_at: z.string(),
  /** CADENA: es un `bigint` y no sobrevive a `JSON.parse` como numero. */
  ledger_high_water_mark: z.string(),
  export_schema_version: z.number().int(),
  canonicalization_version: z.number().int(),
  balance_predicate_version: z.number().int(),
  expiration_enabled_at_cutoff: z.boolean(),
  transactions_excluded_by_expiration: z.number().int(),
  entries_excluded_by_expiration: z.number().int(),
  participant_count: z.number().int(),
  entry_batch_count: z.number().int(),
  total_eligible_entries: z.number().int(),
  content_digest: z.string().nullable(),
  merkle_root: z.string().nullable(),
  artifact_sha256: z.string().nullable(),
  signing_key_id: z.string().nullable(),
  generated_at: z.string(),
  generated_by: z.string(),
  finalized_at: z.string().nullable(),
  finalized_by: z.string().nullable(),
  supersedes_snapshot_id: z.uuid().nullable(),
  superseded_reason: z.string().nullable(),
});

export const reconciliationReportSchema = z.object({
  snapshot_id: z.uuid(),
  /** `true` solo si TODAS las comprobaciones pasan. Nunca "casi". */
  passed: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string(),
      passed: z.boolean(),
      detail: z.record(z.string(), z.unknown()),
    }),
  ),
});
