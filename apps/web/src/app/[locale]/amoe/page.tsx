import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AmoeModePanel } from "@/components/amoe-mode-panel";
import { ApiErrorState } from "@/components/api-error-state";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  fetchActivePromotion,
  fetchAmoeConfig,
  fetchPromotion,
  pickLocalized,
  type EntryOfferAmoeSummary,
} from "@/lib/api";
import { isFeatureEnabled } from "@/lib/flags";
import { loadFeatureFlags } from "@/lib/flags-server";
import { loadSession } from "@/lib/participant-server";

/**
 * Render por peticion, siempre (DEC-013).
 *
 * `amoe_enabled` es un flag legalmente material. Prerenderizar esta pagina
 * significaria que apagar la via gratuita en el panel no la apaga hasta el
 * siguiente despliegue -o al reves: que encenderla no la publica-. Ninguna de
 * las dos cosas es un problema de frescura de contenido.
 */
export const dynamic = "force-dynamic";

/**
 * Como participar sin comprar.
 *
 * ESTA PAGINA EXISTE O NO EXISTE, PERO NUNCA APARECE ROTA
 * -------------------------------------------------------
 * Con `amoe_enabled` apagado la ruta responde 200 con un estado DELIBERADO:
 * esta promocion no ofrece via gratuita en la plataforma, y se remite a las
 * Reglas Oficiales. No es un 404 -la URL es legitima y puede estar enlazada- y
 * no es un error -no hay nada roto-. Es la ausencia de una funcion, dicha.
 *
 * Y NO SE AFIRMA NADA MAS. No se dice que "proximamente habra" una via
 * gratuita, ni que "no se requiere compra": ambas cosas serian afirmaciones
 * sobre las condiciones de participacion, que son materia del abogado del
 * cliente (CLAUDE.md #1 y #2). La linea "no se requiere compra" sigue viviendo
 * detras del flag, donde ya estaba.
 *
 * QUE GOBIERNA QUE, otra vez porque es lo que mas se confunde:
 *   - `amoe_enabled` gobierna si la via EXISTE.
 *   - `amoe_mode` gobierna QUE interfaz se renderiza (DEC-032).
 *   - Las instrucciones concretas las escribe el backend, no esta pagina.
 */
export default async function AmoePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "amoe.page" });

  const flags = await loadFeatureFlags(locale);
  const enabled = isFeatureEnabled(flags, "amoe_enabled");

  if (!enabled) {
    return (
      <div className="lsw-container py-s10 pb-s16">
        <h1 className="lsw-display text-display-sm text-text">{t("title")}</h1>
        <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

        <div className="mt-s8 max-w-2xl">
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
        </div>
      </div>
    );
  }

  const [promotionResult, sessionContext] = await Promise.all([
    fetchActivePromotion(locale),
    loadSession(locale),
  ]);

  return (
    <div className="lsw-container py-s10 pb-s16">
      <h1 className="lsw-display text-display-sm text-text">{t("title")}</h1>
      <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

      <div className="mt-s8 max-w-3xl">
        {!promotionResult.ok ? (
          <ApiErrorState failure={promotionResult.error} headingLevel="h2" />
        ) : promotionResult.data === null ? (
          /*
           * Sin promocion abierta no hay via gratuita a la que apuntar: AMOE
           * pertenece a una promocion concreta, con su ventana y su version de
           * reglas. Es un estado vacio normal -el periodo entre promociones-, no
           * un error.
           */
          <EmptyState
            headingLevel="h2"
            title={t("noPromotionTitle")}
            description={t("noPromotionBody")}
          />
        ) : (
          <AmoeConfigSection
            slug={promotionResult.data.slug}
            title={pickLocalized(promotionResult.data.title, locale)}
            locale={locale}
            timeZone={promotionResult.data.legal_timezone}
            authenticated={sessionContext.state.kind === "active"}
          />
        )}
      </div>
    </div>
  );
}

/** Lee la configuracion AMOE de la promocion y decide que interfaz pintar. */
async function AmoeConfigSection({
  slug,
  title,
  locale,
  timeZone,
  authenticated,
}: {
  readonly slug: string;
  readonly title: string;
  readonly locale: "en" | "es";
  /** Zona legal de la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
  readonly authenticated: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "amoe.page" });
  const result = await fetchAmoeConfig(slug, locale);

  /*
   * UN 404 AQUI NO ES UN ERROR. El contrato dice que con `amoe_enabled` apagado
   * estos endpoints responden 404, asi que un 404 significa "la via no esta
   * disponible para esta promocion" -por ejemplo, si el flag global esta
   * encendido y esta promocion concreta no la ofrece-. Se pinta como ausencia,
   * no como fallo.
   */
  if (!result.ok) {
    if (result.error.status === 404) {
      return (
        <EmptyState
          headingLevel="h2"
          title={t("disabledTitle")}
          description={t("disabledBody")}
          action={
            <Link
              href={`/official-rules?promotion=${encodeURIComponent(slug)}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("officialRulesCta")}
            </Link>
          }
        />
      );
    }

    return <ApiErrorState failure={result.error} headingLevel="h2" />;
  }

  // El backend tambien puede decir que no, con 200 y `enabled: false`. La
  // interfaz trata las dos formas igual: la via no existe.
  if (!result.data.enabled) {
    return (
      <EmptyState
        headingLevel="h2"
        title={t("disabledTitle")}
        description={t("disabledBody")}
        action={
          <Link
            href={`/official-rules?promotion=${encodeURIComponent(slug)}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            {t("officialRulesCta")}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-s6">
      <Card elevation="flat" padding="md">
        <CardTitle as="h2" size="sm">
          {title}
        </CardTitle>
        <p className="mt-s2 text-body-sm text-text-muted">{t("promotionScope")}</p>
      </Card>

      <AmoeModePanel
        config={result.data}
        locale={locale}
        promotionSlug={slug}
        authenticated={authenticated}
        summary={await amoeSummary(slug, locale)}
        timeZone={timeZone}
      />
    </div>
  );
}

/**
 * Resumen AMOE de la promocion (§13.5), como SEGUNDA fuente de las cifras.
 *
 * POR QUE HACE FALTA UN VIAJE MAS. `GET /promotions/{slug}/amoe-config` todavia
 * no publica el valor por ficha ni el limite por participante -es una peticion
 * abierta a `backend`, anotada en `AmoeConfig`- y §13.5 si los publica dentro de
 * `entry_offer.amoe`. Mientras las dos formas convivan, la pagina lee la
 * configuracion como fuente principal y este resumen como respaldo.
 *
 * ES DE MEJOR ESFUERZO: un fallo aqui deja la pagina exactamente como estaba
 * -instrucciones y ventana- y no la tumba. Ninguna cifra se inventa: sin dato,
 * la fila no se pinta.
 */
async function amoeSummary(
  slug: string,
  locale: "en" | "es",
): Promise<EntryOfferAmoeSummary | null> {
  const detail = await fetchPromotion(slug, locale);
  if (!detail.ok) return null;

  return detail.data.entry_offer?.amoe ?? null;
}
