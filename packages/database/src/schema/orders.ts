/**
 * Pedidos, lineas congeladas, devoluciones y sesiones de checkout.
 * Espejo de `drizzle/0020_orders_and_checkout.sql`.
 *
 * ADVERTENCIA PARA QUIEN USE ESTE ESQUEMA DESDE DRIZZLE
 *
 *   `orderItems` expone `db.update(...)` como cualquier otra tabla, pero solo
 *   `refundedQuantity` y `refundedAmountMinor` son escribibles: el rol de la
 *   aplicacion tiene UPDATE por COLUMNA y, aunque lo tuviera entero, un trigger
 *   rechaza el cambio de las columnas de foto. Intentarlo produce un error del
 *   motor, no un dato corrompido.
 *
 *   `orderRefunds` y `orderDisputes` son append-only: la aplicacion no tiene
 *   UPDATE ni DELETE sobre ellas.
 *
 * NO HAY NINGUNA COLUMNA CON EL NUMERO DE PARTICIPACIONES DEL PEDIDO
 *
 *   El saldo lo responde el ledger (DEC-007). Una columna aqui seria la
 *   segunda fuente de verdad sobre lo unico que no admite dos, y el dia que
 *   discreparan no habria forma de saber cual miente.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { carts } from "./cart.js";
import { productVariants, products } from "./catalog.js";
import {
  chargebackStateEnum,
  checkoutSessionStatusEnum,
  fulfillmentStateEnum,
  orderStatusEnum,
  paymentStateEnum,
  productKindEnum,
} from "./enums.js";
import { participants } from "./identity.js";
import { promotionRulesVersions, promotions } from "./promotions.js";

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * DEC-010: el numero visible es TEXTO. Un identificador que alguien lee en
     * voz alta por telefono no debe poder tratarse como cifra ni perder ceros a
     * la izquierda al pasar por una hoja de calculo.
     *
     * El valor lo pone la SECUENCIA de la base de datos, no la aplicacion: dos
     * pedidos simultaneos que calcularan el siguiente numero en TypeScript se
     * asignarian el mismo. Se declara el DEFAULT aqui ademas de en la migracion
     * para que Drizzle sepa que la columna es opcional al insertar.
     */
    orderNumber: text("order_number")
      .notNull()
      .default(sql`('LSW-' || lpad(nextval('order_number_seq')::text, 8, '0'))`),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    /** `null`: se puede comprar mercancia fuera de toda promocion. */
    promotionId: uuid("promotion_id").references(() => promotions.id, { onDelete: "restrict" }),
    rulesVersionId: uuid("rules_version_id").references(() => promotionRulesVersions.id, {
      onDelete: "restrict",
    }),
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "set null" }),
    currency: char("currency", { length: 3 }).notNull(),
    status: orderStatusEnum("status").notNull().default("DRAFT"),
    paymentState: paymentStateEnum("payment_state").notNull().default("REQUIRES_ACTION"),
    fulfillmentState: fulfillmentStateEnum("fulfillment_state").notNull().default("UNFULFILLED"),
    chargebackState: chargebackStateEnum("chargeback_state").notNull().default("NONE"),
    /** DEC-010: enteros en unidad menor, en `bigint`. Nunca coma flotante. */
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
    /** `null` = todavia no determinado, que no es lo mismo que cero. */
    shippingTotalMinor: bigint("shipping_total_minor", { mode: "bigint" }),
    taxTotalMinor: bigint("tax_total_minor", { mode: "bigint" }),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    refundedAmountMinor: bigint("refunded_amount_minor", { mode: "bigint" }).notNull(),
    /** Identificadores del proveedor. Ninguna regla de dominio los interpreta. */
    provider: text("provider"),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    /** Sin ninguna regla de jurisdiccion: la elegibilidad territorial es legal. */
    shippingAddress: jsonb("shipping_address"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    /** DEC-011: se fija UNA vez. Un trigger impide moverlo. */
    qualifiedAt: timestamp("qualified_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("orders_order_number_unique").on(table.orderNumber),
    index("orders_participant_recent_idx").on(table.participantId, sql`created_at DESC`),
    index("orders_promotion_idx")
      .on(table.promotionId, table.qualifiedAt)
      .where(sql`promotion_id IS NOT NULL`),
    index("orders_provider_payment_idx")
      .on(table.provider, table.providerPaymentId)
      .where(sql`provider_payment_id IS NOT NULL`),
  ],
);

/**
 * Linea congelada.
 *
 * Nombre, SKU, precio y elegibilidad se congelan al comprar. La linea NO lee el
 * catalogo de hoy: si lo leyera, un cambio de precio o un producto retirado de
 * la lista de mercancia elegible cambiaria retroactivamente cuanto se pago y
 * cuantas participaciones genero la compra.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    productSlug: text("product_slug").notNull(),
    /** DEC-021: los dos idiomas congelados, no uno con fallback. */
    nameSnapshot: jsonb("name_snapshot").notNull(),
    /**
     * DEC-052: el tipo CONGELADO en la compra, como `sku` y `name_snapshot`.
     *
     * Sin `DEFAULT`, a proposito: insertar una linea obliga a decir el tipo.
     * Es lo que decide que tasa se aplico, asi que un valor supuesto por
     * omision seria una cifra de participaciones equivocada, y reetiquetar el
     * producto despues cambiaria lo que significo una compra pasada.
     */
    productKind: productKindEnum("product_kind").notNull(),
    quantity: integer("quantity").notNull(),
    unitAmountMinor: bigint("unit_amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** Elegibilidad bajo la version de reglas DE LA COMPRA. No se recalcula. */
    sweepstakesEligibleSnapshot: boolean("sweepstakes_eligible_snapshot").notNull(),
    /** Lo unico mutable de la linea. */
    refundedQuantity: integer("refunded_quantity").notNull(),
    refundedAmountMinor: bigint("refunded_amount_minor", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_items_unique_variant_per_order").on(table.orderId, table.productVariantId),
    index("order_items_order_idx").on(table.orderId),
  ],
);

/**
 * Devolucion como HECHO, append-only.
 *
 * `providerRefundId` identifica ESTE abono, no la orden: una compra y su
 * devolucion son dos hechos sobre el mismo pedido, y es lo que se convierte en
 * `source_ref = refund:<id>` del movimiento de reversal (DEC-009).
 */
export const orderRefunds = pgTable(
  "order_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerRefundId: text("provider_refund_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** `FULL` / `PARTIAL`, decidido por acumulado y no por lo que diga el proveedor. */
    kind: text("kind").notNull(),
    /** `LINE_ITEMS` o `ESTIMATED_PRORATION`. Un auditor tiene que poder distinguirlos. */
    eligibleBasis: text("eligible_basis").notNull(),
    eligibleAmountMinor: bigint("eligible_amount_minor", { mode: "bigint" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reasonDetail: text("reason_detail"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("order_refunds_unique_provider_refund").on(table.provider, table.providerRefundId),
    index("order_refunds_order_idx").on(table.orderId, table.occurredAt),
  ],
);

/**
 * Disputa como HECHO, append-only.
 *
 * Cada desenlace es una FILA, no un UPDATE: ganar una disputa no anula el
 * `CHARGEBACK_REVERSAL` ya escrito, es un hecho nuevo (DEC-007).
 */
export const orderDisputes = pgTable(
  "order_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerDisputeId: text("provider_dispute_id").notNull(),
    outcome: text("outcome").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }),
    currency: char("currency", { length: 3 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reasonDetail: text("reason_detail"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("order_disputes_unique_provider_outcome").on(
      table.provider,
      table.providerDisputeId,
      table.outcome,
    ),
    index("order_disputes_order_idx").on(table.orderId, table.occurredAt),
  ],
);

/**
 * Sesion de checkout.
 *
 * NO GUARDA NINGUN TOKEN DE CLIENTE. La modalidad `embedded_component` entrega
 * un token de vida corta; persistirlo lo convertiria en una credencial
 * reutilizable guardada en una tabla que se lee con `SELECT`.
 */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** El `order_draft_id` del contrato: el pedido nace en DRAFT y la sesion cuelga de el. */
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    presentation: text("presentation").notNull(),
    status: checkoutSessionStatusEnum("status").notNull().default("PENDING"),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("checkout_sessions_unique_provider_session").on(
      table.provider,
      table.providerSessionId,
    ),
    uniqueIndex("checkout_sessions_one_pending_per_order")
      .on(table.orderId)
      .where(sql`status = 'PENDING'`),
    index("checkout_sessions_order_idx").on(table.orderId, sql`created_at DESC`),
  ],
);
