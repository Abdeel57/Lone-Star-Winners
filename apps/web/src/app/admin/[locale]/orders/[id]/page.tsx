import { Badge, buttonVariants, Card, CardTitle } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { CashPaymentPanel } from "@/components/admin/cash-payment-panel";
import { OrderCancelPanel } from "@/components/admin/order-cancel-panel";
import { OrderFulfillmentForm } from "@/components/admin/order-fulfillment-form";
import { EntryCalculationTrace } from "@/components/entry-calculation-trace";
import { OrderAddress } from "@/components/order-address";
import { OrderLineList } from "@/components/order-line-list";
import { adminHref } from "@/i18n/admin-routing";
import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { setOrderFulfillmentAction } from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { DAILY_CUT_TIME_ZONE } from "@/lib/admin/daily-cut";
import { fetchAdminOrder, fetchAdminOrderCashPayment } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Detalle de un pedido en el panel, CON LA TRAZA DEL CALCULO.
 *
 * ES LA MISMA TRAZA QUE VE EL PARTICIPANTE, y se reutiliza el mismo componente
 * a proposito. Si el panel tuviera su propia version, quien atiende y quien
 * pregunta estarian mirando dos explicaciones distintas del mismo numero, y la
 * conversacion de soporte se volveria imposible. Ademas, la traza es la unica
 * forma de responder meses despues por que esta compra genero esta cifra, con
 * la version de reglas y la del motor con las que se evaluo (DEC-012).
 *
 * LA DEVOLUCION NO SE OFRECE TODAVIA. `order.refund.initiate` existe en el
 * contrato, pero su ruta esta en `PROPOSED` y una devolucion es una mutacion
 * que mueve dinero y revierte participaciones: un boton que no puede completar
 * eso es peor que su ausencia. La capacidad se comprueba y se dice que la
 * accion llega despues, en vez de pintar un boton muerto.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const statusT = await getTranslations({ locale, namespace: "orderStatus" });
  const entryStateT = await getTranslations({ locale, namespace: "orderEntryState" });

  const screen = await openAdminScreen({
    locale,
    current: "orders",
    path: "/orders",
    title: t("detailTitle"),
    capability: "order.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminOrder(id, locale, screen.session);

  /*
   * DEC-078: el cobro en efectivo se pide APARTE y solo para pedidos en
   * efectivo. La ficha del pedido es la misma forma que ve el participante, y
   * quien confirmo un cobro en caja es un dato del panel, no suyo.
   */
  const isCash = result.ok && result.data.payment_method === "CASH";
  const cash = isCash ? await fetchAdminOrderCashPayment(id, locale, screen.session) : null;

  // DEC-085: hay algo que enviar si el pedido esta cobrado y lleva mercancia.
  // Sin `product_kind` (API anterior) se supone que si: la ruta lo comprueba.
  const fulfillment = result.ok ? result.data.fulfillment : undefined;
  const pickup = result.ok && result.data.fulfillment_method === "PICKUP";
  const shippable =
    result.ok &&
    ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"].includes(result.data.status) &&
    result.data.items.some((line) => line.product_kind !== "ENTRY_PACKAGE");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="orders"
      title={result.ok ? result.data.order_number : t("detailTitle")}
      actions={
        <Link
          href={adminHref(locale, "/orders")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("backToList")}
        </Link>
      }
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s8">
          <Card elevation="raised" padding="lg">
            <div className="flex flex-wrap items-center gap-s3">
              <Badge tone="neutral" size="sm">
                {statusT(result.data.status)}
              </Badge>
              <Badge tone="brand" size="sm">
                {entryStateT(result.data.entry_state)}
              </Badge>
            </div>

            <dl className="mt-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("columnPlaced")}
                </dt>
                <dd className="text-body-sm text-text">
                  {formatZonedDateTime(result.data.placed_at, locale, { timeZone: "UTC" }) ?? ""}
                </dd>
              </div>

              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("columnTotal")}
                </dt>
                <dd className="text-body-sm text-text">
                  {formatMoney(result.data.total, locale) ?? ""}
                </dd>
              </div>

              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("columnPayment")}
                </dt>
                <dd className="text-body-sm text-text">
                  {isCash ? t("paymentCash") : t("paymentCard")}
                </dd>
              </div>
            </dl>
          </Card>

          {cash === null ? null : cash.ok ? (
            <CashPaymentPanel
              cash={cash.data}
              locale={locale}
              actorCanConfirm={can(screen.actor, "order.cash.confirm")}
            />
          ) : (
            <AdminSectionError failure={cash.error} headingLevel="h2" />
          )}

          <section aria-labelledby="order-lines">
            <h2 id="order-lines" className="lsw-display text-heading-lg text-text">
              {t("linesHeading")}
            </h2>

            <div className="mt-s4">
              <OrderLineList lines={result.data.items} locale={locale} />
            </div>
          </section>

          {/*
           * A donde va el pedido. La ruta ya la servia (`orderDetailSchema`, la
           * misma forma que ve el participante) y la pantalla no la pintaba, asi
           * que no habia forma de saber a donde mandarlo. DEC-079: si se recoge
           * en el punto de venta, lo dice, para entregarlo en mano.
           */}
          <OrderAddress
            address={result.data.shipping_address}
            fulfillmentMethod={result.data.fulfillment_method}
          />

          {/*
           * DEC-085: el envio. Solo con la mercancia cobrada; un pedido solo de
           * paquetes de participaciones no tiene nada que mandar. Sin
           * `fulfillment` (API anterior) no se pinta.
           */}
          {fulfillment === undefined || !shippable ? null : (
            <Card elevation="raised" padding="lg">
              <div className="flex flex-wrap items-center justify-between gap-s3">
                <CardTitle as="h2" size="sm">
                  {pickup ? t("fulfillmentPickupHeading") : t("fulfillmentHeading")}
                </CardTitle>
                <Badge tone={fulfillment.state === "FULFILLED" ? "success" : "warning"} size="sm">
                  {fulfillment.state === "FULFILLED"
                    ? pickup
                      ? t("fulfillmentHandedOver")
                      : t("fulfillmentShipped")
                    : pickup
                      ? t("fulfillmentPickupPending")
                      : t("fulfillmentPending")}
                </Badge>
              </div>
              <div className="mt-s4">
                {can(screen.actor, "order.fulfillment.update") ? (
                  <OrderFulfillmentForm
                    locale={locale}
                    action={setOrderFulfillmentAction}
                    orderId={result.data.id}
                    fulfillment={fulfillment}
                    fulfillmentMethod={result.data.fulfillment_method ?? "DELIVERY"}
                    deliveredAtText={
                      fulfillment.delivered_at === null
                        ? null
                        : formatZonedDateTime(fulfillment.delivered_at, locale, {
                            timeZone: DAILY_CUT_TIME_ZONE,
                            showTimeZoneName: true,
                          })
                    }
                  />
                ) : (
                  <p className="text-body-sm text-text-muted">{t("fulfillmentNoCapability")}</p>
                )}
              </div>
            </Card>
          )}

          {/*
           * DEC-085: cancelar lo que nunca se cobro. La ruta lo vuelve a
           * comprobar todo; aqui solo no se ofrece donde no procede.
           */}
          {result.data.status === "PENDING_PAYMENT" && can(screen.actor, "order.cancel") ? (
            <OrderCancelPanel order={result.data} locale={locale} />
          ) : null}

          <section aria-labelledby="order-trace">
            <h2 id="order-trace" className="lsw-display text-heading-lg text-text">
              {t("traceHeading")}
            </h2>

            <div className="mt-s4">
              {/*
               * La zona legal de la promocion NO viaja en el pedido. Se formatea
               * en UTC EXPLICITO, que es la zona neutra, en vez de caer en la
               * del servidor -que es lo que DEC-011 prohibe- y queda anotado
               * como peticion: `OrderDetail` deberia traer `legal_timezone` de
               * su promocion.
               */}
              <EntryCalculationTrace
                calculation={result.data.entry_calculation}
                locale={locale}
                timeZone="UTC"
                currency={result.data.total.currency}
              />
            </div>
          </section>

          <Card elevation="flat" padding="md">
            <CardTitle as="h2" size="sm">
              {t("refundHeading")}
            </CardTitle>
            <p className="mt-s2 text-body-sm text-text-muted">{t("refundPending")}</p>
          </Card>
        </div>
      )}
    </AdminChrome>
  );
}
