import { Alert, buttonVariants } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type PromotionSummary } from "@/lib/api";
import { presentPromotion } from "@/lib/promotion-state";

import { PromotionCountdown } from "./promotion-countdown";
import { PromotionStateNotice } from "./promotion-state-notice";
import { PromotionStatusBadge } from "./promotion-status-badge";

/**
 * Presentacion de la promocion vigente.
 *
 * Es la pantalla que tiene que responder en cinco segundos: que se sortea,
 * hasta cuando, y donde estan las reglas.
 *
 * Que hace y que NO hace:
 *
 * - No calcula nada. Ni participaciones, ni multiplicadores. La cuenta atras
 *   cuenta, pero NO decide: el estado de la promocion lo manda el backend y
 *   este componente lo lee de la maquina de estados (CLAUDE.md #15).
 * - No afirma nada legal. No dice quien puede participar, ni desde donde, ni
 *   con que edad, ni si hace falta comprar. Todo eso son Official Rules y las
 *   escribe el abogado del cliente (CLAUDE.md #1 y #2).
 * - Las fechas se formatean contra `promotion.legal_timezone`, nunca contra la
 *   zona del navegador (DEC-011), y se dice explicitamente que es asi.
 * - El importe llega como entero en unidad menor y solo se divide para
 *   pintarlo (DEC-010).
 * - El titulo y el resumen son contenido dinamico localizado (DEC-030): llegan
 *   del backend en los dos idiomas y se pintan con `pickLocalized`, SIN
 *   traducirlos. `t()` solo toca copy de producto (DEC-022).
 * - Todo formateo usa la etiqueta (`en-US` / `es-US`), no el segmento de ruta
 *   (DEC-029). La conversion la hacen `formatters` y `pickLocalized`.
 *
 * EL ENLACE A LAS REGLAS SIEMPRE ESTA
 * -----------------------------------
 * Salvo que la promocion declare que no tiene version de reglas publicada
 * (DEC-012), en cuyo caso se dice eso mismo en vez de enlazar a un documento
 * que no existe. Un enlace roto a las Reglas Oficiales es peor que no tenerlo.
 *
 * ---------------------------------------------------------------------------
 * COMPOSICION (DEC-038)
 * ---------------------------------------------------------------------------
 * Hero a pantalla completa sobre negro con atmosfera: el premio es el titular,
 * en caja alta y al mayor tamano del sistema, y la cuenta atras es un marcador
 * de cuatro casillas. Nada de eso es decorativo por si mismo: la jerarquia
 * -titulo, plazo, valor declarado, llamada a la tienda- es exactamente la que
 * responde a las cinco preguntas de arriba, solo que ahora se lee de un vistazo.
 *
 * DOS BLOQUES, NO UNO
 * -------------------
 * El hero termina donde empiezan los AVISOS. El estado de la promocion, el
 * descargo de participaciones y la ausencia de reglas publicadas viven en una
 * banda propia justo debajo, con fondo distinto: son texto que hay que leer, y
 * dentro de un hero de titulares gigantes nadie los lee. Siguen formando parte
 * de este componente -no de la pagina- porque acompanan a la promocion alla
 * donde se muestre.
 */
export function PromotionHero({
  promotion,
  locale,
  nowIso,
}: {
  readonly promotion: PromotionSummary;
  readonly locale: Locale;
  /**
   * Instante de referencia del render, generado en el servidor. Ver
   * `PromotionCountdown`: es lo que hace coincidir el primer render de servidor
   * y de cliente.
   */
  readonly nowIso: string;
}) {
  const t = useTranslations("home");
  const presentation = presentPromotion(promotion.status);

  const opensAt = formatZonedDateTime(promotion.starts_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });
  const closesAt = formatZonedDateTime(promotion.ends_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });

  const hasRules = promotion.rules_version_id !== null;

  return (
    <>
      <section
        aria-labelledby="promotion-title"
        className="lsw-atmosphere lsw-grain relative isolate overflow-hidden"
      >
        {/*
         * Marca de agua: la estrella coronada del logotipo, enorme y casi
         * apagada, detras del contenido.
         *
         * Va como imagen de FONDO de un `div` decorativo y no como `<img>`:
         * asi no entra en el arbol de accesibilidad, no compite por el orden de
         * carga con el contenido, y desaparece por completo en pantallas
         * pequenas, donde solo restaria contraste al titular.
         */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-1/2 hidden h-[46rem] w-[46rem] -translate-y-1/2 bg-contain bg-center bg-no-repeat opacity-[0.07] lg:block"
          style={{ backgroundImage: "url('/brand/lsw-mark.png')" }}
        />

        <div className="lsw-container relative flex min-h-[86svh] flex-col justify-center py-s16 lg:min-h-[calc(100svh-5rem)] lg:py-s24">
          <div className="grid gap-s10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-s12">
            <div>
              {/*
               * CHIP DE ESTADO SOBRE EL TITULAR.
               *
               * Es la pieza que la referencia visual pone encima de su titular
               * -un chip de color pleno, en caja alta, con texto oscuro- y aqui
               * lo que lleva escrito es DATO: el estado que reporta el backend,
               * traducido por la misma funcion que lo traduce en el resto del
               * sitio. Su color sale del estado, no de una decision de esta
               * pantalla; para una promocion abierta es oro, y para las fases
               * posteriores, el tono que le corresponde.
               */}
              <div className="flex flex-wrap items-center gap-3">
                <PromotionStatusBadge
                  status={promotion.status}
                  size="md"
                  emphasis="solid"
                  shape="square"
                />
                <p className="lsw-eyebrow text-text-subtle">{t("eyebrow")}</p>
              </div>

              <h1
                id="promotion-title"
                className="lsw-display mt-s4 text-display-lg text-text sm:text-display-xl"
              >
                {pickLocalized(promotion.title, locale)}
              </h1>

              <p className="mt-s5 max-w-narrow text-body-lg text-text-muted">
                {pickLocalized(promotion.summary, locale)}
              </p>

              {/*
               * LA ACCION PRINCIPAL DEPENDE DEL ESTADO.
               *
               * Mientras la promocion admite participaciones, lo primero que
               * hay que poder hacer es ver la MERCANCIA: es lo que se adquiere,
               * y la promocion es el marco. En cuanto deja de admitirlas, esa
               * misma llamada seria una afirmacion falsa -invitar a pedir
               * mercancia "para esta promocion" sobre una promocion cerrada-, y
               * la accion principal pasa a ser el detalle, que es donde se
               * explica en que fase esta el proceso.
               *
               * La decision NO se toma aqui: sale de la misma maquina de
               * estados que gobierna el resto del sitio.
               */}
              <div className="mt-s8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Link
                  href={presentation.showsShopCta ? "/shop" : `/promotions/${promotion.slug}`}
                  className={buttonVariants({ variant: "primary", size: "xl" })}
                >
                  {presentation.showsShopCta ? t("shopCta") : t("viewPromotion")}
                </Link>

                {hasRules ? (
                  <Link
                    href={`/official-rules?promotion=${promotion.slug}`}
                    className={buttonVariants({ variant: "secondary", size: "xl" })}
                  >
                    {t("viewOfficialRules")}
                  </Link>
                ) : null}

                {presentation.showsShopCta ? (
                  <Link
                    href={`/promotions/${promotion.slug}`}
                    className={buttonVariants({ variant: "ghost", size: "lg" })}
                  >
                    {t("viewPromotion")}
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-s6">
              {/*
               * EL VALOR DECLARADO YA NO ESTA AQUI.
               *
               * Vive en la banda dorada del premio (`PrizeBand`), que es la
               * unica superficie clara de la portada y donde una cifra grande
               * golpea de verdad. Tenerlo en los dos sitios repetia el mismo
               * numero a dos pantallas de distancia y le quitaba peso a los
               * dos.
               *
               * Sigue sin pintarse ninguna etiqueta de valor cuando la
               * promocion no declara premio: aqui porque no hay etiqueta, y en
               * la banda porque la banda entera no se renderiza.
               */}
              {presentation.countdownTarget === null ? null : (
                <PromotionCountdown
                  targetIso={
                    presentation.countdownTarget === "starts_at"
                      ? promotion.starts_at
                      : promotion.ends_at
                  }
                  nowIso={nowIso}
                  locale={locale}
                  timeZone={promotion.legal_timezone}
                  variant={presentation.countdownTarget === "starts_at" ? "opens" : "closes"}
                  size="scoreboard"
                  // El periodo completo, para la barra de progreso bajo el
                  // marcador. `PromotionCountdown` solo la dibuja cuando la
                  // cuenta atras apunta al cierre.
                  period={{ startIso: promotion.starts_at, endIso: promotion.ends_at }}
                />
              )}

              <dl className="flex flex-col gap-s3 border-t border-border pt-s5">
                {opensAt === null ? null : (
                  <div className={META_ROW}>
                    <dt className={META_LABEL}>{t("opensLabel")}</dt>
                    <dd className={META_VALUE}>
                      <time dateTime={promotion.starts_at}>{opensAt}</time>
                    </dd>
                  </div>
                )}

                {closesAt === null ? null : (
                  <div className={META_ROW}>
                    <dt className={META_LABEL}>{t("closesLabel")}</dt>
                    <dd className={META_VALUE}>
                      <time dateTime={promotion.ends_at}>{closesAt}</time>
                    </dd>
                  </div>
                )}
              </dl>

              <p className="text-caption text-text-subtle">{t("timeZoneNote")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Banda de avisos. Fondo distinto y ancho de lectura: es el texto que hay
          que leer de verdad, y necesita el tratamiento contrario al del hero. */}
      <div className="lsw-band">
        <div className="lsw-container flex max-w-narrow flex-col gap-3 py-s8">
          <PromotionStateNotice presentation={presentation} />

          <Alert tone="info">{t("entriesDisclaimer")}</Alert>

          {hasRules ? null : (
            // DEC-012: una promocion no llega a ACTIVE con claves legales en TBD.
            // Aun asi la interfaz tiene que saber decirlo sin rellenar el hueco.
            <Alert tone="warning">{t("rulesNotPublished")}</Alert>
          )}
        </div>
      </div>
    </>
  );
}

const META_ROW = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";

const META_LABEL = "font-display text-overline uppercase tracking-wide text-text-subtle";

const META_VALUE = "text-body-sm font-medium text-text";
