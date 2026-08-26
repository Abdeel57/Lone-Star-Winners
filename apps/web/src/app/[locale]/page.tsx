import { buttonVariants, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AmoeCallout } from "@/components/amoe-callout";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryOfferPanel } from "@/components/entry-offer-panel";
import { PromotionHero } from "@/components/promotion-hero";
import { SectionHeading } from "@/components/section-heading";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ProductCard } from "@/components/product-card";
import {
  fetchActivePromotion,
  fetchProducts,
  fetchPromotion,
  type ProductSummary,
  type PromotionDetail,
} from "@/lib/api";
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
 * Hoy las llamadas usan `cache: "no-store"`, lo que ya saca a la ruta del
 * prerender. Se declara ademas de forma EXPLICITA porque esa propiedad es
 * emergente: bastaria con que alguien anadiera un `revalidate` a una de las
 * llamadas para que la pagina volviera a ser estatica sin que nada fallara.
 */
export const dynamic = "force-dynamic";

/**
 * Cuantos articulos se destacan en la portada.
 *
 * Tres: es lo que ocupa una fila completa de la rejilla en escritorio. Con
 * cuatro quedaria una segunda fila con un solo articulo y un hueco al lado.
 */
const FEATURED_COUNT = 3;

/** Los tres pasos de "como funciona", en orden. */
const STEPS = ["step1", "step2", "step3"] as const;

/**
 * Portada.
 *
 * Es un Server Component a proposito: los feature flags se leen EN SERVIDOR, en
 * la misma peticion que el render, que es lo que exige DEC-013. No existe una
 * version cliente de esta lectura y no debe existir.
 *
 * `nowIso` se genera aqui, una sola vez, y baja hasta la cuenta atras. Si cada
 * componente mirase el reloj por su cuenta, el HTML del servidor y el del
 * cliente diferirian y React lanzaria un error de hidratacion.
 *
 * POR QUE HAY DOS PETICIONES DE PROMOCION
 * ---------------------------------------
 * `GET /promotions/active` devuelve un `PromotionSummary`, y la forma que
 * publica `docs/API_CONTRACT.md` para ese objeto NO incluye la oferta de
 * participaciones. La oferta -ratio vigente y periodo de multiplicador- solo
 * esta en el detalle.
 *
 * Asi que la portada pide el resumen y, si hay promocion, su detalle. Es un
 * viaje de mas y esta pedido a `backend`: o la oferta entra en el resumen, o
 * existe una ruta que la publique. Lo que NO se hace es anadir el campo por
 * nuestra cuenta a un objeto cuya forma el contrato define de forma cerrada.
 *
 * ---------------------------------------------------------------------------
 * COMPOSICION (DEC-038)
 * ---------------------------------------------------------------------------
 * Bloques de gran contraste que se suceden, cada uno con su propio fondo:
 *
 *   hero a pantalla completa -> avisos -> oferta y via gratuita -> como
 *   funciona -> mercancia destacada -> cierre de confianza
 *
 * El orden no cambia respecto de la version anterior, y no es casual: lo
 * primero que se afirma despues del premio es que aqui se adquiere MERCANCIA, y
 * lo ultimo que se lee antes de salir son las Reglas Oficiales. Lo que cambia
 * es que ahora cada bloque se distingue del anterior, en vez de ser seis
 * secciones seguidas sobre el mismo fondo.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const nowIso = new Date().toISOString();

  // Las dos lecturas van en paralelo: la configuracion no depende de la
  // promocion ni al reves, y encadenarlas sumaria dos viajes al render.
  const [promotionResult, uiConfig, productsResult] = await Promise.all([
    fetchActivePromotion(locale),
    loadServerUiConfig(locale),
    fetchProducts(locale, { limit: FEATURED_COUNT }),
  ]);

  /*
   * La mercancia destacada es informacion ADICIONAL.
   *
   * Un fallo del catalogo no puede tumbar la portada ni dejar un estado de
   * error en mitad de ella: la promocion vigente y las Reglas Oficiales siguen
   * siendo lo que esta pagina tiene que responder. Si el catalogo no contesta,
   * la seccion no se renderiza.
   */
  const featured: readonly ProductSummary[] = productsResult.ok
    ? productsResult.data.items.slice(0, FEATURED_COUNT)
    : [];

  const promotion = promotionResult.ok ? promotionResult.data : null;
  const presentation = promotion === null ? null : presentPromotion(promotion.status);

  // El detalle solo se pide si hay promocion. Un fallo aqui NO tumba la
  // portada: la oferta es informacion adicional, y quedarse sin ella es peor
  // que quedarse sin portada solo si se decide que lo es.
  let detail: PromotionDetail | null = null;
  if (promotion !== null) {
    const detailResult = await fetchPromotion(promotion.slug, locale);
    detail = detailResult.ok ? detailResult.data : null;
  }

  const amoeEnabled = isFeatureEnabled(uiConfig.flags, "amoe_enabled");

  /**
   * Copy de un paso, resuelto con `switch` exhaustivo.
   *
   * Una clave construida en tiempo de ejecucion (`home.howItWorks.${key}.title`)
   * no la comprueba el tipado de `src/global.d.ts`, y un paso sin traducir
   * apareceria como la clave en crudo. Asi, anadir un paso obliga a escribirlo
   * en los dos diccionarios.
   */
  const stepCopy = (key: (typeof STEPS)[number]): { title: string; body: string } => {
    switch (key) {
      case "step1":
        return {
          title: t("home.howItWorks.step1.title"),
          body: t("home.howItWorks.step1.body"),
        };
      case "step2":
        return {
          title: t("home.howItWorks.step2.title"),
          body: t("home.howItWorks.step2.body"),
        };
      case "step3":
        return {
          title: t("home.howItWorks.step3.title"),
          body: t("home.howItWorks.step3.body"),
        };
    }
  };

  return (
    <>
      {!promotionResult.ok ? (
        <div className="lsw-container py-s16">
          <ApiErrorState failure={promotionResult.error} headingLevel="h2" />
        </div>
      ) : promotion === null ? (
        <div className="lsw-atmosphere lsw-grain relative isolate">
          <div className="lsw-container flex min-h-[60svh] items-center py-s16">
            <EmptyState
              headingLevel="h2"
              className="w-full"
              title={t("states.noActivePromotion.title")}
              description={t("states.noActivePromotion.body")}
              action={
                <Link href="/shop" className={buttonVariants({ variant: "primary", size: "lg" })}>
                  {t("home.shopCta")}
                </Link>
              }
            />
          </div>
        </div>
      ) : (
        <PromotionHero promotion={promotion} locale={locale} nowIso={nowIso} />
      )}

      {/* Oferta vigente y via gratuita. Las dos son informacion de la promocion
          y por eso comparten banda; con `amoe_enabled` apagado, la de la derecha
          no se renderiza y la oferta ocupa el ancho. */}
      {promotion === null || presentation === null ? null : (
        <div className="lsw-container py-s16">
          {/* Sin encabezado de seccion propio: cada panel es ya una `<section>`
              con su titulo, y anadir un tercer titulo encima repetiria el mismo
              texto dos veces en la misma pantalla. */}
          {/* Sin la via gratuita, la oferta se queda sola: se estrecha al ancho
              de lectura en vez de estirarse a los 80rem del contenedor, que es
              como una tarjeta de cuatro lineas acaba pareciendo un error de
              maquetacion. */}
          <div className={`grid gap-s5 ${amoeEnabled ? "lg:grid-cols-2" : "max-w-narrow"}`}>
            <EntryOfferPanel
              offer={detail?.entry_offer ?? null}
              presentation={presentation}
              multipliersEnabled={isFeatureEnabled(uiConfig.flags, "entry_multipliers_enabled")}
              locale={locale}
              timeZone={promotion.legal_timezone}
            />

            {/* Con `amoe_enabled` apagado no se renderiza nada: ocultar es aqui
                el estado deliberado. Anunciar una via gratuita que no esta
                configurada seria afirmar algo sobre las condiciones de
                participacion (CLAUDE.md #1). */}
            <AmoeCallout enabled={amoeEnabled} mode={uiConfig.amoeMode} />
          </div>
        </div>
      )}

      {/* Como funciona. Fondo hundido y numeracion dorada: son tres afirmaciones
          y la primera es la que importa -lo que se adquiere es mercancia-, asi
          que se leen como pasos numerados y no como tres tarjetas iguales. */}
      <section aria-labelledby="how-it-works" className="lsw-band-sunken py-s16 lg:py-s20">
        <div className="lsw-container">
          <SectionHeading id="how-it-works" title={t("home.howItWorks.title")} size="lg" />

          <ol className="mt-s10 grid list-none gap-s8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-s10">
            {STEPS.map((key, index) => {
              const copy = stepCopy(key);

              return (
                <li key={key} className="border-t border-border pt-s5">
                  {/* La cifra es decorativa: la lista ya es un `<ol>`, asi que
                      el orden lo anuncia el propio elemento. Repetirlo como
                      texto haria que un lector de pantalla dijera "uno, uno". */}
                  <p
                    aria-hidden="true"
                    className="lsw-display text-display-md leading-none text-brand/45"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </p>

                  <h3 className="lsw-display mt-s4 text-heading-md text-text">{copy.title}</h3>

                  <p className="mt-s3 text-body-md text-text-muted">{copy.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {featured.length === 0 ? null : (
        <section aria-labelledby="featured" className="lsw-container py-s16 lg:py-s20">
          <div className="flex flex-col gap-s6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              id="featured"
              eyebrow={t("nav.shop")}
              title={t("home.featured.title")}
              lead={t("home.featured.body")}
              size="lg"
            />

            <Link
              href="/shop"
              className={`shrink-0 ${buttonVariants({ variant: "secondary", size: "lg" })}`}
            >
              {t("home.featured.viewAll")}
            </Link>
          </div>

          <ul className="mt-s10 grid list-none gap-s5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} locale={locale} />
            ))}
          </ul>
        </section>
      )}

      {/* Cierre de confianza: lo ultimo que se lee antes del pie son las Reglas
          Oficiales. Sobre atmosfera, para que el bloque cierre la pagina con el
          mismo material con el que la abrio. */}
      <section
        aria-labelledby="trust"
        className="lsw-atmosphere lsw-grain relative isolate py-s16 lg:py-s20"
      >
        <div className="lsw-container max-w-narrow text-center">
          <SectionHeading
            id="trust"
            title={t("home.trust.title")}
            size="lg"
            className="items-center [&>div]:mx-auto"
          />

          <p className="mt-s6 text-body-lg text-text-muted">{t("home.trust.body")}</p>

          <div className="mt-s8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/official-rules"
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              {t("nav.officialRules")}
            </Link>

            <Link href="/faq" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              {t("home.trust.faqLink")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
