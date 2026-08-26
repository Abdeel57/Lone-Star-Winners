import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";
import { SectionHeading } from "@/components/section-heading";
import { formatZonedDate } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchPromotions, pickLocalized } from "@/lib/api";
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
 * Listado de promociones.
 *
 * Se listan TODAS, no solo la abierta. Una promocion cerrada o en verificacion
 * sigue teniendo participantes esperando noticias, y su pagina es donde se les
 * cuenta en que punto esta el proceso.
 *
 * Cada tarjeta muestra el estado con la misma insignia que el resto del sitio:
 * el estado se traduce en un solo sitio (`src/i18n/promotion-labels.ts`) para
 * que la portada y el listado no puedan discrepar.
 */
export default async function PromotionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const result = await fetchPromotions(locale);

  return (
    <div className="pb-s16">
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container">
          <SectionHeading
            title={t("promotion.listHeading")}
            lead={t("promotion.listIntro")}
            level="h1"
            size="lg"
          />
        </div>
      </div>

      <div className="lsw-container pt-s10">
        {!result.ok ? (
          <ApiErrorState failure={result.error} headingLevel="h2" />
        ) : result.data.items.length === 0 ? (
          <EmptyState headingLevel="h2" title={t("promotion.notListed")} />
        ) : (
          <ul className="grid list-none gap-s5 sm:grid-cols-2">
            {result.data.items.map((promotion) => {
              /*
               * La fecha de la tarjeta depende del estado.
               *
               * Con "Cierra el 30 de agosto de 2024" bajo una promocion
               * FINALIZADA, la tarjeta se contradice a si misma: anuncia en
               * presente algo que ya paso. Y una promocion que todavia no ha
               * abierto tiene una fecha mas util que la de cierre.
               *
               * Las tres ramas salen de la misma maquina de estados que el
               * resto del sitio (`presentPromotion`), no de una lista de
               * estados escrita aparte que pueda desincronizarse.
               */
              const presentation = presentPromotion(promotion.status);
              const showsOpening = presentation.countdownTarget === "starts_at";

              const dateIso = showsOpening ? promotion.starts_at : promotion.ends_at;
              const dateLabel = showsOpening
                ? t("home.opensLabel")
                : presentation.acceptsEntries
                  ? t("home.closesLabel")
                  : t("promotion.closedOnLabel");

              const shownDate = formatZonedDate(dateIso, locale, {
                timeZone: promotion.legal_timezone,
              });

              return (
                <Card
                  as="li"
                  key={promotion.id}
                  elevation="flat"
                  padding="lg"
                  className="flex flex-col transition-colors duration-base ease-standard hover:border-brand/45"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CardTitle as="h2" size="md">
                      {pickLocalized(promotion.title, locale)}
                    </CardTitle>
                    <PromotionStatusBadge
                      status={promotion.status}
                      size="sm"
                      className="shrink-0"
                    />
                  </div>

                  <p className="mt-s4 flex-1 text-body-md text-text-muted">
                    {pickLocalized(promotion.summary, locale)}
                  </p>

                  {shownDate === null ? null : (
                    <p className="mt-s5 border-t border-border pt-s4 text-caption text-text-subtle">
                      <span className="mr-1 font-display uppercase tracking-wide text-brand">
                        {dateLabel}
                      </span>
                      <time dateTime={dateIso} className="tabular-nums">
                        {shownDate}
                      </time>
                    </p>
                  )}

                  <div className="mt-s5">
                    <Link
                      href={`/promotions/${promotion.slug}`}
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                    >
                      {t("home.viewPromotion")}
                    </Link>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
