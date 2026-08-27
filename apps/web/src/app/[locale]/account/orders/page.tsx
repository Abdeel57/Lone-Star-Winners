import { buttonVariants, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { OrderCard } from "@/components/order-card";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchOrders } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Pedidos del participante.
 *
 * LA ZONA HORARIA SALE DE LA PROMOCION, aunque la fecha de un pedido no sea un
 * plazo legal. Es la unica zona DECLARADA que esta pagina conoce, y DEC-011
 * prohibe caer en la del navegador: sin promocion abierta se usa UTC explicito,
 * que es una eleccion visible en el codigo en vez de una que depende de donde
 * este quien mira.
 *
 * Paginacion por cursor en la URL, igual que el historial y por las mismas
 * razones.
 */
export default async function AccountOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("account.orders");
  const tAccount = await getTranslations("account");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("title")} current="/account/orders">
        <SignInRequired returnPath="/account/orders" />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("title")} current="/account/orders">
        <MfaRequired returnPath="/account/orders" />
      </AccountShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <AccountShell title={t("title")} current="/account/orders">
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AccountShell>
    );
  }

  const query = await searchParams;
  const cursor = typeof query.cursor === "string" && query.cursor.length > 0 ? query.cursor : null;

  const [result, promotionResult] = await Promise.all([
    fetchOrders({ ...(cursor === null ? {} : { cursor }) }, locale, session),
    fetchActivePromotion(locale),
  ]);

  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : "UTC";

  return (
    <AccountShell title={t("title")} current="/account/orders">
      <div className="flex flex-col gap-s6">
        <p className="max-w-[52rem] text-body-sm text-text-muted">{t("intro")}</p>

        {!result.ok ? (
          <ApiErrorState failure={result.error} headingLevel="h2" />
        ) : result.data.items.length === 0 ? (
          <EmptyState
            headingLevel="h2"
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Link href="/shop" className={buttonVariants({ variant: "accent" })}>
                {t("browse")}
              </Link>
            }
          />
        ) : (
          <>
            <ul className="flex list-none flex-col gap-s4">
              {result.data.items.map((order) => (
                <li key={order.id}>
                  <OrderCard order={order} locale={locale} timeZone={timeZone} />
                </li>
              ))}
            </ul>

            {result.data.next_cursor === null ? null : (
              <div>
                <Link
                  href={`/account/orders?cursor=${encodeURIComponent(result.data.next_cursor)}`}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  {tAccount("ledger.loadMore")}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AccountShell>
  );
}
