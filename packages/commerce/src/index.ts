/**
 * `@lsw/commerce` - comercio y pagos, con proveedor abstracto.
 *
 * ---------------------------------------------------------------------------
 * ALCANCE
 * ---------------------------------------------------------------------------
 *
 *   puerto de proveedor de pagos, neutral y sin ningun SDK;
 *   `MockPaymentProvider` completo y determinista, con HMAC real;
 *   `UnconfiguredPaymentProvider` para `PAYMENT_PROVIDER=none`;
 *   orden y linea de orden como SNAPSHOT historico (DEC-010);
 *   maquinas de estado de orden y de pago;
 *   punto de calificacion configurable, sin valor por defecto;
 *   registro idempotente de webhooks (DEC-009);
 *   devoluciones y contracargos como INTENCIONES de reversal.
 *
 * ---------------------------------------------------------------------------
 * LA FRONTERA QUE ESTE PAQUETE NO CRUZA
 * ---------------------------------------------------------------------------
 *
 * Commerce NO escribe en el entry ledger. Produce hechos e intenciones;
 * `@lsw/sweepstakes` decide que se convierte en un movimiento. Con dos caminos
 * de escritura al universo elegible, las reglas de anclaje, herencia de
 * caducidad y no-sobre-reversal viviran en dos sitios y acabaran divergiendo.
 * `CLAUDE.md` seccion 4 lo prohibe expresamente.
 *
 * ---------------------------------------------------------------------------
 * EL PROVEEDOR SIGUE SIN ELEGIRSE
 * ---------------------------------------------------------------------------
 *
 * `CLAUDE.md` seccion 7. En este paquete no hay una sola referencia a Stripe,
 * Adyen, Shopify Payments ni ningun otro, y elegir uno exige su propio `DEC`.
 */

/**
 * Tipos de dinero, reexportados desde `@lsw/sweepstakes`.
 *
 * La API publica de este paquete los usa -`Money`, `OrderItem.unitAmountMinor`,
 * `Order.totalMinor`- asi que quien lo consuma los necesita. Se reexportan UNO
 * A UNO y no con `export *`: eso volcaria el dominio de participaciones entero
 * a traves de commerce y crearia una segunda puerta de entrada al mismo
 * vocabulario, que es como empiezan las dos fuentes de verdad.
 */
export type { CurrencyCode, MinorAmount } from "@lsw/sweepstakes";

export * from "./errors.js";
export * from "./payment-provider.js";
export * from "./unconfigured-provider.js";
export * from "./mock-provider.js";
export * from "./order.js";
export * from "./qualification.js";
export * from "./payment-events.js";
export * from "./reversal-intents.js";
