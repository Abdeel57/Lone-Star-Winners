import { Alert, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { UnverifiedEmailNotice } from "@/components/email-verification";
import { EntrySummaryCards } from "@/components/entry-summary-cards";
import { OrderCard } from "@/components/order-card";
import { formatZonedDate } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchEntrySummary, fetchOrders, pickLocalized } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

/** Un resumen de cuenta es de una sesion concreta: nunca se prerenderiza. */
export const dynamic = "force-dynamic";

/**
 * Resumen de la cuenta.
 *
 * QUE SE LEE, Y EN QUE ORDEN
 * --------------------------
 * La sesion primero -sin ella no hay nada que pedir- y despues, EN PARALELO, la
 * promocion activa y los ultimos pedidos. El saldo de participaciones necesita
 * el `promotion_id`, asi que va detras; es la unica dependencia real, y por eso
 * es la unica espera encadenada.
 *
 * TODO ESTADO SE PINTA, NINGUNO SE ADIVINA
 * ----------------------------------------
 * Sin sesion se pide iniciarla; si la sesion no se puede leer se pinta el error
 * con su referencia; si no hay promocion abierta se dice, y el saldo
 * sencillamente no se pide, porque un saldo sin promocion contra la que
 * medirlo no significa nada.
 *
 * NINGUNA CIFRA SALE DE AQUI. Ni una suma, ni una resta, ni un recuento: todo
 * llega calculado (DEC-023, requisito R13 de `security`).
 */
export default async function AccountOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("account");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("title")} current="/account">
        <SignInRequired returnPath="/account" />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("title")} current="/account">
        <MfaRequired returnPath="/account" />
      </AccountShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <AccountShell title={t("title")} current="/account">
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AccountShell>
    );
  }

  const { participant } = state;

  const [promotionResult, ordersResult] = await Promise.all([
    fetchActivePromotion(locale),
    fetchOrders({ limit: 3 }, locale, session),
  ]);

  const promotion = promotionResult.ok ? promotionResult.data : null;

  const summaryResult =
    promotion === null ? null : await fetchEntrySummary(promotion.id, locale, session);

  const closesAt =
    promotion === null
      ? null
      : formatZonedDate(promotion.ends_at, locale, { timeZone: promotion.legal_timezone });

  return (
    <AccountShell title={t("title")} current="/account">
      <div className="flex flex-col gap-s8">
        <div>
          <p className="lsw-display text-heading-lg text-text">
            {t("overview.greeting", { name: participant.display_name ?? participant.email })}
          </p>

          <p className="mt-s2 text-caption text-text-subtle">
            {t("overview.memberSince", {
              // El alta de una cuenta NO es un instante legalmente relevante de
              // ninguna promocion, asi que no hay zona legal declarada contra la
              // que formatearlo. Se usa UTC explicito en vez de caer en la del
              // navegador, que es lo que DEC-011 prohibe.
              date: formatZonedDate(participant.created_at, locale, { timeZone: "UTC" }) ?? "",
            })}
          </p>
        </div>

        {participant.email_verified ? null : (
          <UnverifiedEmailNotice locale={locale} email={participant.email} />
        )}

        <section aria-labelledby="account-promotion">
          <h2 id="account-promotion" className="lsw-display text-heading-lg text-text">
            {t("overview.promotionHeading")}
          </h2>

          {promotion === null ? (
            <Alert tone="info" className="mt-s4">
              {t("overview.noPromotion")}
            </Alert>
          ) : (
            <Card elevation="raised" padding="lg" className="mt-s4">
              <CardTitle as="h3" size="sm">
                {pickLocalized(promotion.title, locale)}
              </CardTitle>

              {closesAt === null ? null : (
                <p className="mt-s2 text-caption text-text-subtle">
                  {t("overview.closesLabel")}: {closesAt}
                </p>
              )}

              <h4 className="mt-s5 text-label font-medium text-text">
                {t("overview.entriesHeading")}
              </h4>

              <div className="mt-s3">
                {summaryResult === null ? null : !summaryResult.ok ? (
                  <ApiErrorState failure={summaryResult.error} headingLevel="h4" />
                ) : (
                  <EntrySummaryCards
                    summary={summaryResult.data}
                    locale={locale}
                    timeZone={promotion.legal_timezone}
                  />
                )}
              </div>

              <div className="mt-s5">
                <Link
                  href="/account/entries"
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  {t("overview.viewEntries")}
                </Link>
              </div>
            </Card>
          )}
        </section>

        <section aria-labelledby="account-orders">
          <h2 id="account-orders" className="lsw-display text-heading-lg text-text">
            {t("overview.ordersHeading")}
          </h2>

          <div className="mt-s4">
            {!ordersResult.ok ? (
              <ApiErrorState failure={ordersResult.error} headingLevel="h3" />
            ) : ordersResult.data.items.length === 0 ? (
              <EmptyState
                headingLevel="h3"
                title={t("overview.noOrders")}
                description={t("orders.emptyBody")}
                action={
                  <Link href="/shop" className={buttonVariants({ variant: "accent" })}>
                    {t("overview.browseShop")}
                  </Link>
                }
              />
            ) : (
              <>
                <ul className="flex list-none flex-col gap-s4">
                  {ordersResult.data.items.map((order) => (
                    <li key={order.id}>
                      <OrderCard
                        order={order}
                        locale={locale}
                        timeZone={promotion?.legal_timezone ?? "UTC"}
                      />
                    </li>
                  ))}
                </ul>

                <div className="mt-s5">
                  <Link
                    href="/account/orders"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    {t("overview.viewAllOrders")}
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </AccountShell>
  );
}
