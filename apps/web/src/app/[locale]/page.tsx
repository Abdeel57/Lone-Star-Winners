import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AmoeCallout } from "@/components/amoe-callout";
import { ApiErrorState } from "@/components/api-error-state";
import { EntryOfferPanel } from "@/components/entry-offer-panel";
import { PromotionHero } from "@/components/promotion-hero";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchPromotion, type PromotionDetail } from "@/lib/api";
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
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const nowIso = new Date().toISOString();

  // Las dos lecturas van en paralelo: la configuracion no depende de la
  // promocion ni al reves, y encadenarlas sumaria dos viajes al render.
  const [promotionResult, uiConfig] = await Promise.all([
    fetchActivePromotion(locale),
    loadServerUiConfig(locale),
  ]);

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

  return (
    <>
      {!promotionResult.ok ? (
        <div className="lsw-container py-s10">
          <ApiErrorState failure={promotionResult.error} headingLevel="h2" />
        </div>
      ) : promotion === null ? (
        <div className="lsw-container py-s10">
          <EmptyState
            headingLevel="h2"
            title={t("states.noActivePromotion.title")}
            description={t("states.noActivePromotion.body")}
            action={
              <Link href="/shop" className={buttonVariants({ variant: "primary" })}>
                {t("home.shopCta")}
              </Link>
            }
          />
        </div>
      ) : (
        <PromotionHero promotion={promotion} locale={locale} nowIso={nowIso} />
      )}

      {promotion === null || presentation === null ? null : (
        <div className="lsw-container flex flex-col gap-4 pb-s10">
          {/* La llamada a la tienda va antes que la oferta: lo primero que
              tiene que quedar claro es que aqui se adquiere MERCANCIA. */}
          {presentation.showsShopCta ? (
            <div>
              <Link href="/shop" className={buttonVariants({ variant: "primary", size: "lg" })}>
                {t("home.shopCta")}
              </Link>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
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
            <AmoeCallout
              enabled={isFeatureEnabled(uiConfig.flags, "amoe_enabled")}
              mode={uiConfig.amoeMode}
            />
          </div>
        </div>
      )}

      <section aria-labelledby="how-it-works" className="lsw-container pb-s12">
        <h2 id="how-it-works" className="text-heading-lg font-semibold text-text">
          {t("home.howItWorks.title")}
        </h2>

        <ol className="mt-s6 grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card as="li" elevation="flat">
            <CardTitle as="h3" size="sm">
              {t("home.howItWorks.step1.title")}
            </CardTitle>
            <p className="mt-2 text-body-sm text-text-muted">{t("home.howItWorks.step1.body")}</p>
          </Card>

          <Card as="li" elevation="flat">
            <CardTitle as="h3" size="sm">
              {t("home.howItWorks.step2.title")}
            </CardTitle>
            <p className="mt-2 text-body-sm text-text-muted">{t("home.howItWorks.step2.body")}</p>
          </Card>

          <Card as="li" elevation="flat">
            <CardTitle as="h3" size="sm">
              {t("home.howItWorks.step3.title")}
            </CardTitle>
            <p className="mt-2 text-body-sm text-text-muted">{t("home.howItWorks.step3.body")}</p>
          </Card>
        </ol>
      </section>

      <section aria-labelledby="trust" className="lsw-container pb-s16">
        <Card elevation="flat" padding="lg">
          <CardTitle as="h2" size="md" id="trust">
            {t("home.trust.title")}
          </CardTitle>

          <p className="mt-s3 max-w-narrow text-body-md text-text-muted">{t("home.trust.body")}</p>

          <div className="mt-s5 flex flex-col gap-3 sm:flex-row">
            <Link href="/official-rules" className={buttonVariants({ variant: "secondary" })}>
              {t("nav.officialRules")}
            </Link>

            <Link href="/faq" className={buttonVariants({ variant: "ghost" })}>
              {t("home.trust.faqLink")}
            </Link>
          </div>
        </Card>
      </section>
    </>
  );
}
