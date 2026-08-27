import { Alert, Badge, buttonVariants, Card, CardTitle } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
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
import { fetchActivePromotion, fetchOrder, type OrderDetail } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Confirmacion de pedido.
 *
 * LO QUE ESTA PANTALLA PUEDE PROMETER, Y LO QUE NO
 * ------------------------------------------------
 * Puede decir que el pedido existe y en que estado esta, porque eso lo dice el
 * backend. NO puede decir que las participaciones estan otorgadas: las genera
 * el backend cuando la orden alcanza el estado que las Official Rules definan
 * como cualificante, a partir de la confirmacion del proveedor de pago, y NUNCA
 * porque el navegador haya llegado a esta URL.
 *
 * Por eso el bloque de participaciones pinta `entry_state` tal cual, con su
 * explicacion, y el numero solo aparece cuando el backend manda uno. El
 * recorrido esperado -"pendientes de confirmacion de pago" y despues
 * "otorgadas"- se ve recargando esta misma pagina, que es como debe ser: el
 * cambio lo produce el backend, no una animacion.
 *
 * ES UNA RUTA PUBLICA POR SU FORMA Y PRIVADA POR SU CONTENIDO. Cuelga de
 * `/orders/{id}` -que es la URL que alguien guarda o comparte consigo mismo-
 * pero el pedido se pide con la sesion, y sin ella se pide iniciarla. Un
 * identificador de pedido no autoriza a ver un pedido.
 */
export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("orderConfirmation");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <ConfirmationShell title={t("title")}>
        <SignInRequired returnPath={`/orders/${id}/confirmation`} />
      </ConfirmationShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <ConfirmationShell title={t("title")}>
        <MfaRequired returnPath={`/orders/${id}/confirmation`} />
      </ConfirmationShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <ConfirmationShell title={t("title")}>
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </ConfirmationShell>
    );
  }

  const [result, promotionResult] = await Promise.all([
    fetchOrder(id, locale, session),
    fetchActivePromotion(locale),
  ]);

  if (!result.ok && result.error.status === 404) notFound();

  if (!result.ok) {
    return (
      <ConfirmationShell title={t("title")}>
        <ApiErrorState failure={result.error} headingLevel="h2" />
      </ConfirmationShell>
    );
  }

  const order = result.data;
  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : "UTC";

  return (
    <ConfirmationShell title={t("title")} intro={t("intro")}>
      <div className="flex flex-col gap-s6">
        <OrderSummaryCard order={order} locale={locale} timeZone={timeZone} />
        <EntryStatusCard order={order} locale={locale} />

        <p className="text-caption text-text-subtle">{t("rulesNote")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/account/orders/${order.id}`}
            className={buttonVariants({ variant: "accent" })}
          >
            {t("viewOrder")}
          </Link>

          <Link href="/account/entries" className={buttonVariants({ variant: "secondary" })}>
            {t("viewEntries")}
          </Link>

          <Link href="/shop" className={buttonVariants({ variant: "ghost" })}>
            {t("continueShopping")}
          </Link>
        </div>
      </div>
    </ConfirmationShell>
  );
}

function OrderSummaryCard({
  order,
  locale,
  timeZone,
}: {
  readonly order: OrderDetail;
  readonly locale: Locale;
  readonly timeZone: string;
}) {
  const t = useTranslations("orderConfirmation");
  const tOrder = useTranslations("account.order");
  const tOrders = useTranslations("account.orders");
  const statusLabel = useOrderStatusLabel();

  const placedAt = formatZonedDate(order.placed_at, locale, { timeZone });
  const total = formatMoney(order.total, locale);

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("orderHeading")}
      </CardTitle>

      <div className="mt-s4 flex flex-wrap items-center gap-s3">
        <p className="lsw-display text-heading-md text-text">{order.order_number}</p>
        <Badge tone="neutral" size="sm">
          {statusLabel(order.status)}
        </Badge>
      </div>

      {placedAt === null ? null : (
        <p className="mt-s2 text-caption text-text-subtle">
          {tOrders("placedOn", { date: placedAt })}
        </p>
      )}

      <div className="mt-s5">
        <OrderLineList lines={order.items} locale={locale} />
      </div>

      {total === null ? null : (
        <p className="mt-s5 flex items-baseline justify-between gap-s3 border-t border-border pt-s3">
          <span className="text-body-sm text-text-muted">{tOrder("total")}</span>
          <span className="font-display text-heading-sm font-bold tabular-nums text-text">
            {total}
          </span>
        </p>
      )}
    </Card>
  );
}

/**
 * Estado de las participaciones del pedido.
 *
 * `entries_granted` a `null` NO se pinta como cero. Delante de alguien que
 * acaba de pagar, "0 participaciones" y "todavia no se sabe" son afirmaciones
 * muy distintas, y solo una de las dos es cierta en ese momento.
 */
function EntryStatusCard({
  order,
  locale,
}: {
  readonly order: OrderDetail;
  readonly locale: Locale;
}) {
  const t = useTranslations("orderConfirmation");
  const label = useOrderEntryStateLabel();
  const body = useOrderEntryStateBody();

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("entriesHeading")}
      </CardTitle>

      <div className="mt-s4">
        <Alert
          tone={order.entry_state === "GRANTED" ? "success" : "info"}
          title={label(order.entry_state)}
        >
          <p>{body(order.entry_state)}</p>

          {order.entries_granted === null ? null : (
            <p className="mt-s2 font-display text-display-sm font-bold tabular-nums">
              {formatEntryCount(order.entries_granted, locale)}
            </p>
          )}
        </Alert>
      </div>
    </Card>
  );
}

function ConfirmationShell({
  title,
  intro,
  children,
}: {
  readonly title: string;
  readonly intro?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="lsw-container py-s10 pb-s16">
      <div className="mx-auto w-full max-w-[44rem]">
        <h1 className="lsw-display text-display-sm text-text">{title}</h1>
        <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

        {intro === undefined ? null : <p className="mt-s4 text-body text-text-muted">{intro}</p>}

        <div className="mt-s8">{children}</div>
      </div>
    </div>
  );
}
