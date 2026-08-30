import { Alert, Badge, buttonVariants, cn } from "@lsw/ui";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type PromotionDetail, type PromotionSummary } from "@/lib/api";
import { normalizeEntryOffer } from "@/lib/entry-offer";
import { safeImageUrl } from "@/lib/media-url";
import { presentPromotion } from "@/lib/promotion-state";

import { BonusAnnouncement } from "./bonus-announcement";
import { RateList } from "./entry-rate-lines";
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
 *   por debajo del tope. La cuenta atras cuenta, pero NO decide: el estado de la
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
 * SIN REGLAS PUBLICADAS NO HAY HERO PROMOCIONAL (DEC-044)
 * -------------------------------------------------------
 * Y eso es mas que no enlazar el documento. La auditoria de copy leyo el hero
 * completo -"GANA", premio gigante, boton rojo a la tienda, cuenta atras y chip
 * de promocion vigente- como una INVITACION A COMPRAR PARA PARTICIPAR, aunque
 * ninguna de sus frases lo diga. La salida no puede ser anadir la linea "no se
 * requiere compra": mientras AMOE siga en TBD, escribirla seria inventar un
 * requisito legal (CLAUDE.md #2). La salida es no publicar la invitacion hasta
 * que exista el documento que la respalda.
 *
 * Asi que sin reglas publicadas el hero pasa a un ESTADO CONTENIDO: el premio y
 * el titulo siguen viendose -son dato del backend y no afirman condiciones- y
 * desaparecen el verbo, las tasas, el tope por persona, el anuncio de bonus,
 * los chips, la cuenta
 * atras y el boton de compra. En su sitio queda el aviso de que las Reglas
 * Oficiales todavia no estan publicadas y, como unica accion, un enlace neutro
 * a la tienda: mercancia sin promesa.
 *
 * Es DEFENSA EN PROFUNDIDAD sobre DEC-012, no un sustituto. El cerrojo que
 * impide que una promocion llegue a ACTIVE con claves legales en TBD es de
 * backend; esto es la mitad del frontend, y existe porque un hero que solo es
 * correcto mientras la base de datos este vacia no es correcto.
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
  multipliersEnabled,
}: {
  readonly promotion: PromotionSummary;
  /**
   * Detalle de la MISMA promocion, si la pagina consiguio pedirlo.
   *
   * De aqui salen la fotografia del premio, su nombre y la oferta de
   * participaciones -tasas, tope por persona y periodos bonus-: tres cosas que
   * `PromotionSummary` no publica. Es
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
  /**
   * Valor de `entry_multipliers_enabled`, leido en SERVIDOR (DEC-013).
   *
   * OBLIGATORIO, sin valor por defecto, por el mismo motivo que `amoeEnabled`:
   * anunciar un "5X" que el motor no aplica es una afirmacion falsa sobre lo
   * que vale una compra, y un `true` implicito la publicaria por olvido.
   *
   * La oferta ademas trae su propio `multipliers_enabled`; se exigen los DOS.
   * No es redundancia perezosa: el flag del sitio y el que aplico el motor a
   * esta promocion pueden discrepar durante el instante en que alguien lo
   * apaga, y en esa ventana lo correcto es callar.
   */
  readonly multipliersEnabled: boolean;
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

  /*
   * LA SENAL ES `rules_version_id`, Y ES LA UNICA FIABLE HOY.
   *
   * DEC-044 pide dos condiciones: version de reglas declarada Y documento
   * disponible. La segunda no se puede comprobar desde aqui sin una tercera
   * peticion por render -`GET /promotions/{slug}/official-rules`- que ademas
   * introduciria un fallo peor que el que evita: un corte transitorio de esa
   * ruta haria que la portada afirmara que las Reglas Oficiales no estan
   * publicadas cuando si lo estan.
   *
   * Y no hace falta: `rules_version_id` ES el identificador de la version
   * ACTIVE de las reglas, y el contrato lo declara `null` precisamente
   * mientras no haya ninguna (DEC-012). Un `rules_version_id` que apuntara a
   * un documento que la API no sirve seria una incoherencia del backend, no un
   * caso que esta pantalla deba adivinar.
   */
  const hasRules = promotion.rules_version_id !== null;

  /**
   * Si se publica el hero promocional completo o el estado contenido (DEC-044).
   *
   * Hoy vale exactamente `hasRules`, y esta como constante propia -en vez de
   * consultar `hasRules` en cada sitio- porque son dos preguntas distintas que
   * hoy tienen la misma respuesta: una decide si se ENLAZA el documento y la
   * otra si se PUBLICA la invitacion. El dia que la segunda dependa de algo
   * mas, se cambia aqui y no en los seis sitios que la consultan.
   */
  const showsPromotionalHero = hasRules;

  /*
   * La cuenta atras es parte de la invitacion, no del dato.
   *
   * Un marcador a pantalla completa contando hacia el cierre es el elemento de
   * urgencia de la composicion. El plazo ESCRITO se queda: es la misma
   * informacion sin el reclamo, y quien viene a apuntarse la fecha la necesita.
   */
  const countdownTarget = showsPromotionalHero ? presentation.countdownTarget : null;

  const media = detail?.media ?? null;

  /*
   * LA FOTOGRAFIA DEL PREMIO SE FILTRA ANTES DE PINTARLA
   * (HO-041, hallazgo S-11).
   *
   * `media.hero_url` es un campo del contrato que escribe quien administra la
   * promocion, y esta es la imagen mas grande y mas visible del sitio: un
   * `http:` aqui convierte la portada en contenido mixto y manda el `Referer`
   * de todos los visitantes a un tercero, y un `data:` incrusta un documento
   * ajeno a sangre en el hero. La API tambien lo valida al escribir; la
   * duplicidad es deliberada y esta razonada en `@/lib/media-url`.
   *
   * Filtrada, la URL vale `null` y el hero cae en la MARCA DE AGUA, que es la
   * rama que ya existia para una promocion sin fotografia. Es decir: una URL
   * que no se puede pintar no deja un hueco roto, deja el estado sin imagen.
   */
  const heroImage = safeImageUrl(media?.hero_url);
  /*
   * `alt` NULO SIGNIFICA DECORATIVA, y decorativa significa `alt=""`.
   *
   * No es lo mismo que no poner el atributo: sin `alt` un lector de pantalla
   * anuncia el nombre del fichero. Una ilustracion junto a un titular que ya
   * nombra el premio no aporta nada y se declara decorativa; una FOTOGRAFIA del
   * vehiculo real si -el color, la carroceria, el angulo no estan en ningun
   * texto- y entonces el dato trae su descripcion en los dos idiomas.
   *
   * Cual de los dos casos es NO lo decide esta pantalla: lo decide el dato
   * (`PromotionMedia.alt`). Aqui solo se traduce `null` a `alt=""`.
   */
  const heroAltText = media?.alt ?? null;
  const heroAlt = heroAltText === null ? "" : pickLocalized(heroAltText, locale);

  const prize = detail?.prize ?? null;
  const prizeName = prize === null ? null : pickLocalized(prize.name, locale);

  const title = pickLocalized(promotion.title, locale);

  /*
   * EL TOPE ES POR PERSONA, Y NO HAY UNIVERSO (DEC-052 punto 6).
   *
   * Aqui vivia `entry_pool.cap`, que la portada pintaba como "universo limitado
   * a 10,000 participaciones". El segundo borrador de las Official Rules aclaro
   * que ese 10,000 nunca fue un universo total: es el tope POR PARTICIPANTE,
   * "por cualquier metodo o combinacion de metodos". Son dos afirmaciones
   * completamente distintas -una habla de cuantas hay en total y la otra de
   * cuantas puede tener una persona- y la primera, ademas, invitaba a la resta
   * que DEC-044 vino a impedir.
   *
   * Lo que se publica ahora es el tope por persona, y solo si los topes estan
   * ENCENDIDOS: `normalizeEntryOffer` lo devuelve `null` con `caps_enabled` en
   * falso, porque un tope declarado que el motor no aplica no se puede anunciar.
   * Sigue sin haber emitidas ni restantes en ninguna superficie publica.
   */
  const offer = normalizeEntryOffer(detail?.entry_offer, nowIso);
  const maxPerPerson = offer?.perParticipantMax ?? null;
  const perParticipantMax = maxPerPerson === null ? null : formatEntryCount(maxPerPerson, locale);

  /*
   * El bonus tiene los mismos tres cerrojos que en `EntryOfferPanel`: el flag
   * del sitio, el que declara la propia oferta, y que la promocion admita
   * participaciones. Y uno mas aqui: las Reglas publicadas. Anunciar "5X" en el
   * hero de una promocion sin documento que la gobierne seria la invitacion mas
   * concreta de toda la pagina.
   */
  const bonusAllowed =
    showsPromotionalHero &&
    multipliersEnabled &&
    offer !== null &&
    offer.multipliersEnabled &&
    presentation.acceptsEntries;

  const activeBonus = bonusAllowed ? (offer?.activeBonus ?? null) : null;
  const upcomingBonuses = bonusAllowed ? (offer?.upcomingBonuses ?? []) : [];

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
              // La ALTURA vive aqui y no en la imagen porque `next/image` con
              // `fill` se posiciona en absoluto: si el hueco no la declarara,
              // el contenedor mediria cero y la fotografia no se veria.
              // 46svh deja el hueco casi cuadrado.
              "relative h-[46svh] min-h-[15rem] w-full",
              // En escritorio: capa pegada al borde derecho, a sangre. `h-auto`
              // devuelve el mando a `inset-y-0`, que es lo que la estira a la
              // altura entera de la seccion.
              "lg:pointer-events-none lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[56%]",
            )}
          >
            {/*
             * `next/image`, y no `<img>`, desde DEC-042.
             *
             * La imagen llega como ruta LOCAL servida por la propia aplicacion
             * (`/prizes/...`), asi que el optimizador de Next puede con ella sin
             * configurar dominios: genera `srcset` y formatos modernos, y con
             * `sizes` un telefono se descarga una variante estrecha en vez de la
             * fotografia entera. Es la mitad del coste de esta pantalla.
             *
             * Y desde S-11 el origen ya no puede ser otra cosa: `safeImageUrl`
             * admite `https:` y rutas del propio sitio, y nada mas. El respaldo
             * de desarrollo, que hasta ahora viajaba como `data:` URI, es hoy
             * un fichero de `public/prizes/` por ese mismo motivo.
             *
             * `priority`: es la imagen mas grande de la primera pantalla y es lo
             * que decide cuando la portada parece cargada.
             *
             * NOTA DE DESPLIEGUE: el optimizador necesita `sharp` en el entorno
             * de ejecucion. Hoy llega en el arbol a traves de Next; si el
             * empaquetado de `output: standalone` lo dejara fuera, las imagenes
             * fallarian solo en produccion.
             */}
            <Image
              src={heroImage}
              alt={heroAlt}
              fill
              priority
              sizes="(min-width: 1024px) 56vw, 100vw"
              /*
               * ENCUADRE DE ESTA FOTOGRAFIA (DEC-042).
               *
               * `38%` en horizontal: el hueco es mas estrecho que la imagen en
               * todos los tamanos, asi que `cover` recorta A LO ANCHO y hay que
               * decidir que parte de la camioneta se queda. Desplazado a la
               * izquierda del centro conserva el frontal completo -parrilla,
               * emblema, faro y rueda delantera-, que es lo que identifica al
               * vehiculo, y sacrifica la caja, que no dice nada.
               *
               * `35%` en vertical: en las dos disposiciones el eje vertical no
               * recorta nada -se ve la altura entera- y este valor da igual. Solo
               * entra en juego en una ventana muy ancha y baja, y ahi tira hacia
               * ARRIBA a proposito: lo que hay que salvar es el techo de la
               * cabina, no el asfalto del pie, que ademas queda bajo el degradado.
               *
               * El rotulo del concesionario que aparecia sobre el techo NO se
               * quita desde aqui: es imposible con `cover` en un hueco mas
               * estrecho que la imagen. Se recorta en origen; ver
               * `scripts/build-prize-assets.mjs`.
               */
              className="object-cover object-[38%_35%]"
            />

            {/* Degradado de fundido. Cambia de EJE con el tamano de pantalla
                porque el texto tambien cambia de sitio: en telefono el titular
                cae sobre la parte baja de la foto y el fundido va hacia arriba;
                en escritorio el titular esta a la izquierda y el fundido va
                hacia la derecha. Es decoracion pura y no entra en el arbol.

                Las paradas estan MEDIDAS, no elegidas a ojo: el peor pixel bajo
                el titular queda en 13,9:1 de contraste en telefono y 12,8:1 en
                escritorio contra el blanco del sistema, con la fotografia real
                y el recorte real. La fotografia es de dia y el sitio es negro:
                sin degradado, el titular blanco caeria sobre asfalto claro.

                En escritorio ademas TAPA la camioneta negra que asoma por la
                izquierda del encuadre, que en las ventanas mas anchas vuelve a
                entrar en cuadro. */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute inset-0 bg-gradient-to-t from-bg via-bg/80 via-40% to-bg/0 to-70%",
                "lg:bg-gradient-to-r lg:via-bg/70 lg:via-30% lg:to-60%",
              )}
            />

            {/* Pie: una segunda pasada, corta y solo hacia arriba. Sin ella la
                fotografia termina en un corte recto de asfalto claro contra el
                negro de la banda siguiente, y se ve como una lamina pegada
                encima de la pagina en vez de como parte de ella. En telefono es
                tambien lo que sostiene el titular. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bg to-bg/0"
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
            {/*
             * LOS CHIPS SON PARTE DE LA INVITACION (DEC-044).
             *
             * "Abierta" y "Promocion vigente" encabezando un hero sin Reglas
             * Oficiales publicadas es la afirmacion que la auditoria pide
             * retirar: no porque el estado sea falso -lo reporta el backend-
             * sino porque ahi arriba funciona como llamada. El estado sigue
             * dicho, entero y con su explicacion, en la banda de avisos de mas
             * abajo, que es donde se lee de verdad.
             */}
            {!showsPromotionalHero ? null : (
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
                    nada de la promocion que el chip de al lado no diga- y por
                    eso puede llevar el color de atencion sin afirmar nada. */}
                <Badge tone="accent" emphasis="subtle" shape="square" size="sm">
                  {t("eyebrow")}
                </Badge>
              </div>
            )}

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
                  {/* El verbo cae con el estado contenido (DEC-044): "GANA"
                      encabezando un premio es la invitacion misma. El premio y
                      el titulo se quedan, que es lo que DEC-044 deja ver. */}
                  {!showsPromotionalHero ? null : (
                    <span className="lsw-display lsw-accent-sheen text-display-md">
                      {t("hero.win")}
                    </span>
                  )}
                  <span className="lsw-display text-display-lg text-text sm:text-display-xl">
                    {prizeName}
                  </span>
                  <span className="mt-s2 font-display text-heading-sm font-semibold text-text-muted">
                    {title}
                  </span>
                </>
              )}
            </h1>

            {/* Linea en itálica bajo el titular: el tope POR PERSONA que
                declara la promocion. Es DATO -`entry_offer.per_participant_max`,
                ver DEC-052- y va en ORO, que es el color con el que este sistema
                escribe las cifras de participaciones. No dice cuantas quedan
                -el frontend no resta- ni cuantas se han emitido, porque desde
                DEC-052 no existe ninguna cifra de emitidas en el contrato.

                Cae con el estado contenido: "maximo 10,000 por persona" es una
                afirmacion sobre COMO funciona la promocion, y de eso no se dice
                nada mientras no exista el documento que lo gobierna. */}
            {!showsPromotionalHero || perParticipantMax === null ? null : (
              <p className="mt-s4 font-display text-body-lg italic text-brand">
                {t("hero.capNote", { entries: perParticipantMax })}
              </p>
            )}

            {/* Las TASAS, en el hero y no solo en el panel de oferta. Es lo
                primero que alguien quiere saber al llegar -que da cada dolar-
                y, con dos tipos de producto, decirlo solo en el panel de mas
                abajo dejaba la portada sin la mitad de la respuesta.

                Cae igual con el estado contenido, y por el mismo motivo que el
                tope: son las cifras mas concretas que la promocion declara. */}
            {!showsPromotionalHero || offer === null || offer.rates.length === 0 ? null : (
              <RateList
                rates={offer.rates}
                locale={locale}
                className="mt-s4 max-w-narrow text-text-muted"
              />
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
             *
             * Y TODO ESO SOLO CON REGLAS PUBLICADAS (DEC-044). Sin ellas hay
             * otra rama entera, que es la primera de las dos que siguen.
             */}
            {!showsPromotionalHero ? (
              /*
               * ESTADO CONTENIDO (DEC-044).
               *
               * Lo que ocupa el sitio del boton rojo no es otro boton: es el
               * aviso de que las Reglas Oficiales todavia no estan publicadas.
               * Va AQUI y no solo en la banda de avisos porque es la respuesta
               * a lo que el hero acaba de ensenar, y porque el hueco que deja
               * la invitacion retirada tiene que explicarse en el sitio donde
               * estaba.
               *
               * Debajo, una sola accion y deliberadamente sosa: un enlace a la
               * tienda, en la variante `subtle` -no `accent`, que es el rojo
               * de compra de DEC-042- y con la etiqueta neutra "Ver la tienda".
               * No dice "comprar" ni nombra la promocion: al otro lado hay
               * mercancia, y mercancia se puede ensenar sin ninguna promesa.
               */
              <div className="mt-s8 flex flex-col items-start gap-s5">
                <Alert tone="warning" className="w-full max-w-narrow">
                  {t("rulesNotPublished")}
                </Alert>

                <Link
                  href="/shop"
                  className={cn(
                    buttonVariants({ variant: "subtle", size: "lg" }),
                    "w-full sm:w-auto",
                  )}
                >
                  {t("hero.browseShop")}
                </Link>
              </div>
            ) : (
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
            )}

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

            {/*
             * ANUNCIO DE BONUS, dentro del hero y debajo de la linea legal.
             *
             * Va aqui y no en la banda de anuncio de arriba por dos razones. La
             * primera es de sitio: la banda es UNA linea en caja alta a todo lo
             * ancho del sitio, y un periodo bonus necesita decir el
             * multiplicador, sobre que aplica y hasta cuando, que son tres
             * datos. La segunda es de alcance: la banda se ve en todas las
             * paginas, y el bonus pertenece a la promocion.
             *
             * Y va DESPUES de la linea legal a proposito: lo ultimo que se lee
             * antes del anuncio es que manda el documento.
             */}
            <div className="mt-s6 max-w-narrow">
              <BonusAnnouncement
                activeBonus={activeBonus}
                upcomingBonuses={upcomingBonuses}
                locale={locale}
                timeZone={promotion.legal_timezone}
                nowIso={nowIso}
              />
            </div>
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
      {countdownTarget === null && opensAt === null && closesAt === null ? null : (
        <div className="lsw-band-sunken">
          <div className="lsw-container grid gap-s8 py-s10 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start lg:gap-s12">
            {countdownTarget === null ? null : (
              <PromotionCountdown
                targetIso={
                  countdownTarget === "starts_at" ? promotion.starts_at : promotion.ends_at
                }
                nowIso={nowIso}
                locale={locale}
                timeZone={promotion.legal_timezone}
                variant={countdownTarget === "starts_at" ? "opens" : "closes"}
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

                {/* Aqui iba la cifra de participaciones EMITIDAS, y se retira
                    con DEC-044: junto al tope publicaba el contador de
                    restantes por implicacion. Solo quedan las fechas, que son
                    plazo y no inventario. */}
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

          {/* El aviso de "Reglas Oficiales sin publicar" ya NO se pinta aqui.
              Con DEC-044 sube al hueco que deja la invitacion retirada, dentro
              del hero, y repetirlo en esta banda lo diria dos veces en la misma
              pantalla. Sigue habiendo exactamente un sitio donde se dice. */}
        </div>
      </div>
    </>
  );
}

const META_ROW = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";

const META_LABEL = "font-display text-overline uppercase tracking-wide text-text-subtle";

const META_VALUE = "text-body-sm font-medium text-text";
