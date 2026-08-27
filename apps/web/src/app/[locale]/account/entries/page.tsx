import { Alert, buttonVariants, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryBatchList } from "@/components/entry-batch-list";
import { EntrySummaryCards } from "@/components/entry-summary-cards";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  fetchActivePromotion,
  fetchEntryBatches,
  fetchEntrySummary,
  pickLocalized,
} from "@/lib/api";
import { isFeatureEnabled } from "@/lib/flags";
import { loadFeatureFlags } from "@/lib/flags-server";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Mis participaciones.
 *
 * LOS RANGOS DE NUMEROS SOLO SE PIDEN SI EL FLAG ESTA ENCENDIDO
 * ------------------------------------------------------------
 * `visible_entry_numbers_enabled` esta apagado por defecto y con el apagado el
 * backend responde 404. Con el flag apagado esta pagina NO hace la peticion: no
 * es una optimizacion, es que pedir un recurso sabiendo que va a responder 404
 * convierte un estado normal en un error en los registros, y el dia que alguien
 * mire por que hay 404 en produccion, encontrara este.
 *
 * El flag se lee EN SERVIDOR, en la misma peticion que el render (DEC-013).
 *
 * NINGUNA CIFRA SE DERIVA AQUI. El saldo llega calculado y los rangos llegan
 * asignados; esta pagina los coloca.
 */
export default async function AccountEntriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("account.entries");
  const tAccount = await getTranslations("account");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <SignInRequired returnPath="/account/entries" />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <MfaRequired returnPath="/account/entries" />
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

  const [promotionResult, flags] = await Promise.all([
    fetchActivePromotion(locale),
    loadFeatureFlags(locale),
  ]);

  const promotion = promotionResult.ok ? promotionResult.data : null;

  if (promotion === null) {
    return (
      <AccountShell title={t("title")} current="/account/entries">
        <Alert tone="info">{tAccount("overview.noPromotion")}</Alert>
      </AccountShell>
    );
  }

  const numbersVisible = isFeatureEnabled(flags, "visible_entry_numbers_enabled");

  const [summaryResult, batchesResult] = await Promise.all([
    fetchEntrySummary(promotion.id, locale, session),
    numbersVisible
      ? fetchEntryBatches({ promotion_id: promotion.id }, locale, session)
      : Promise.resolve(null),
  ]);

  return (
    <AccountShell title={t("title")} current="/account/entries">
      <div className="flex flex-col gap-s8">
        <section aria-labelledby="entries-summary">
          <h2 id="entries-summary" className="lsw-display text-heading-lg text-text">
            {pickLocalized(promotion.title, locale)}
          </h2>

          <p className="mt-s3 text-body-sm text-text-muted">{t("intro")}</p>

          <div className="mt-s5">
            {!summaryResult.ok ? (
              <ApiErrorState failure={summaryResult.error} headingLevel="h3" />
            ) : summaryResult.data.active_entries === 0 ? (
              <EmptyState
                headingLevel="h3"
                title={t("emptyTitle")}
                description={t("emptyBody")}
                action={
                  <Link href="/shop" className={buttonVariants({ variant: "accent" })}>
                    {tAccount("overview.browseShop")}
                  </Link>
                }
              />
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
              href="/account/entries/ledger"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {t("viewLedger")}
            </Link>
          </div>
        </section>

        {/*
         * TODA la seccion de numeros desaparece con el flag apagado.
         *
         * No se pinta un estado "no disponible", ni un titulo con el cuerpo
         * vacio: una funcion desactivada no se ensena a medias. Con el flag
         * encendido, en cambio, un fallo de lectura SI se dice, porque entonces
         * el participante espera ver algo.
         */}
        {batchesResult === null ? null : (
          <section aria-labelledby="entries-batches">
            <h2 id="entries-batches" className="lsw-display text-heading-lg text-text">
              {t("batchesHeading")}
            </h2>

            <div className="mt-s4">
              {batchesResult.ok ? (
                <EntryBatchList batches={batchesResult.data.items} locale={locale} />
              ) : (
                <Alert tone="warning">{t("batchesUnavailable")}</Alert>
              )}
            </div>
          </section>
        )}
      </div>
    </AccountShell>
  );
}
