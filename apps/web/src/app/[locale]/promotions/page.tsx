import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";
import { formatZonedDate } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchPromotions, pickLocalized } from "@/lib/api";

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
    <div className="lsw-container py-s10">
      <h1 className="text-display-md font-bold text-text">{t("promotion.listHeading")}</h1>
      <p className="mt-s3 max-w-narrow text-body-lg text-text-muted">{t("promotion.listIntro")}</p>

      <div className="mt-s8">
        {!result.ok ? (
          <ApiErrorState failure={result.error} headingLevel="h2" />
        ) : result.data.items.length === 0 ? (
          <EmptyState headingLevel="h2" title={t("promotion.notListed")} />
        ) : (
          <ul className="grid list-none gap-4 sm:grid-cols-2">
            {result.data.items.map((promotion) => {
              const closesAt = formatZonedDate(promotion.ends_at, locale, {
                timeZone: promotion.legal_timezone,
              });

              return (
                <Card as="li" key={promotion.id} elevation="flat">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle as="h2" size="sm">
                      {pickLocalized(promotion.title, locale)}
                    </CardTitle>
                    <PromotionStatusBadge status={promotion.status} className="shrink-0" />
                  </div>

                  <p className="mt-s3 text-body-sm text-text-muted">
                    {pickLocalized(promotion.summary, locale)}
                  </p>

                  {closesAt === null ? null : (
                    <p className="mt-s3 text-caption text-text-subtle">
                      <span className="mr-1">{t("home.closesLabel")}</span>
                      <time dateTime={promotion.ends_at}>{closesAt}</time>
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
