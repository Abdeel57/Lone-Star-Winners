import { Alert, buttonVariants, Card, CardTitle, StatCard } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AmoeCallout } from "@/components/amoe-callout";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryOfferPanel } from "@/components/entry-offer-panel";
import { PromotionCountdown } from "@/components/promotion-countdown";
import { PromotionStateNotice } from "@/components/promotion-state-notice";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";
import { PromotionTimeline } from "@/components/promotion-timeline";
import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchPromotion, pickLocalized } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/flags";
import { loadServerUiConfig } from "@/lib/flags-server";
import { presentPromotion } from "@/lib/promotion-state";

/**
 * Render por peticion, siempre (DEC-013).
 *
 * Esta pagina lee feature flags legalmente materiales y contenido gobernado por
 * las Official Rules. Si se prerenderizara en el build, esos valores quedarian
 * CONGELADOS en el HTML: apagar la via gratuita de participacion o publicar una
 * version nueva de reglas no tendria efecto hasta el siguiente despliegue.
 *
 * Hoy las llamadas usan `cache: "no-store"`, lo que ya saca a la ruta
 * del prerender. Se declara ademas de forma EXPLICITA porque esa propiedad es
 * emergente: bastaria con que alguien anadiera un `revalidate` a una de
 * las llamadas para que la pagina volviera a ser estatica sin que nada fallara.
 */
export const dynamic = "force-dynamic";

/**
 * Detalle de una promocion.
 *
 * Es la pagina que tiene que seguir siendo util DESPUES de que la promocion
 * cierre. Por eso la linea temporal muestra los seis pasos y el aviso de estado
 * explica en cual se esta: entre el cierre y el ganador confirmado hay un tramo
 * en el que esta pagina es la unica respuesta que tiene el participante.
 *
 * Un 404 del backend se convierte en un 404 de Next, no en un estado vacio: la
 * ruta apunta a un `slug` concreto, y un estado vacio sugeriria que la
 * promocion existe pero esta callada.
 */
export default async function PromotionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const nowIso = new Date().toISOString();

  const [result, uiConfig] = await Promise.all([
    fetchPromotion(slug, locale),
    loadServerUiConfig(locale),
  ]);

  if (!result.ok && result.error.status === 404) notFound();

  if (!result.ok) {
    return (
      <div className="lsw-container py-s10">
        <ApiErrorState failure={result.error} headingLevel="h1" />
      </div>
    );
  }

  const promotion = result.data;
  const presentation = presentPromotion(promotion.status);
  const hasRules = promotion.rules_version_id !== null;

  const opensAt = formatZonedDateTime(promotion.starts_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });
  const closesAt = formatZonedDateTime(promotion.ends_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });

  // `formatMoney` devuelve `null` cuando el importe no respeta DEC-010. Se
  // resuelve una sola vez para que el JSX no decida dos veces lo mismo.
  const declaredValue = promotion.prize?.declared_value ?? null;
  const prizeValue = declaredValue === null ? null : formatMoney(declaredValue, locale);

  return (
    <div className="lsw-container py-s10">
      <Link
        href="/promotions"
        className="inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted underline underline-offset-4 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {t("promotion.backToPromotions")}
      </Link>

      <div className="mt-s4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="max-w-narrow text-display-md font-bold text-text">
          {pickLocalized(promotion.title, locale)}
        </h1>
        <PromotionStatusBadge status={promotion.status} className="shrink-0" />
      </div>

      <p className="mt-s4 max-w-narrow text-body-lg text-text-muted">
        {pickLocalized(promotion.summary, locale)}
      </p>

      <div className="mt-s6 flex flex-col gap-3">
        <PromotionStateNotice presentation={presentation} />
        {hasRules ? null : <Alert tone="warning">{t("home.rulesNotPublished")}</Alert>}
      </div>

      {presentation.countdownTarget === null ? null : (
        <div className="mt-s8">
          <PromotionCountdown
            targetIso={
              presentation.countdownTarget === "starts_at" ? promotion.starts_at : promotion.ends_at
            }
            nowIso={nowIso}
            locale={locale}
            timeZone={promotion.legal_timezone}
            variant={presentation.countdownTarget === "starts_at" ? "opens" : "closes"}
          />
        </div>
      )}

      {promotion.prize === null ? null : (
        <section aria-labelledby="prize" className="mt-s10">
          <h2 id="prize" className="text-heading-lg font-semibold text-text">
            {t("promotion.prizeHeading")}
          </h2>

          <Card elevation="flat" padding="lg" className="mt-s4">
            <CardTitle as="h3" size="md">
              {pickLocalized(promotion.prize.name, locale)}
            </CardTitle>

            <p className="mt-s3 max-w-narrow text-body-md text-text-muted">
              {pickLocalized(promotion.prize.description, locale)}
            </p>

            {prizeValue === null ? null : (
              <div className="mt-s5 max-w-xs">
                <StatCard label={t("promotion.prizeValueLabel")} value={prizeValue} />
              </div>
            )}
          </Card>
        </section>
      )}

      <section aria-labelledby="details" className="mt-s10">
        <h2 id="details" className="text-heading-lg font-semibold text-text">
          {t("promotion.detailsHeading")}
        </h2>

        <dl className="mt-s4 grid gap-4 sm:grid-cols-2">
          {opensAt === null ? null : (
            <Card padding="sm" elevation="flat">
              <dt className="text-label font-medium text-text-muted">{t("home.opensLabel")}</dt>
              <dd className="mt-1 text-body-md font-semibold text-text">
                <time dateTime={promotion.starts_at}>{opensAt}</time>
              </dd>
            </Card>
          )}

          {closesAt === null ? null : (
            <Card padding="sm" elevation="flat">
              <dt className="text-label font-medium text-text-muted">{t("home.closesLabel")}</dt>
              <dd className="mt-1 text-body-md font-semibold text-text">
                <time dateTime={promotion.ends_at}>{closesAt}</time>
              </dd>
            </Card>
          )}
        </dl>

        <p className="mt-s3 text-caption text-text-subtle">{t("home.timeZoneNote")}</p>
      </section>

      <div className="mt-s8 grid gap-4 lg:grid-cols-2">
        <EntryOfferPanel
          offer={promotion.entry_offer}
          presentation={presentation}
          multipliersEnabled={isFeatureEnabled(uiConfig.flags, "entry_multipliers_enabled")}
          locale={locale}
          timeZone={promotion.legal_timezone}
        />

        <AmoeCallout
          enabled={isFeatureEnabled(uiConfig.flags, "amoe_enabled")}
          mode={uiConfig.amoeMode}
        />
      </div>

      {promotion.administrator_name === null ? null : (
        <Card as="section" elevation="flat" padding="md" className="mt-s4">
          <CardTitle as="h2" size="sm">
            {t("promotion.administratorHeading")}
          </CardTitle>
          <p className="mt-s3 text-body-md text-text-muted">{t("promotion.administratorBody")}</p>
          {/* Nombre propio de una empresa: se pinta tal cual y no se traduce. */}
          <p className="mt-s2 text-body-md font-semibold text-text">
            {promotion.administrator_name}
          </p>
        </Card>
      )}

      {/* `winner_publication_enabled` gobierna si esta seccion EXISTE. Con el
          flag apagado no se renderiza nada: no hay hueco ni promesa. Con el
          encendido y sin ganador publicado, se dice exactamente eso. */}
      {promotion.status === "COMPLETED" &&
      isFeatureEnabled(uiConfig.flags, "winner_publication_enabled") ? (
        <Alert tone="info" className="mt-s4">
          {t("promotion.winnerPendingPublication")}
        </Alert>
      ) : null}

      {/* La llamada a la tienda solo aparece cuando la maquina de estados dice
          que procede. Invitar a pedir mercancia "para esta promocion" sobre una
          promocion que ya cerro seria una afirmacion falsa, no un enlace de
          mas. */}
      {presentation.showsShopCta ? (
        <div className="mt-s8">
          <Link href="/shop" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            {t("home.shopCta")}
          </Link>
        </div>
      ) : null}

      {presentation.showsTimeline ? (
        <section aria-labelledby="timeline" className="mt-s10">
          <h2 id="timeline" className="text-heading-lg font-semibold text-text">
            {t("promotion.timelineHeading")}
          </h2>

          <div className="mt-s5 max-w-narrow">
            <PromotionTimeline status={promotion.status} />
          </div>
        </section>
      ) : null}

      {hasRules ? (
        <div className="mt-s10">
          <Link
            href={`/official-rules?promotion=${promotion.slug}`}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            {t("home.viewOfficialRules")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
