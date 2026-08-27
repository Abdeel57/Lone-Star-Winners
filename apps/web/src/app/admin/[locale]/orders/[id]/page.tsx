import { Badge, buttonVariants, Card, CardTitle } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryCalculationTrace } from "@/components/entry-calculation-trace";
import { OrderLineList } from "@/components/order-line-list";
import { adminHref } from "@/i18n/admin-routing";
import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { fetchAdminOrder } from "@/lib/api";

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
        <ApiErrorState failure={result.error} headingLevel="h2" />
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
            </dl>
          </Card>

          <section aria-labelledby="order-lines">
            <h2 id="order-lines" className="lsw-display text-heading-lg text-text">
              {t("linesHeading")}
            </h2>

            <div className="mt-s4">
              <OrderLineList lines={result.data.items} locale={locale} />
            </div>
          </section>

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
