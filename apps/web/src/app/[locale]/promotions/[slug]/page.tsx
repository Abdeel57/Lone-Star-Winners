import { Alert, buttonVariants, Card, CardTitle } from "@lsw/ui";
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
import { SectionHeading } from "@/components/section-heading";
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

  /*
   * LA CUENTA ATRAS CAE CON LAS REGLAS SIN PUBLICAR (DEC-044).
   *
   * Mismo criterio que el hero de la portada, y por el mismo motivo: un
   * marcador contando hacia el cierre es el elemento de URGENCIA de la
   * pantalla, y no se puede meter prisa hacia el plazo de una promocion cuyo
   * documento rector todavia no existe. Debajo, esta misma pagina ya dice que
   * las Reglas Oficiales no estan publicadas; anunciarlo y a la vez llevar la
   * cuenta era decir dos cosas distintas en la misma pantalla.
   *
   * El plazo ESCRITO se queda -las dos tarjetas de apertura y cierre, y la nota
   * de zona horaria-: es la misma informacion sin el reclamo, y quien viene a
   * apuntarse la fecha la necesita. Es la linea que ya se trazo en el hero.
   *
   * La linea temporal tambien se queda: no cuenta hacia nada, describe en que
   * paso del proceso esta la promocion, que es lo que esta pagina existe para
   * responder incluso despues del cierre.
   */
  const countdownTarget = hasRules ? presentation.countdownTarget : null;

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
  // La API real no publica `prize` (HO-039): ausencia y `null` pintan lo mismo.
  const prize = promotion.prize ?? null;
  const declaredValue = prize?.declared_value ?? null;
  const prizeValue = declaredValue === null ? null : formatMoney(declaredValue, locale);

  return (
    <div className="pb-s16">
      <div className="lsw-atmosphere lsw-grain relative isolate py-s10 lg:py-s16">
        <div className="lsw-container">
          <Link href="/promotions" className={BACK_LINK}>
            {t("promotion.backToPromotions")}
          </Link>

          <div className="mt-s6 flex flex-wrap items-center gap-3">
            <PromotionStatusBadge status={promotion.status} size="sm" />
          </div>

          <h1 className="lsw-display mt-s4 max-w-4xl text-display-md text-text sm:text-display-lg">
            {pickLocalized(promotion.title, locale)}
          </h1>

          <p className="mt-s5 max-w-narrow text-body-lg text-text-muted">
            {pickLocalized(promotion.summary, locale)}
          </p>

          {countdownTarget === null ? null : (
            <div className="mt-s8">
              <PromotionCountdown
                targetIso={
                  countdownTarget === "starts_at" ? promotion.starts_at : promotion.ends_at
                }
                nowIso={nowIso}
                locale={locale}
                timeZone={promotion.legal_timezone}
                variant={countdownTarget === "starts_at" ? "opens" : "closes"}
                size="scoreboard"
              />
            </div>
          )}
        </div>
      </div>

      {/* Los avisos, en banda propia y al ancho de lectura: mismo criterio que
          en el hero de la portada (DEC-038). Un aviso de estado dentro de una
          composicion de titulares no se lee. */}
      <div className="lsw-band">
        <div className="lsw-container flex max-w-narrow flex-col gap-3 py-s8">
          <PromotionStateNotice presentation={presentation} />
          {hasRules ? null : <Alert tone="warning">{t("home.rulesNotPublished")}</Alert>}
        </div>
      </div>

      <div className="lsw-container pt-s12">
        {prize === null ? null : (
          <section aria-labelledby="prize">
            <SectionHeading id="prize" title={t("promotion.prizeHeading")} size="lg" />

            <Card elevation="raised" padding="lg" className="mt-s8">
              <CardTitle as="h3" size="lg">
                {pickLocalized(prize.name, locale)}
              </CardTitle>

              <p className="mt-s4 max-w-narrow text-body-lg text-text-muted">
                {pickLocalized(prize.description, locale)}
              </p>

              {prizeValue === null ? null : (
                <div className="mt-s6 inline-flex flex-col rounded-lg border border-brand/40 bg-brand/10 px-s6 py-s5">
                  <p className="lsw-eyebrow text-brand">{t("promotion.prizeValueLabel")}</p>
                  <p className="lsw-display lsw-gold-sheen mt-s2 text-display-md tabular-nums">
                    {prizeValue}
                  </p>
                </div>
              )}
            </Card>
          </section>
        )}

        <section aria-labelledby="details" className="mt-s12">
          <SectionHeading id="details" title={t("promotion.detailsHeading")} />

          <dl className="mt-s8 grid gap-s4 sm:grid-cols-2">
            {opensAt === null ? null : (
              <Card padding="md" elevation="flat">
                <dt className="lsw-eyebrow text-text-subtle">{t("home.opensLabel")}</dt>
                <dd className="mt-s2 text-body-lg font-semibold tabular-nums text-text">
                  <time dateTime={promotion.starts_at}>{opensAt}</time>
                </dd>
              </Card>
            )}

            {closesAt === null ? null : (
              <Card padding="md" elevation="flat">
                <dt className="lsw-eyebrow text-text-subtle">{t("home.closesLabel")}</dt>
                <dd className="mt-s2 text-body-lg font-semibold tabular-nums text-text">
                  <time dateTime={promotion.ends_at}>{closesAt}</time>
                </dd>
              </Card>
            )}
          </dl>

          <p className="mt-s4 text-caption text-text-subtle">{t("home.timeZoneNote")}</p>
        </section>

        <div className="mt-s10 grid gap-s5 lg:grid-cols-2">
          {/* `rulesPublished` es la MISMA senal que retira la cuenta atras
              arriba (DEC-044): sin documento que fije el ratio, el panel
              conserva el titulo y dice que falta, pero no publica la cifra. */}
          <EntryOfferPanel
            offer={promotion.entry_offer ?? null}
            presentation={presentation}
            multipliersEnabled={isFeatureEnabled(uiConfig.flags, "entry_multipliers_enabled")}
            rulesPublished={hasRules}
            locale={locale}
            timeZone={promotion.legal_timezone}
            nowIso={nowIso}
          />

          <AmoeCallout
            enabled={isFeatureEnabled(uiConfig.flags, "amoe_enabled")}
            mode={uiConfig.amoeMode}
          />
        </div>

        {promotion.administrator_name === null ? null : (
          <Card as="section" elevation="flat" padding="md" className="mt-s5">
            <CardTitle as="h2" size="sm">
              {t("promotion.administratorHeading")}
            </CardTitle>
            <p className="mt-s3 text-body-md text-text-muted">{t("promotion.administratorBody")}</p>
            {/* Nombre propio de una empresa: se pinta tal cual y no se traduce. */}
            <p className="mt-s3 font-display text-heading-md uppercase tracking-display text-brand">
              {promotion.administrator_name}
            </p>
          </Card>
        )}

        {/* `winner_publication_enabled` gobierna si esta seccion EXISTE. Con el
            flag apagado no se renderiza nada: no hay hueco ni promesa. Con el
            encendido y sin ganador publicado, se dice exactamente eso. */}
        {promotion.status === "COMPLETED" &&
        isFeatureEnabled(uiConfig.flags, "winner_publication_enabled") ? (
          <Alert tone="info" className="mt-s5">
            {t("promotion.winnerPendingPublication")}
          </Alert>
        ) : null}

        {/* La llamada a la tienda solo aparece cuando la maquina de estados dice
            que procede. Invitar a pedir mercancia "para esta promocion" sobre una
            promocion que ya cerro seria una afirmacion falsa, no un enlace de
            mas. */}
        {presentation.showsShopCta ? (
          <div className="mt-s10">
            <Link href="/shop" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              {t("home.shopCta")}
            </Link>
          </div>
        ) : null}

        {presentation.showsTimeline ? (
          <section aria-labelledby="timeline" className="mt-s12">
            <SectionHeading id="timeline" title={t("promotion.timelineHeading")} />

            <div className="mt-s8 max-w-narrow">
              <PromotionTimeline status={promotion.status} />
            </div>
          </section>
        ) : null}

        {hasRules ? (
          <div className="mt-s12 border-t border-border pt-s10">
            <Link
              href={`/official-rules?promotion=${promotion.slug}`}
              className={buttonVariants({ variant: "primary", size: "xl" })}
            >
              {t("home.viewOfficialRules")}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const BACK_LINK =
  "lsw-display inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
