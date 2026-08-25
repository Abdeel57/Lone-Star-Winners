import { Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { PromotionHero } from "@/components/promotion-hero";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion } from "@/lib/api";

/**
 * Portada.
 *
 * Hito FE-M0: existe para demostrar que las fundaciones funcionan juntas
 * (enrutado con prefijo de idioma, diccionarios, design system, capa de API
 * tipada contra MSW, estados de carga y error). NO es la portada del producto:
 * la navegacion de tienda, el carrito, la cuenta y las Official Rules llegan en
 * hitos posteriores.
 *
 * Es un Server Component a proposito: los datos se piden en la misma peticion
 * que el render, que es lo que despues permitira cumplir DEC-013 con los
 * feature flags (ver `src/lib/flags-server.ts`). Ninguna seccion de este hito
 * depende todavia de un flag, asi que no se lee ninguno: pedirlos "por si
 * acaso" seria una llamada muerta.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();

  const promotionResult = await fetchActivePromotion(locale);

  return (
    <>
      {!promotionResult.ok ? (
        <div className="lsw-container py-s10">
          <ApiErrorState failure={promotionResult.error} headingLevel="h2" />
        </div>
      ) : promotionResult.data === null ? (
        <div className="lsw-container py-s10">
          <EmptyState
            headingLevel="h2"
            title={t("states.noActivePromotion.title")}
            description={t("states.noActivePromotion.body")}
          />
        </div>
      ) : (
        <PromotionHero promotion={promotionResult.data} locale={locale} />
      )}

      <section aria-labelledby="how-it-works" className="lsw-container pb-s16">
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
    </>
  );
}
