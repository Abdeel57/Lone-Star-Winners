import { EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { OfficialRulesDocumentView } from "@/components/official-rules-document";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchOfficialRules } from "@/lib/api";

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
 * Reglas Oficiales.
 *
 * POR QUE ACEPTA `?promotion=`
 * ----------------------------
 * Las Official Rules no son un documento "del sitio": pertenecen a una version
 * concreta de una promocion concreta (DEC-012). Pero el enlace tiene que
 * funcionar desde la cabecera y el pie, que no saben que promocion hay abierta.
 *
 * La solucion es una sola ruta que resuelve la promocion vigente cuando no se
 * le dice cual, y acepta un `slug` cuando si. Asi el enlace de navegacion nunca
 * apunta a un 404 y la pagina de detalle puede enlazar a SUS reglas, incluso si
 * esa promocion ya cerro.
 *
 * ESTA PAGINA NO CONTIENE NI UNA REGLA
 * ------------------------------------
 * Todo el texto legal llega del backend y se renderiza tal cual (DEC-022). Lo
 * unico que pone el frontend son las etiquetas de alrededor y el aviso de que
 * idioma es el legalmente controlante, que tambien se lee de los datos.
 */
export default async function OfficialRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const query = await searchParams;

  const requested = query.promotion;
  const requestedSlug = typeof requested === "string" && requested.length > 0 ? requested : null;

  // Sin `slug` explicito, las reglas son las de la promocion vigente.
  let slug = requestedSlug;
  if (slug === null) {
    const active = await fetchActivePromotion(locale);

    if (!active.ok) {
      return (
        <div className="lsw-container py-s10">
          <h1 className="text-display-md font-bold text-text">{t("officialRules.title")}</h1>
          <div className="mt-s6">
            <ApiErrorState failure={active.error} headingLevel="h2" />
          </div>
        </div>
      );
    }

    if (active.data === null) {
      return (
        <div className="lsw-container py-s10">
          <h1 className="text-display-md font-bold text-text">{t("officialRules.title")}</h1>
          <div className="mt-s6">
            <EmptyState
              headingLevel="h2"
              title={t("officialRules.noPromotion.title")}
              description={t("officialRules.noPromotion.body")}
            />
          </div>
        </div>
      );
    }

    slug = active.data.slug;
  }

  const result = await fetchOfficialRules(slug, locale);

  return (
    <div className="lsw-container max-w-narrow py-s10">
      <h1 className="text-display-md font-bold text-text">{t("officialRules.title")}</h1>

      <div className="mt-s6">
        {result.ok ? (
          <OfficialRulesDocumentView document={result.data} locale={locale} />
        ) : result.error.status === 404 ? (
          // Un 404 aqui NO es "pagina no encontrada": es "esta promocion aun no
          // tiene version de reglas publicada" (DEC-012), que es un estado
          // legitimo y hay que nombrarlo tal cual.
          <EmptyState
            headingLevel="h2"
            title={t("officialRules.notPublished.title")}
            description={t("officialRules.notPublished.body")}
          />
        ) : (
          <ApiErrorState failure={result.error} headingLevel="h2" />
        )}
      </div>
    </div>
  );
}
