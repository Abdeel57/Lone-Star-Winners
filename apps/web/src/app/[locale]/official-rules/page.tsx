import { EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { OfficialRulesDocumentView } from "@/components/official-rules-document";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchOfficialRules, fetchPromotion } from "@/lib/api";

/**
 * Render por peticion, siempre (DEC-013).
 *
 * Esta pagina sirve contenido gobernado por las Official Rules. Si se
 * prerenderizara en el build, una version nueva del documento no tendria efecto
 * hasta el siguiente despliegue, y servir una version caducada de las Official
 * Rules no es un problema de frescura de contenido.
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
 * POR QUE TAMBIEN SE PIDE LA PROMOCION
 * ------------------------------------
 * La respuesta de `GET /promotions/{slug}/official-rules` no trae
 * `legal_timezone`, y la fecha de entrada en vigor de un documento legal no
 * puede formatearse contra el reloj del navegador (DEC-011). La zona sale de la
 * promocion a la que pertenece el documento.
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
  let timeZone: string | null = null;

  if (slug === null) {
    const active = await fetchActivePromotion(locale);

    if (!active.ok) {
      return (
        <Shell title={t("officialRules.title")}>
          <ApiErrorState failure={active.error} headingLevel="h2" />
        </Shell>
      );
    }

    if (active.data === null) {
      return (
        <Shell title={t("officialRules.title")}>
          <EmptyState
            headingLevel="h2"
            title={t("officialRules.noPromotion.title")}
            description={t("officialRules.noPromotion.body")}
          />
        </Shell>
      );
    }

    slug = active.data.slug;
    timeZone = active.data.legal_timezone;
  }

  const [rulesResult, promotionResult] = await Promise.all([
    fetchOfficialRules(slug, locale),
    // Ya se conoce la zona cuando la promocion vigente resolvio el slug; en ese
    // caso no se vuelve a pedir.
    timeZone === null ? fetchPromotion(slug, locale) : Promise.resolve(null),
  ]);

  const resolvedTimeZone =
    timeZone ?? (promotionResult?.ok === true ? promotionResult.data.legal_timezone : null);

  return (
    <Shell title={t("officialRules.title")}>
      {rulesResult.ok ? (
        // Sin zona legal declarada se formatea en UTC de forma explicita. Caer
        // en la del navegador convertiria una fecha legal en una suposicion.
        <OfficialRulesDocumentView
          document={rulesResult.data}
          locale={locale}
          timeZone={resolvedTimeZone ?? "UTC"}
        />
      ) : rulesResult.error.status === 404 ? (
        // Un 404 aqui NO es "pagina no encontrada": es "esta promocion aun no
        // tiene version de reglas publicada" (DEC-012), que es un estado
        // legitimo y hay que nombrarlo tal cual.
        <EmptyState
          headingLevel="h2"
          title={t("officialRules.notPublished.title")}
          description={t("officialRules.notPublished.body")}
        />
      ) : (
        <ApiErrorState failure={rulesResult.error} headingLevel="h2" />
      )}
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="lsw-container max-w-narrow py-s10">
      <h1 className="text-display-md font-bold text-text">{title}</h1>
      <div className="mt-s6">{children}</div>
    </div>
  );
}
