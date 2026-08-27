import { buttonVariants, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { AmoeSubmissionList } from "@/components/amoe-submission-list";
import { ApiErrorState } from "@/components/api-error-state";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchAmoeSubmissions } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/flags";
import { loadFeatureFlags } from "@/lib/flags-server";
import { loadSession } from "@/lib/participant-server";

/** Los envios son de una sesion concreta: nunca se prerenderiza. */
export const dynamic = "force-dynamic";

/**
 * Mis envios de participacion gratuita.
 *
 * CON LA VIA APAGADA LA RUTA SIGUE EXISTIENDO Y NO SE ROMPE. Alguien puede
 * tener envios de una promocion anterior y llegar aqui desde un marcador. Se
 * dice que la via no esta disponible ahora mismo y se remite a las Reglas
 * Oficiales, en vez de un 404 que sugeriria que la pagina nunca existio.
 *
 * NO SE PIDEN LOS ENVIOS CON EL FLAG APAGADO. El contrato dice que la seccion
 * AMOE responde 404 con `amoe_enabled` apagado, asi que pedirlos produciria un
 * estado de error donde no hay ningun error.
 */
export default async function AccountAmoePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "amoe.account" });
  const { session, state } = await loadSession(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("title")} current="/account/amoe">
        <SignInRequired returnPath="/account/amoe" />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("title")} current="/account/amoe">
        <MfaRequired returnPath="/account/amoe" />
      </AccountShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <AccountShell title={t("title")} current="/account/amoe">
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AccountShell>
    );
  }

  const flags = await loadFeatureFlags(locale);

  if (!isFeatureEnabled(flags, "amoe_enabled")) {
    return (
      <AccountShell title={t("title")} current="/account/amoe">
        <EmptyState
          headingLevel="h2"
          title={t("disabledTitle")}
          description={t("disabledBody")}
          action={
            <Link href="/official-rules" className={buttonVariants({ variant: "secondary" })}>
              {t("officialRulesCta")}
            </Link>
          }
        />
      </AccountShell>
    );
  }

  const result = await fetchAmoeSubmissions({}, locale, session);

  return (
    <AccountShell title={t("title")} current="/account/amoe">
      {!result.ok ? (
        <ApiErrorState failure={result.error} headingLevel="h2" />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          headingLevel="h2"
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            <Link href="/amoe" className={buttonVariants({ variant: "accent" })}>
              {t("howToCta")}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-s6">
          <AmoeSubmissionList submissions={result.data.items} locale={locale} />

          <p className="text-body-sm text-text-muted">
            <Link href="/amoe" className="underline underline-offset-4">
              {t("howToCta")}
            </Link>
          </p>
        </div>
      )}
    </AccountShell>
  );
}
