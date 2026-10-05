import { buttonVariants, cn, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AmoeCallout } from "@/components/amoe-callout";
import { ApiErrorState } from "@/components/api-error-state";
import { ComingSoonBand } from "@/components/coming-soon-band";
import { EntryOfferPanel } from "@/components/entry-offer-panel";
import { EntryPackageBand } from "@/components/entry-package-band";
import { MarqueeBand } from "@/components/marquee-band";
import { MerchandiseBand } from "@/components/merchandise-band";
import { PrizeBand } from "@/components/prize-band";
import type { CardBonus } from "@/components/product-card";
import { PromotionHero } from "@/components/promotion-hero";
import { SectionHeading } from "@/components/section-heading";
import { WinnersShowcase, type PublishedWinner } from "@/components/winners-showcase";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  fetchActivePromotion,
  fetchProducts,
  fetchPromotion,
  fetchPromotions,
  type ProductSummary,
  type PromotionDetail,
  type PromotionSummary,
} from "@/lib/api";
import { normalizeEntryOffer } from "@/lib/entry-offer";
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
 * CUATRO, y la cifra la decide la rejilla, no el gusto. DEC-039 fija dos
 * columnas desde 360px, asi que en telefono -que es donde se mira esta
 * seccion- cualquier numero impar deja una tarjeta sola en la ultima fila con
 * un hueco al lado. Cuatro llena 2x2 en telefono y una fila completa en
 * escritorio, que es exactamente el mismo criterio por el que antes eran tres:
 * lo que cambio es la rejilla debajo.
 */
const FEATURED_COUNT = 4;

/**
 * Tope de paquetes en la banda de niveles. Hoy son cuatro; el tope solo evita
 * que un catalogo con decenas de paquetes convierta la portada en una tienda.
 */
const PACKAGES_LIMIT = 8;

/**
 * La promocion SCHEDULED que abre antes, o `null`.
 *
 * Es de mejor esfuerzo: un fallo del listado deja la portada en su estado
 * vacio, que es exactamente lo que habia antes de buscarla. Solo mira la
 * primera pagina; mas de un punado de promociones programadas a la vez no es un
 * caso de este negocio.
 */
async function findUpcomingPromotion(
  locale: Locale,
  nowIso: string,
): Promise<PromotionSummary | null> {
  const result = await fetchPromotions(locale, { limit: 50 });
  if (!result.ok) return null;

  // `Date.parse` y no comparacion de cadenas: dos ISO validos pueden diferir
  // en los milisegundos y entonces el orden lexicografico miente.
  const now = Date.parse(nowIso);
  const upcoming = result.data.items
    .filter((item) => item.status === "SCHEDULED" && Date.parse(item.ends_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  return upcoming[0] ?? null;
}

/**
 * Ancla de la banda de paquetes. El boton rojo del hero baja hasta ella
 * (DEC-069): ahi ya se anade al carrito, y pasar por la tienda era una pagina
 * de mas.
 */
const PACKAGES_ANCHOR = "packages";

/**
 * Ganadores publicados.
 *
 * VACIA, Y NO POR ACCIDENTE. Ver la nota de la seccion de ganadores mas abajo:
 * no existe ruta de ganadores en el contrato, y el frontend no llama a una que
 * no esta publicada ni fabrica el dato. La constante existe para que el dia que
 * `backend` publique la ruta el cambio sea una lectura y no una reforma de la
 * portada.
 */
const PUBLISHED_WINNERS: readonly PublishedWinner[] = [];

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
 *   hero a pantalla completa -> paquetes por niveles (DEC-065) -> avisos ->
 *   oferta y via gratuita -> como funciona -> mercancia destacada -> cierre
 *   de confianza
 *
 * DEC-069 la recorta: el hero lleva dentro el marcador y los avisos, y salen
 * "como funciona" y el cierre de confianza. Queda
 *
 *   hero (con marcador) -> paquetes -> oferta y via gratuita (si hay) ->
 *   cinta -> premio (si hay) -> mercancia destacada -> pie
 *
 * El orden no cambia respecto de la version anterior, y no es casual: lo
 * primero que se afirma despues del premio es que aqui se adquiere MERCANCIA, y
 * lo ultimo que se lee antes de salir son las Reglas Oficiales. Lo que cambia
 * es que ahora cada bloque se distingue del anterior, en vez de ser seis
 * secciones seguidas sobre el mismo fondo.
 *
 * DEC-039 anade el contraste que faltaba: la franja de MERCANCIA DESTACADA
 * pasa a banda clara. La pagina queda negro -> oro (premio) -> negro hundido
 * (como funciona) -> BLANCO (mercancia) -> negro (cierre). Esa alternancia es
 * la estructura real de la referencia, y es lo que hace que la seccion de
 * producto se lea como catalogo y no como una seccion mas de la promocion.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const nowIso = new Date().toISOString();

  // Las lecturas van en paralelo: ninguna depende de otra, y encadenarlas
  // sumaria viajes al render.
  const [promotionResult, uiConfig, productsResult, packagesResult] = await Promise.all([
    fetchActivePromotion(locale),
    loadServerUiConfig(locale),
    // DEC-065: la franja destacada es SOLO mercancia. Los paquetes tienen su
    // propia banda, por niveles, y no se mezclan con la rejilla de producto.
    fetchProducts(locale, { kind: "MERCHANDISE", limit: FEATURED_COUNT }),
    fetchProducts(locale, { kind: "ENTRY_PACKAGE", limit: PACKAGES_LIMIT }),
  ]);

  /*
   * La mercancia destacada y los paquetes son informacion ADICIONAL.
   *
   * Un fallo del catalogo no puede tumbar la portada ni dejar un estado de
   * error en mitad de ella: la promocion vigente y las Reglas Oficiales siguen
   * siendo lo que esta pagina tiene que responder. Si el catalogo no contesta,
   * la seccion no se renderiza.
   */
  const featured: readonly ProductSummary[] = productsResult.ok
    ? productsResult.data.items.slice(0, FEATURED_COUNT)
    : [];
  const packages: readonly ProductSummary[] = packagesResult.ok ? packagesResult.data.items : [];

  /*
   * SIN PROMOCION ACTIVA, LA PROXIMA (DEC-065).
   *
   * Entre que una edicion se programa y se activa, `/promotions/active` da 404
   * y la portada se quedaba en el estado vacio aunque el premio ya estuviera
   * anunciado. Ahora busca en el listado publico la promocion SCHEDULED que
   * abre antes y la presenta: el hero ya sabe pintar ese estado -cuenta atras
   * hacia la APERTURA, sin invitacion a comprar (`presentPromotion`)- y sin
   * Reglas activas pasa a su estado contenido (DEC-044).
   */
  const active = promotionResult.ok ? promotionResult.data : null;
  const promotion =
    active ?? (promotionResult.ok ? await findUpcomingPromotion(locale, nowIso) : null);
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

  /*
   * Los multiplicadores se leen UNA vez y bajan como prop a los dos sitios que
   * los necesitan -el hero y el panel de oferta-. Consultarlos dos veces daria
   * el mismo resultado, pero dejaria dos sitios donde olvidarse de comprobarlos.
   */
  const multipliersEnabled = isFeatureEnabled(uiConfig.flags, "entry_multipliers_enabled");

  /*
   * El bonus vigente, solo para NOMBRAR el multiplicador en la banda de
   * paquetes. Los mismos cerrojos que `/shop`: el flag del sitio y el de la
   * propia oferta. Las cifras de cada paquete llegan ya evaluadas del catalogo.
   */
  const offer = normalizeEntryOffer(detail?.entry_offer, nowIso);
  const packageBonus: CardBonus | null =
    promotion === null ||
    !multipliersEnabled ||
    offer === null ||
    !offer.multipliersEnabled ||
    offer.activeBonus === null
      ? null
      : { period: offer.activeBonus, timeZone: promotion.legal_timezone };

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
        /*
         * El DETALLE baja al hero (DEC-042).
         *
         * De ahi salen la fotografia del premio, su nombre y el universo de
         * participaciones. Va como prop y no lo pide el hero por su cuenta
         * porque esta pagina ya lo tiene pedido -y sabe si fallo-: dos
         * peticiones del mismo recurso en el mismo render serian dos viajes
         * para el mismo dato.
         *
         * `amoeEnabled` tambien: gobierna que linea legal se pinta debajo del
         * boton, y esa decision se toma con el flag leido en SERVIDOR en la
         * misma peticion que el render (DEC-013), no con un valor por defecto
         * dentro del componente.
         */
        <PromotionHero
          promotion={promotion}
          detail={detail}
          locale={locale}
          nowIso={nowIso}
          amoeEnabled={amoeEnabled}
          multipliersEnabled={multipliersEnabled}
          // Sin paquetes publicados no hay banda a la que bajar: a la tienda.
          buyHref={packages.length > 0 ? `#${PACKAGES_ANCHOR}` : "/shop"}
        />
      )}

      {/* PAQUETES DE PARTICIPACIONES POR NIVELES (DEC-065). Justo despues del
          premio, como en la referencia del cliente: lo primero que se ve es que
          se sortea y lo segundo, los niveles. Sin paquetes publicados no se
          renderiza. */}
      <EntryPackageBand
        packages={packages}
        locale={locale}
        bonus={packageBonus}
        anchorId={PACKAGES_ANCHOR}
      />

      {/* OFERTA VIGENTE: BANDA DORADA a todo el ancho (DEC-072). Antes era una
          tarjeta oscura de media pantalla de telefono; ahora es una franja con
          las dos cifras, y la pagina se acorta.

          La MISMA senal que contiene el hero y la banda de anuncio (DEC-044). Se
          lee del resumen -no del detalle- porque el hero ya la lee de ahi: si el
          detalle fallara, el hero seguiria contenido y este panel publicaria el
          ratio, que es exactamente la contradiccion que DEC-044 vino a cerrar.
          Sin oferta declarada, el panel no se pinta. */}
      {promotion === null || presentation === null ? null : (
        <EntryOfferPanel
          offer={detail?.entry_offer ?? null}
          presentation={presentation}
          multipliersEnabled={multipliersEnabled}
          rulesPublished={promotion.rules_version_id !== null}
          locale={locale}
          timeZone={promotion.legal_timezone}
          nowIso={nowIso}
          variant="band"
        />
      )}

      {/* VIA GRATUITA, en su propia banda bajo la oferta. Con `amoe_enabled`
          apagado no se renderiza nada: ocultar es aqui el estado deliberado.
          Anunciar una via gratuita que no esta configurada seria afirmar algo
          sobre las condiciones de participacion (CLAUDE.md #1). */}
      {promotion === null || presentation === null || !amoeEnabled ? null : (
        <div className="lsw-container py-s10 lg:py-s12">
          <div className="mx-auto max-w-narrow">
            <AmoeCallout enabled={amoeEnabled} mode={uiConfig.amoeMode} />
          </div>
        </div>
      )}

      {/* Cinta de marca. Tres afirmaciones permanentes, en movimiento continuo.
          Va justo antes de la banda del premio para que el ojo pase de una
          franja negra y fina a una superficie dorada a pantalla completa: es ese
          salto, y no el tamano de la banda, lo que la hace destacar. */}
      <MarqueeBand />

      {/* Banda del premio: el bloque DORADO. Solo aparece si la promocion
          declara premio; hoy el backend no tiene modelo de premio y el campo
          llega `null` en produccion, asi que la portada tiene que verse bien sin
          ella. */}
      {detail === null ? null : <PrizeBand promotion={detail} locale={locale} />}

      {/* Aqui iba "como funciona", tres pasos numerados. Se retira con
          DEC-069 a peticion del cliente: la portada se recorta para que el
          camino del premio a la compra sea corto. */}

      {/*
       * MERCANCIA DESTACADA, sobre BANDA CLARA (DEC-039).
       *
       * Es el unico bloque blanco de la portada -la banda del premio es dorada,
       * no clara- y el corte de oro de `.lsw-band-light` lo declara como tal.
       * Todo lo que cae dentro usa la paleta `light-*`: el encabezado por su
       * prop `tone`, las tarjetas por construccion, y el enlace de seccion por
       * la variante `inkGhost`. Un `secondary` aqui seria oro sobre blanco:
       * 2,3:1, ilegible.
       */}
      {featured.length === 0 ? null : (
        <MerchandiseBand
          labelledBy="featured"
          products={featured}
          locale={locale}
          // `h3` y no `h2`: el titular de esta franja YA es un `h2`, asi que
          // unas tarjetas en `h2` serian sus hermanas en el esquema del
          // documento en vez de colgar de el (hallazgo A5). En `/shop` no pasa:
          // alli la seccion cuelga de un `h1`.
          headingLevel="h3"
          // La franja de la portada respira mas que la rejilla del catalogo:
          // aqui la banda lleva encabezado dentro y es un descanso entre dos
          // bloques oscuros, no el contenido principal de la pagina.
          className="py-s12 lg:py-s16"
          gridClassName="mt-s8"
          heading={
            /* El "ver todo" a la derecha del titular no se compone aqui: es una
               prop de `SectionHeading`, para que todas las secciones con accion
               lo alineen igual (a la base del titular, no a su centro). */
            <SectionHeading
              id="featured"
              eyebrow={t("home.featured.eyebrow")}
              title={t("home.featured.title")}
              lead={t("home.featured.body")}
              size="lg"
              tone="light"
              action={
                <Link
                  href="/shop"
                  // `cn` y no la cadena de `buttonVariants` a pelo: la variante
                  // reasigna color y offset del anillo sobre clases que ya trae
                  // la base, y sin fusionar quedarian las dos y decidiria el
                  // orden de emision del CSS, que no es un contrato.
                  className={cn(buttonVariants({ variant: "inkGhost", size: "lg" }), "px-0")}
                >
                  {/* Etiqueta CORTA A LA VISTA, frase completa al oido (hallazgo
                      F7): en la linea del titular, a la derecha, "Ver toda la
                      mercancia" ocupa el ancho de media pantalla de telefono.
                      La frase larga sigue en el diccionario, sin tocar, y es la
                      que forma el nombre accesible del enlace: una lista de
                      enlaces anunciada por un lector de pantalla no puede tener
                      un "ver todo" sin complemento. */}
                  <span aria-hidden="true">{t("home.featured.viewAllShort")}</span>
                  <span className="sr-only">{t("home.featured.viewAll")}</span>
                  {/* Galon decorativo: repite lo que el enlace ya dice. */}
                  <svg
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    focusable="false"
                    className="h-3 w-3 shrink-0"
                  >
                    <path
                      d="M4.5 2.5 8 6l-3.5 3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              }
            />
          }
        />
      )}

      {/*
       * GANADORES PUBLICADOS.
       *
       * La lista llega VACIA y por eso la seccion no se renderiza. No es un
       * descuido: `winner_publication_enabled` esta apagado (DEC-032) y, aunque
       * estuviera encendido, `docs/API_CONTRACT.md` no publica hoy ninguna ruta
       * de ganadores -el dominio `winner.*` esta reservado a `backend` y
       * `security`-. La pantalla existe y esta probada con fixtures; lo que no
       * existe es una fuente de la que sacar el dato, y el frontend no se
       * inventa una.
       *
       * El flag se comprueba igualmente: si algun dia hubiera lista y el flag
       * estuviera apagado, la seccion seguiria sin renderizarse.
       */}
      <WinnersShowcase
        winners={
          isFeatureEnabled(uiConfig.flags, "winner_publication_enabled") ? PUBLISHED_WINNERS : []
        }
        locale={locale}
      />

      {/* Aqui cerraba la pagina la banda "Antes de participar". Se retira con
          DEC-069: sus dos acciones -Reglas Oficiales y preguntas frecuentes-
          siguen en el menu y en el pie, y el pie ya lleva su propio bloque de
          Reglas Oficiales, que es lo ultimo que se lee antes de salir. */}

      {/* PROXIMAMENTE (DEC-076): la gorra LSW Cap, que todavia no se vende.
          Cierra la portada con expectativa: sin precio ni compra. */}
      <ComingSoonBand />
    </>
  );
}
