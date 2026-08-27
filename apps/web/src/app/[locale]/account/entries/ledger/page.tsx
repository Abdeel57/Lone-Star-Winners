import { Alert, buttonVariants, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryLedgerList } from "@/components/entry-ledger-list";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchEntryTransactions } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Historial del ledger.
 *
 * LA PAGINACION ES POR CURSOR Y VIVE EN LA URL
 * --------------------------------------------
 * `?cursor=` y un enlace. No hay scroll infinito, no hay estado de cliente y no
 * se acumulan paginas en memoria. Tres razones, en este orden:
 *
 * 1. Un historial de participaciones es algo que se ENSENA -a soporte, a un
 *    administrador, a uno mismo dentro de seis meses- y una URL que reproduce
 *    exactamente lo que se estaba viendo vale mas que una animacion.
 * 2. Funciona sin JavaScript, igual que el resto de la aplicacion.
 * 3. El cursor es OPACO: se transporta y no se interpreta. Con scroll infinito
 *    habria que guardarlo en cliente, y guardar en cliente el puntero de una
 *    lista de movimientos legalmente materiales no aporta nada.
 *
 * `next_cursor: null` significa que no hay mas. La ausencia de enlace ES el
 * final de la lista, y no hace falta decir nada mas.
 */
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("account.ledger");
  const tAccount = await getTranslations("account");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <SignInRequired returnPath="/account/entries/ledger" />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <MfaRequired returnPath="/account/entries/ledger" />
      </AccountShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AccountShell>
    );
  }

  const promotionResult = await fetchActivePromotion(locale);
  const promotion = promotionResult.ok ? promotionResult.data : null;

  if (promotion === null) {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <Alert tone="info">{tAccount("overview.noPromotion")}</Alert>
      </AccountShell>
    );
  }

  const query = await searchParams;
  const cursor = typeof query.cursor === "string" && query.cursor.length > 0 ? query.cursor : null;

  const result = await fetchEntryTransactions(
    { promotion_id: promotion.id, ...(cursor === null ? {} : { cursor }) },
    locale,
    session,
  );

  return (
    <AccountShell title={t("title")} current="/account/entries">
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
                {tAccount("overview.browseShop")}
              </Link>
            }
          />
        ) : (
          <>
            <EntryLedgerList
              transactions={result.data.items}
              locale={locale}
              timeZone={promotion.legal_timezone}
            />

            <p className="text-caption text-text-subtle">{t("timeZoneNote")}</p>

            {result.data.next_cursor === null ? null : (
              <div>
                <Link
                  href={`/account/entries/ledger?cursor=${encodeURIComponent(result.data.next_cursor)}`}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  {t("loadMore")}
                </Link>
              </div>
            )}
          </>
        )}

        <div>
          <Link
            href="/account/entries"
            className="text-body-sm text-text-muted underline underline-offset-4"
          >
            {t("back")}
          </Link>
        </div>
      </div>
    </AccountShell>
  );
}
