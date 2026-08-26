import { Alert, Badge, buttonVariants, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatInteger, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type PromotionDetail, type PromotionSummary } from "@/lib/api";
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
 * - No calcula nada. Ni participaciones, ni multiplicadores, ni cuantas quedan
 *   del universo. La cuenta atras cuenta, pero NO decide: el estado de la
 *   promocion lo manda el backend y este componente lo lee de la maquina de
 *   estados (CLAUDE.md #15).
 * - No afirma nada legal. No dice quien puede participar, ni desde donde, ni
 *   con que edad, ni si hace falta comprar. Todo eso son Official Rules y las
 *   escribe el abogado del cliente (CLAUDE.md #1 y #2).
 * - Las fechas se formatean contra `promotion.legal_timezone`, nunca contra la
 *   zona del navegador (DEC-011), y se dice explicitamente que es asi.
 * - El importe llega como entero en unidad menor y solo se divide para
 *   pintarlo (DEC-010).
 * - El titulo, el resumen y el nombre del premio son contenido dinamico
 *   localizado (DEC-030): llegan del backend en los dos idiomas y se pintan con
 *   `pickLocalized`, SIN traducirlos. `t()` solo toca copy de producto
 *   (DEC-022).
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
 * COMPOSICION (DEC-038, rehecha por DEC-042)
 * ---------------------------------------------------------------------------
 * La referencia del usuario es un hero de automocion: fotografia del premio a
 * sangre, titular gigante con un fragmento en rojo, un boton rojo ancho, y
 * debajo la linea legal en letra pequena. Debajo del hero, la banda del
 * marcador. Esta es esa composicion, con el reparto de colores que fija
 * DEC-042: ROJO la accion de compra y el enfasis, ORO la marca y las cifras de
 * participaciones.
 *
 * DOS DISPOSICIONES CON UN SOLO ARBOL
 * -----------------------------------
 * En escritorio la imagen es una CAPA absoluta pegada al borde derecho, con un
 * degradado que la funde en el negro por la izquierda para que el titular
 * respire encima; en telefono esa misma capa vuelve al flujo, ocupa el ancho
 * completo y el bloque de texto sube sobre su mitad inferior con un margen
 * negativo. Es la misma imagen, el mismo `<img>` y el mismo orden de lectura:
 * duplicar el nodo para tener dos maquetaciones descargaria la fotografia dos
 * veces y dejaria dos elementos donde el arbol de accesibilidad espera uno.
 *
 * TRES BLOQUES, NO UNO
 * --------------------
 * Hero -> marcador -> avisos. El marcador sale del hero con DEC-042: el sitio
 * que ocupaba en escritorio -la columna derecha- es ahora la fotografia, y una
 * cuenta atras encima de una foto no se lee. El estado de la promocion, el
 * descargo de participaciones y la ausencia de reglas publicadas siguen en su
 * banda propia: son texto que hay que leer, y dentro de un hero de titulares
 * gigantes nadie los lee. Los tres siguen formando parte de este componente
 * -no de la pagina- porque acompanan a la promocion alla donde se muestre.
 */
export function PromotionHero({
  promotion,
  detail,
  locale,
  nowIso,
  amoeEnabled,
}: {
  readonly promotion: PromotionSummary;
  /**
   * Detalle de la MISMA promocion, si la pagina consiguio pedirlo.
   *
   * De aqui salen la fotografia del premio, su nombre y el universo de
   * participaciones: tres cosas que `PromotionSummary` no publica. Es
   * OPCIONAL y nulable a proposito, porque el detalle es una segunda peticion y
   * puede fallar sola: sin el, el hero se compone igual con lo que trae el
   * resumen. Un hero que dependiera del detalle convertiria un fallo de
   * informacion adicional en una portada rota.
   */
  readonly detail: PromotionDetail | null;
  readonly locale: Locale;
  /**
   * Instante de referencia del render, generado en el servidor. Ver
   * `PromotionCountdown`: es lo que hace coincidir el primer render de servidor
   * y de cliente.
   */
  readonly nowIso: string;
  /**
   * Si la promocion declara via gratuita de participacion (DEC-032).
   *
   * Gobierna QUE LINEA LEGAL se pinta debajo del boton, y por eso es un
   * parametro obligatorio y no un valor por defecto: "No se requiere compra" es
   * una afirmacion sobre las condiciones de participacion, y decirla sin que la
   * configuracion la respalde seria inventar una regla legal (CLAUDE.md #1 y
   * #2, DEC-042). Sin AMOE la linea dice lo unico que siempre es cierto: que
   * manda el documento.
   */
  readonly amoeEnabled: boolean;
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

  const media = detail?.media ?? null;
  const heroImage = media?.hero_url ?? null;
  /*
   * `alt` NULO SIGNIFICA DECORATIVA, y decorativa significa `alt=""`.
   *
   * No es lo mismo que no poner el atributo: sin `alt` un lector de pantalla
   * anuncia el nombre del fichero. La fotografia va junto a un titular que ya
   * nombra el premio, asi que describirla otra vez seria decir lo mismo dos
   * veces seguidas. Quien decide cual de los dos casos es no es esta pantalla:
   * es el dato (`PromotionMedia.alt`).
   */
  const heroAltText = media?.alt ?? null;
  const heroAlt = heroAltText === null ? "" : pickLocalized(heroAltText, locale);

  const prize = detail?.prize ?? null;
  const prizeName = prize === null ? null : pickLocalized(prize.name, locale);

  const title = pickLocalized(promotion.title, locale);

  const entryPool = detail?.entry_pool ?? null;
  const entryPoolCap = entryPool === null ? null : formatInteger(entryPool.cap, locale);
  const issued = entryPool?.issued ?? null;
  const entriesIssued = issued === null ? null : formatInteger(issued, locale);

  return (
    <>
      <section
        aria-labelledby="promotion-title"
        className="lsw-atmosphere lsw-grain relative isolate overflow-hidden"
      >
        {heroImage === null ? (
          /*
           * Sin fotografia del premio, la marca de agua.
           *
           * Es la estrella coronada del logotipo, enorme y casi apagada, detras
           * del contenido. Va como imagen de FONDO de un `div` decorativo y no
           * como `<img>`: asi no entra en el arbol de accesibilidad, no compite
           * por el orden de carga con el contenido, y desaparece en pantallas
           * pequenas, donde solo restaria contraste al titular.
           *
           * Las dos son excluyentes a proposito: una marca de agua gigante
           * detras de una fotografia son dos imagenes peleando por el mismo
           * sitio, y gana la que no dice nada.
           */
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 top-1/2 hidden h-[46rem] w-[46rem] -translate-y-1/2 bg-contain bg-center bg-no-repeat opacity-[0.07] lg:block"
            style={{ backgroundImage: "url('/brand/lsw-mark.png')" }}
          />
        ) : (
          <div
            className={cn(
              // En telefono: en el flujo, a todo el ancho, arriba del texto.
              "relative w-full",
              // En escritorio: capa pegada al borde derecho, a sangre.
              "lg:pointer-events-none lg:absolute lg:inset-y-0 lg:right-0 lg:w-[56%]",
            )}
          >
            {/* La URL llega del backend -hoy, de la API simulada- y todavia no
                hay dominios de imagen configurados en `next.config`. Cuando los
                haya, esto pasa a `next/image` sin tocar el resto del hero.
                `fetchPriority` alto: es la imagen mas grande de la primera
                pantalla y es lo que decide cuando la portada parece cargada. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage}
              alt={heroAlt}
              fetchPriority="high"
              // 46svh en telefono deja el hueco casi cuadrado, que es la
              // proporcion para la que esta encuadrada la imagen: mas alto
              // recortaria el morro por los lados. En escritorio ocupa la
              // altura entera de la columna.
              className="h-[46svh] min-h-[15rem] w-full object-cover object-center lg:h-full"
            />

            {/* Degradado de fundido. Cambia de EJE con el tamano de pantalla
                porque el texto tambien cambia de sitio: en telefono el titular
                cae sobre la parte baja de la foto y el fundido va hacia arriba;
                en escritorio el titular esta a la izquierda y el fundido va
                hacia la derecha. Es decoracion pura y no entra en el arbol. */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-transparent",
                "lg:bg-gradient-to-r lg:from-bg lg:via-bg/60 lg:to-transparent",
              )}
            />
          </div>
        )}

        <div className="lsw-container relative flex flex-col justify-center pb-s12 lg:min-h-[calc(100svh-5rem)] lg:py-s24">
          <div
            className={cn(
              "flex flex-col",
              // El bloque sube sobre la mitad inferior de la fotografia, que ya
              // esta fundida en negro por el degradado. En escritorio no hay
              // nada que solapar: la imagen esta al lado, no encima.
              heroImage === null ? "pt-s16" : "-mt-[13svh] pt-0 lg:mt-0",
              "lg:max-w-[52%]",
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              {/*
               * CHIP DE ESTADO SOBRE EL TITULAR.
               *
               * Lo que lleva escrito es DATO: el estado que reporta el backend,
               * traducido por la misma funcion que lo traduce en el resto del
               * sitio. Su color sale del estado, no de una decision de esta
               * pantalla.
               */}
              <PromotionStatusBadge
                status={promotion.status}
                size="md"
                emphasis="solid"
                shape="square"
              />

              {/* Antetitulo en ROJO (DEC-042). Es copy de producto -no dice
                  nada de la promocion que el chip de al lado no diga- y por eso
                  puede llevar el color de atencion sin afirmar nada. */}
              <Badge tone="accent" emphasis="subtle" shape="square" size="sm">
                {t("eyebrow")}
              </Badge>
            </div>

            {/*
             * EL TITULAR, EN TRES LINEAS.
             *
             * Y las tres tienen dueno distinto, que es lo que hace que se pueda
             * escribir asi de grande sin afirmar nada:
             *
             *   1. el verbo, en rojo con brillo. Es copy de producto (DEC-022):
             *      "GANA" / "WIN", sin articulo. La forma con articulo -"gana
             *      ESTA"- obligaria a concordar en genero con un nombre de
             *      premio que escribe un administrador, y "gana esta remolque"
             *      es exactamente el fallo que no se puede arreglar desde aqui.
             *   2. el PREMIO, al mayor tamano del sistema. Dato del backend.
             *   3. el nombre de la promocion, subordinado. Dato del backend.
             *
             * Sin premio declarado -que es el estado real del backend hoy- las
             * dos primeras desaparecen y el titulo ocupa el tamano grande: el
             * hero no se queda con un hueco ni inventa un premio.
             */}
            <h1 id="promotion-title" className="mt-s5 flex flex-col gap-s1">
              {prizeName === null ? (
                <span className="lsw-display text-display-lg text-text sm:text-display-xl">
                  {title}
                </span>
              ) : (
                <>
                  <span className="lsw-display lsw-accent-sheen text-display-md">
                    {t("hero.win")}
                  </span>
                  <span className="lsw-display text-display-lg text-text sm:text-display-xl">
                    {prizeName}
                  </span>
                  <span className="mt-s2 font-display text-heading-sm font-semibold text-text-muted">
                    {title}
                  </span>
                </>
              )}
            </h1>

            {/* Linea en itálica bajo el titular: el universo de participaciones
                que declara la promocion. Es DATO -`entry_pool.cap`, ver
                DEC-042- y va en ORO, que es el color con el que este sistema
                escribe las cifras de participaciones. No dice cuantas quedan,
                porque el frontend no resta. */}
            {entryPoolCap === null ? null : (
              <p className="mt-s4 font-display text-body-lg italic text-brand">
                {t("hero.poolNote", { entries: entryPoolCap })}
              </p>
            )}

            <p className="mt-s5 max-w-narrow text-body-lg text-text-muted">
              {pickLocalized(promotion.summary, locale)}
            </p>

            {/*
             * LA ACCION PRINCIPAL DEPENDE DEL ESTADO.
             *
             * Mientras la promocion admite participaciones, lo primero que hay
             * que poder hacer es ver la MERCANCIA: es lo que se adquiere, y la
             * promocion es el marco. En cuanto deja de admitirlas, esa misma
             * llamada seria una afirmacion falsa -invitar a pedir mercancia
             * "para esta promocion" sobre una promocion cerrada-, y la accion
             * principal pasa a ser el detalle, que es donde se explica en que
             * fase esta el proceso. La decision NO se toma aqui: sale de la
             * misma maquina de estados que gobierna el resto del sitio.
             *
             * EL BOTON ROJO LLEVA A LA TIENDA Y DICE "COMPRAR" (DEC-042).
             * La referencia pone aqui "ENTER NOW" y eso es justo lo que este
             * producto no puede escribir sobre un enlace al catalogo: comprar
             * mercancia no es participar, y encuadrarlo asi contradice
             * `CLAUDE.md` seccion 1. Se toma el color y el tamano; el verbo es
             * el que corresponde a lo que hay al otro lado del enlace.
             */}
            <div className="mt-s8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href={presentation.showsShopCta ? "/shop" : `/promotions/${promotion.slug}`}
                // Ancho completo en telefono -es la unica accion de la
                // pantalla, y la referencia la pinta de lado a lado- y ancho
                // natural en cuanto caben dos botones en la misma linea. No se
                // usa la variante `fullWidth`: `w-full` sin punto de corte
                // dejaria los dos botones apilados tambien en escritorio.
                className={cn(
                  buttonVariants({
                    variant: presentation.showsShopCta ? "accent" : "primary",
                    size: "xl",
                  }),
                  "w-full sm:w-auto",
                )}
              >
                {presentation.showsShopCta ? t("hero.shopNow") : t("viewPromotion")}
              </Link>

              {presentation.showsShopCta ? (
                <Link
                  href={`/promotions/${promotion.slug}`}
                  className={cn(
                    buttonVariants({ variant: "subtle", size: "xl" }),
                    "w-full sm:w-auto",
                  )}
                >
                  {t("viewPromotion")}
                </Link>
              ) : null}
            </div>

            {/*
             * LA LINEA LEGAL, DEBAJO DEL BOTON.
             *
             * Es la pieza de la referencia que mas facil seria copiar mal. Ahi
             * pone "No Purchase Necessary", y eso es una afirmacion sobre las
             * condiciones de participacion: solo puede escribirse cuando la
             * promocion declara via gratuita. Con `amoe_enabled` apagado la
             * linea dice lo unico que siempre es cierto -que manda el
             * documento- y el enlace sigue estando.
             *
             * Sin version de reglas publicada (DEC-012) no hay enlace, porque
             * llevaria a un 404; el aviso de la banda de abajo lo explica.
             */}
            <p className="mt-s5 max-w-narrow text-caption italic text-text-subtle">
              {amoeEnabled ? t("hero.legalAmoe") : t("hero.legalRules")}
              {/* El separador se pinta CON el enlace y no dentro de la frase.
                  Con la frase terminada en raya, una promocion sin reglas
                  publicadas dejaba la linea colgando de un guion que no
                  introducia nada. Es puntuacion, no copy: no lleva clave. */}
              {hasRules ? (
                <>
                  {" — "}
                  <Link
                    href={`/official-rules?promotion=${promotion.slug}`}
                    className="font-medium text-text-muted underline underline-offset-4 hover:text-accent-text"
                  >
                    {t("viewOfficialRules")}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </section>

      {/*
       * BANDA DEL MARCADOR.
       *
       * Sale del hero con DEC-042 y pasa a banda propia a todo el ancho, que es
       * donde la pone la referencia. El plazo escrito -con hora y zona legal-
       * va al lado del marcador y no dentro de el: son la misma informacion a
       * dos precisiones distintas, y quien viene a apuntarse la fecha necesita
       * la escrita.
       */}
      {presentation.countdownTarget === null && opensAt === null && closesAt === null ? null : (
        <div className="lsw-band-sunken">
          <div className="lsw-container grid gap-s8 py-s10 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start lg:gap-s12">
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

            <div className="flex flex-col gap-s5">
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

                {/* Participaciones ya emitidas del universo. Cifra SERVIDA por
                    el backend, sin adorno y sin exclamacion: no se dice cuantas
                    quedan -eso lo calcularia el cliente a partir de dos numeros
                    que pueden llegar desincronizados, y ademas seria urgencia
                    fabricada (DEC-042)- ni se pinta una barra de agotamiento. */}
                {entriesIssued === null ? null : (
                  <div className={META_ROW}>
                    <dt className={META_LABEL}>{t("hero.issuedLabel")}</dt>
                    <dd className={cn(META_VALUE, "tabular-nums text-brand")}>{entriesIssued}</dd>
                  </div>
                )}
              </dl>

              <p className="text-caption text-text-subtle">{t("timeZoneNote")}</p>
            </div>
          </div>
        </div>
      )}

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
