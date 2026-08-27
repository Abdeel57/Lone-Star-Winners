import { Alert, Badge, Card, CardTitle } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryCalculationTrace } from "@/components/entry-calculation-trace";
import { OrderLineList } from "@/components/order-line-list";
import {
  useOrderEntryStateBody,
  useOrderEntryStateLabel,
  useOrderStatusLabel,
} from "@/i18n/account-labels";
import { formatEntryCount, formatMoney, formatZonedDate } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchOrder, type OrderDetail, type PostalAddress } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Detalle de un pedido.
 *
 * ES LA PANTALLA QUE TIENE QUE PODER EXPLICAR UNA CIFRA
 * -----------------------------------------------------
 * No basta con decir cuantas participaciones dio este pedido: hay que poder
 * decir POR QUE dio esas y no otras. Por eso la traza del calculo
 * (`entry_calculation`) es parte de la pantalla y no un detalle escondido, y
 * por eso viaja con la version de reglas y la del motor contra las que se
 * evaluo (DEC-012).
 *
 * EL ESTADO DEL PEDIDO Y EL DE SUS PARTICIPACIONES SE PINTAN POR SEPARADO. Que
 * un pedido este pagado no significa que las participaciones esten otorgadas:
 * las genera el backend al recibir la confirmacion del proveedor de pago, no
 * cuando el navegador llega a una pagina. Deducir una cosa de la otra seria
 * prometer algo que nadie ha dicho.
 */
export default async function AccountOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("account.order");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("numberLabel")} current="/account/orders">
        <SignInRequired returnPath={`/account/orders/${id}`} />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("numberLabel")} current="/account/orders">
        <MfaRequired returnPath={`/account/orders/${id}`} />
      </AccountShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <AccountShell title={t("numberLabel")} current="/account/orders">
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AccountShell>
    );
  }

  const [result, promotionResult] = await Promise.all([
    fetchOrder(id, locale, session),
    fetchActivePromotion(locale),
  ]);

  // Un pedido que no existe -o que no es de quien pregunta- es un 404 y no un
  // estado de error: el backend responde igual en los dos casos a proposito,
  // porque distinguirlos permitiria averiguar que pedidos existen.
  if (!result.ok && result.error.status === 404) notFound();

  if (!result.ok) {
    return (
      <AccountShell title={t("numberLabel")} current="/account/orders">
        <ApiErrorState failure={result.error} headingLevel="h2" />
      </AccountShell>
    );
  }

  const order = result.data;
  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : "UTC";

  return (
    <AccountShell title={`${t("numberLabel")} ${order.order_number}`} current="/account/orders">
      <div className="flex flex-col gap-s8">
        <OrderHeader order={order} locale={locale} timeZone={timeZone} />

        <section aria-labelledby="order-entries">
          <h2 id="order-entries" className="lsw-display text-heading-lg text-text">
            {t("entriesHeading")}
          </h2>

          <div className="mt-s4 flex flex-col gap-s4">
            <OrderEntryStatus order={order} locale={locale} />
            <EntryCalculationTrace
              calculation={order.entry_calculation}
              locale={locale}
              timeZone={timeZone}
            />
          </div>
        </section>

        <section aria-labelledby="order-items">
          <h2 id="order-items" className="lsw-display text-heading-lg text-text">
            {t("itemsHeading")}
          </h2>

          <div className="mt-s4">
            <OrderLineList lines={order.items} locale={locale} />
          </div>
        </section>

        <div className="grid gap-s6 md:grid-cols-2">
          <OrderTotals order={order} locale={locale} />
          <OrderAddress address={order.shipping_address} />
        </div>

        <div>
          <Link
            href="/account/orders"
            className="text-body-sm text-text-muted underline underline-offset-4"
          >
            {t("back")}
          </Link>
        </div>
      </div>
    </AccountShell>
  );
}

function OrderHeader({
  order,
  locale,
  timeZone,
}: {
  readonly order: OrderDetail;
  readonly locale: Locale;
  readonly timeZone: string;
}) {
  const t = useTranslations("account.orders");
  const statusLabel = useOrderStatusLabel();
  const placedAt = formatZonedDate(order.placed_at, locale, { timeZone });

  return (
    <div className="flex flex-wrap items-center gap-s3">
      <Badge tone="neutral">{statusLabel(order.status)}</Badge>
      {placedAt === null ? null : (
        <span className="text-caption text-text-subtle">{t("placedOn", { date: placedAt })}</span>
      )}
    </div>
  );
}

/**
 * Estado de las participaciones del pedido, con su explicacion.
 *
 * La etiqueta dice COMO se llama el estado y el cuerpo dice QUE significa. Sin
 * la segunda mitad, "pendiente" y "otorgadas" son dos palabras que quien acaba
 * de comprar no puede interpretar, y esa es exactamente la diferencia que este
 * producto no puede dejar ambigua.
 */
function OrderEntryStatus({
  order,
  locale,
}: {
  readonly order: OrderDetail;
  readonly locale: Locale;
}) {
  const label = useOrderEntryStateLabel();
  const body = useOrderEntryStateBody();

  return (
    <Alert
      tone={order.entry_state === "GRANTED" ? "success" : "info"}
      title={label(order.entry_state)}
    >
      <p>{body(order.entry_state)}</p>

      {order.entries_granted === null ? null : (
        <p className="mt-s2 font-display text-heading-md font-bold tabular-nums">
          {formatEntryCount(order.entries_granted, locale)}
        </p>
      )}
    </Alert>
  );
}

/**
 * Totales del pedido.
 *
 * `shipping_total` y `tax_total` pueden llegar a `null`, y entonces se dice que
 * todavia no estan determinados en vez de pintar un cero. Un cero afirma que no
 * hay gastos de envio; `null` significa que no se sabe, y confundirlos en la
 * pantalla de un pedido es una diferencia que alguien acaba reclamando.
 */
function OrderTotals({ order, locale }: { readonly order: OrderDetail; readonly locale: Locale }) {
  const t = useTranslations("account.order");

  const rows = [
    { label: t("subtotal"), money: order.subtotal },
    { label: t("shipping"), money: order.shipping_total },
    { label: t("tax"), money: order.tax_total },
    { label: t("total"), money: order.total },
  ] as const;

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("summaryHeading")}
      </CardTitle>

      <dl className="mt-s4 flex flex-col gap-s2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-s3">
            <dt className="text-body-sm text-text-muted">{row.label}</dt>
            <dd className="text-body-sm tabular-nums text-text">
              {row.money === null
                ? t("notDetermined")
                : (formatMoney(row.money, locale) ?? t("notDetermined"))}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * Direccion de envio.
 *
 * Se pinta LINEA A LINEA tal como llega, sin recomponerla en un formato
 * nacional concreto: el orden de ciudad, region y codigo postal no es el mismo
 * en todas partes, y una plantilla fija seria una regla de jurisdiccion
 * escondida en una pantalla.
 */
function OrderAddress({ address }: { readonly address: PostalAddress | null }) {
  const t = useTranslations("account.order");

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("addressHeading")}
      </CardTitle>

      {address === null ? (
        <p className="mt-s4 text-body-sm text-text-muted">{t("noAddress")}</p>
      ) : (
        <address className="mt-s4 not-italic text-body-sm text-text-muted">
          {[
            address.full_name,
            address.line1,
            address.line2,
            address.city,
            address.region,
            address.postal_code,
            address.country,
          ]
            .filter((line): line is string => line !== null && line.length > 0)
            .map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
        </address>
      )}
    </Card>
  );
}
