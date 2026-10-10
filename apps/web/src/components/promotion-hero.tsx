import { buttonVariants, cn } from "@lsw/ui";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";

import { formatEntryCount, formatZonedDeadline } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { usePromotionNoticeText } from "@/i18n/promotion-labels";
import { pickLocalized, type PromotionDetail, type PromotionSummary } from "@/lib/api";
import { normalizeEntryOffer } from "@/lib/entry-offer";
import { safeImageUrl } from "@/lib/media-url";
import { presentPromotion } from "@/lib/promotion-state";

import { BonusAnnouncement } from "./bonus-announcement";
import { fractionText, useBonusScopeLabel } from "./entry-rate-lines";
import { HeroCarousel, type HeroSlide } from "./hero-carousel";
import { PromotionCountdown } from "./promotion-countdown";
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
 * UN SOLO BLOQUE (DEC-069)
 * ------------------------
 * Con DEC-042 el hero iba seguido de una banda de marcador -con la lista de
 * fechas "Abre / Cierra"- y de otra de avisos. El cliente pidio recortar la
 * portada para que el camino a la compra fuera corto, y las dos bandas eran una
 * pantalla entera de telefono entre el premio y los paquetes. Ahora todo vive
 * aqui, en la columna del texto: botones, marcador con el plazo escrito en una
 * linea, el aviso de estado SOLO cuando una compra no cuenta, y la letra
 * pequena. La cuenta atras va bajo los botones y no sobre la foto: una cuenta
 * atras encima de una foto no se lee.
 */
/** Tamanos de la foto del hero para `next/image`: media pantalla en escritorio. */
const HERO_IMAGE_SIZES = "(min-width: 1024px) 56vw, 100vw";

/** Encuadre de la foto del hero. El motivo, junto a la `<Image>` de abajo. */
const HERO_IMAGE_POSITION = "object-[38%_35%]";

/**
 * Tamano del titular cromado segun su LONGITUD.
 *
 * El titulo lo escribe quien administra la promocion, y no es lo mismo
 * "GANA SILVERADO 2025" (19 caracteres) que el nombre legal de la edicion,
 * "Sorteo Lone Star Winners Chevrolet Silverado 1500 2025" (54). Al tamano
 * del primero, el segundo ocupaba seis lineas y media pantalla de telefono
 * antes de llegar al boton. Tres escalones fijos, y no un calculo continuo,
 * para que el servidor y el cliente pinten siempre la misma clase.
 */
function headlineSize(text: string): string {
  if (text.length > 40) return "text-[clamp(1.9rem,7.5vw,3.75rem)]";
  if (text.length > 24) return "text-[clamp(2.25rem,9.5vw,4.75rem)]";
  return "text-[clamp(2.75rem,12vw,6.25rem)]";
}

/**
 * Retraso de la entrada escalonada del hero al cargar (DEC-075): cada bloque
 * llega un poco despues del anterior. Las clases `lsw-enter*` estan en
 * `globals.css` y se apagan con `prefers-reduced-motion`.
 */
function enter(delayMs: number): CSSProperties {
  return { "--enter-delay": `${String(delayMs)}ms` } as CSSProperties;
}

export function PromotionHero({
  promotion,
  detail,
  locale,
  nowIso,
  amoeEnabled,
  multipliersEnabled,
  buyHref = "/shop",
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
  /**
   * A donde lleva el boton rojo de compra (DEC-069). Por defecto, la tienda.
   * La portada lo apunta a su propia banda de paquetes (`#packages`) para
   * ahorrar una pagina: ahi ya se anade al carrito.
   */
  readonly buyHref?: string;
}) {
  const t = useTranslations("home");
  const tA11y = useTranslations("a11y");
  const bonusScopeLabel = useBonusScopeLabel();
  const noticeText = usePromotionNoticeText();
  const presentation = presentPromotion(promotion.status);
  const stateNotice = noticeText(presentation.noticeKey);

  /*
   * El plazo que corresponde al estado -la apertura antes de abrir, el cierre
   * mientras esta abierta-, formateado en la zona horaria legal (DEC-011). Es
   * el mismo instante al que apunta la cuenta atras.
   */
  const deadlineIso =
    presentation.countdownTarget === "starts_at"
      ? promotion.starts_at
      : presentation.countdownTarget === "ends_at"
        ? promotion.ends_at
        : null;
  // DEC-077: formato corto -"8 nov 2026, 11:59 p.m. CST"-, sin segundos.
  const deadlineText =
    deadlineIso === null
      ? null
      : formatZonedDeadline(deadlineIso, locale, promotion.legal_timezone);
  const deadline =
    deadlineIso === null || deadlineText === null
      ? null
      : {
          iso: deadlineIso,
          text: deadlineText,
          kind: presentation.countdownTarget === "starts_at" ? "opens" : "closes",
        };

  /*
   * El boton rojo solo baja a los paquetes mientras una compra suma
   * participaciones. En cualquier otro estado lleva a la tienda, como antes:
   * empujar hacia los paquetes de una promocion que no los cuenta seria la
   * invitacion que la maquina de estados retira.
   */
  const buyLink = presentation.acceptsEntries ? buyHref : "/shop";

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

  /*
   * LAS FOTOS DEL CARRUSEL (DEC-066).
   *
   * `media.gallery` trae todas, empezando por la de `hero_url`. Cada una pasa
   * por el mismo filtro que la principal: una URL que no se puede pintar se
   * cae de la lista en vez de dejar un hueco. Sin galeria -API anterior a
   * DEC-066- o con todas filtradas, queda la principal sola.
   */
  const gallerySlides: readonly HeroSlide[] = (media?.gallery ?? []).flatMap((image) => {
    const src = safeImageUrl(image.url);
    return src === null
      ? []
      : [{ src, alt: image.alt === null ? "" : pickLocalized(image.alt, locale) }];
  });
  const slides: readonly HeroSlide[] =
    gallerySlides.length > 0
      ? gallerySlides
      : heroImage === null
        ? []
        : [{ src: heroImage, alt: heroAlt }];
  const primarySlide = slides[0] ?? null;

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

  /*
   * UN SOLO MARCADOR (DEC-084, peticion del cliente).
   *
   * Con un bonus vigente, el marcador grande del hero cuenta hasta el FIN DEL
   * BONUS y lo dice ("Promocion 2x1 en mercancia cierra en:"), y el recuadro
   * del bonus deja de pintar su propia cuenta atras: dos contadores a la vez,
   * uno a 31 dias y otro a 6, se leian como dos promociones. El cierre del
   * sorteo no desaparece: queda ESCRITO debajo, con fecha, hora y zona.
   */
  const heroBonus = countdownTarget === "ends_at" ? activeBonus : null;
  const heroBonusEnd =
    heroBonus === null
      ? null
      : formatZonedDeadline(heroBonus.ends_at, locale, promotion.legal_timezone);

  return (
    <>
      <section
        aria-labelledby="promotion-title"
        className="lsw-atmosphere lsw-grain relative isolate overflow-hidden"
      >
        {primarySlide === null ? (
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
              // DEC-068: un CUADRADO a todo el ancho (y 4:3 en tableta). La
              // franja de 46svh de antes dejaba el vehiculo pequeno y medio
              // tapado por el titular; ahora se ve entero, como en la
              // referencia, y el titular entra solo sobre el pie fundido.
              // DEC-071: 4:3 tambien en telefono. El cuadrado recortaba la
              // camioneta por los lados y empujaba el marcador fuera de la
              // pantalla; en 4:3 se ve el vehiculo entero y, al bajar un poco,
              // del titular al marcador cabe en una sola pantalla.
              "relative aspect-[4/3] max-h-[70svh] w-full",
              // En escritorio: capa pegada al borde derecho, a sangre, con el
              // alto de la PRIMERA PANTALLA y no el de la seccion. DEC-069 metio
              // el marcador en el hero y la seccion crecio por debajo de la
              // ventana: estirada a esa altura, `cover` recortaba la camioneta
              // por los lados. El pie de la foto se funde con el degradado de
              // abajo y el marcador queda sobre el fondo de la seccion.
              "lg:pointer-events-none lg:absolute lg:right-0 lg:top-0 lg:aspect-auto lg:h-[calc(100svh-5rem)] lg:max-h-[52rem] lg:w-[60%]",
              // DEC-068: el borde izquierdo se DESVANECE en vez de fundirse a
              // negro liso. El fondo de la seccion lleva textura, y un fundido
              // a color plano dejaba una costura vertical donde empieza la foto.
              // DEC-074: el pie tambien, en telefono y en escritorio; ver
              // `.lsw-hero-photo-fade`.
              "lsw-hero-photo-fade",
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
            {slides.length > 1 ? (
              /* DEC-066: varias fotos, carrusel. Mismo hueco, mismos tamanos
                 y mismo encuadre que la foto unica de abajo. */
              <HeroCarousel
                slides={slides}
                sizes={HERO_IMAGE_SIZES}
                imageClassName={HERO_IMAGE_POSITION}
              />
            ) : (
              <Image
                src={primarySlide.src}
                alt={primarySlide.alt}
                fill
                priority
                sizes={HERO_IMAGE_SIZES}
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
                className={`object-cover ${HERO_IMAGE_POSITION}`}
              />
            )}

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
                entrar en cuadro.

                DEC-068: el fundido se ACORTA. Antes cubria el 70% de la foto en
                telefono y el vehiculo quedaba en sombra; ahora solo funde el
                pie (donde entra el titular, que ademas lleva su propia sombra)
                y en escritorio el borde izquierdo.

                DEC-073: los dos degradados dejan pasar el toque. Estan encima
                de las fotos, y si se quedaran el gesto, el carrusel no se
                podria deslizar con el dedo. */}
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/60 via-15% to-bg/0 to-40%",
                "lg:bg-gradient-to-r lg:via-bg/75 lg:via-[18%] lg:to-[38%]",
              )}
            />

            {/* Pie: una segunda pasada, corta y solo hacia arriba. Sin ella la
                fotografia termina en un corte recto de asfalto claro contra el
                negro de la banda siguiente, y se ve como una lamina pegada
                encima de la pagina en vez de como parte de ella. En telefono es
                tambien lo que sostiene el titular. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-bg to-bg/0"
            />
          </div>
        )}

        <div className="lsw-container relative flex flex-col justify-center pb-s12 lg:min-h-[calc(100svh-5rem)] lg:py-s16">
          <div
            className={cn(
              "flex flex-col",
              // El bloque sube sobre la mitad inferior de la fotografia, que ya
              // esta fundida en negro por el degradado. En escritorio no hay
              // nada que solapar: la imagen esta al lado, no encima.
              // DEC-068: solapa solo el pie fundido de la foto (3rem), no un
              // tercio de ella como antes.
              primarySlide === null ? "pt-s16" : "-mt-s12 pt-0 lg:mt-0",
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
              // DEC-075: el hero entra escalonado al cargar (`enter`).
              <div className="lsw-enter flex flex-wrap items-center gap-3" style={enter(0)}>
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

                {/* Aqui iba el antetitulo "Promocion vigente" (DEC-042). Se
                    retira con DEC-077: repetia el chip de al lado. */}
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
            {/* DEC-068: titular de impacto en CROMO -Saira negra en italica con
                relleno metalico y sombra-, el tratamiento de las referencias.
                El tamano se ajusta al ancho para que dos o tres palabras llenen
                la linea en telefono sin desbordar. */}
            <h1 id="promotion-title" className="mt-s4 flex flex-col gap-s1 sm:mt-s5">
              {/* DEC-075: el titular entra desde la izquierda con una
                  inclinacion de carreras que se endereza al llegar. */}
              {prizeName === null ? (
                <span
                  className={cn("lsw-headline lsw-chrome lsw-enter-left", headlineSize(title))}
                  style={enter(80)}
                >
                  {title}
                </span>
              ) : (
                <>
                  {/* El verbo cae con el estado contenido (DEC-044): "GANA"
                      encabezando un premio es la invitacion misma. El premio y
                      el titulo se quedan, que es lo que DEC-044 deja ver. */}
                  {!showsPromotionalHero ? null : (
                    <span
                      className="lsw-headline lsw-accent-sheen lsw-enter-left text-[clamp(1.75rem,7vw,3rem)]"
                      style={enter(60)}
                    >
                      {t("hero.win")}
                    </span>
                  )}
                  <span
                    className={cn(
                      "lsw-headline lsw-chrome lsw-enter-left",
                      headlineSize(prizeName),
                    )}
                    style={enter(140)}
                  >
                    {prizeName}
                  </span>
                  <span
                    className="lsw-enter mt-s2 font-headline text-heading-sm font-bold italic uppercase text-text-muted"
                    style={enter(220)}
                  >
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

            {/* Aqui iban las TASAS. DEC-071 las dejo solo en escritorio y
                DEC-077 las retira: la banda dorada de la portada, justo debajo
                de los paquetes, dice las mismas dos cifras en grande. */}

            {/* El lema, en la italica gruesa de la referencia ("+ A $40,000
                CHECK"). Es texto del panel; aqui solo se le da voz. */}
            <p
              className="lsw-enter mt-s3 max-w-narrow font-headline text-body-md font-bold italic leading-snug text-text sm:mt-s4 sm:text-heading-md"
              style={enter(200)}
            >
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
              <div className="mt-s6 flex flex-col items-stretch gap-s4 sm:items-start">
                {/* DEC-068: el mismo aviso, en el mismo sitio, como nota y no
                    como bloque de alerta: era lo que mas pesaba en la pantalla
                    y no es un error, es un estado. Sigue siendo texto visible y
                    va antes de la accion. */}
                <HeroNote>{t("rulesNotPublished")}</HeroNote>

                <Link
                  href="/shop"
                  className={cn(
                    buttonVariants({ variant: "subtle", size: "xl" }),
                    "w-full sm:w-auto",
                  )}
                >
                  {t("hero.browseShop")}
                </Link>
              </div>
            ) : (
              <div
                className="lsw-enter mt-s5 flex flex-col gap-s2 sm:mt-s8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
                style={enter(280)}
              >
                <HeroLink
                  href={presentation.showsShopCta ? buyLink : `/promotions/${promotion.slug}`}
                  // DEC-086: el cliente pidio `CompleteRegistration` al pulsar
                  // "Comprar ahora", como conversion de sus anuncios.
                  {...(presentation.showsShopCta ? { metaEvent: "CompleteRegistration" } : {})}
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
                </HeroLink>

                {presentation.showsShopCta ? (
                  <Link
                    href={`/promotions/${promotion.slug}`}
                    // DEC-071: mas bajo en telefono -es la accion secundaria-,
                    // con el tamano del rojo desde tableta. DEC-074: relleno
                    // lateral 24px y no 32: con el rojo a 22px, los dos botones
                    // siguen cabiendo en una fila en una pantalla de 1366.
                    className={cn(
                      buttonVariants({ variant: "subtle", size: "lg" }),
                      "w-full sm:h-control-xl sm:w-auto sm:px-6 sm:text-body-lg",
                    )}
                  >
                    {t("viewPromotion")}
                  </Link>
                ) : null}
              </div>
            )}

            {/*
             * EL MARCADOR, DENTRO DEL HERO Y BAJO LOS BOTONES (DEC-069).
             *
             * Antes iba en una banda propia debajo del hero, junto a las fechas
             * de apertura y cierre en una lista. En las referencias del cliente
             * la cuenta atras acompana al boton, y la lista de fechas era una
             * pantalla entera de telefono entre el premio y los paquetes. Sigue
             * siendo parte de la invitacion: con el estado contenido no hay
             * marcador (DEC-044).
             */}
            {countdownTarget === null ? null : heroBonus !== null ? (
              <div className="lsw-enter mt-s6 sm:mt-s8" style={enter(360)}>
                <PromotionCountdown
                  targetIso={heroBonus.ends_at}
                  nowIso={nowIso}
                  locale={locale}
                  timeZone={promotion.legal_timezone}
                  variant="closes"
                  size="scoreboard"
                  heading={t("hero.bonusClosesIn", {
                    multiplier: fractionText(heroBonus.multiplier, locale),
                    scope: bonusScopeLabel(heroBonus.product_kind_scope),
                  })}
                  deadlinePrefix={tA11y("bonusCountdown")}
                  // La barra mide el tramo DEL BONUS, no el de la promocion.
                  period={{ startIso: heroBonus.starts_at, endIso: heroBonus.ends_at }}
                  withClockNote={false}
                />
              </div>
            ) : (
              <div className="lsw-enter mt-s6 sm:mt-s8" style={enter(360)}>
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
                  withClockNote={false}
                />
              </div>
            )}

            {/* El plazo ESCRITO, en una linea: la misma informacion que el
                marcador con fecha, hora y zona legal (DEC-011), para quien
                quiere apuntarla. Se queda tambien en el estado contenido, sin
                marcador: es fecha, no urgencia (DEC-044). */}
            {heroBonus === null || heroBonusEnd === null ? null : (
              <p className="mt-s3 text-body-sm font-medium text-text">
                <time dateTime={heroBonus.ends_at}>
                  {t("hero.bonusEndsOn", {
                    multiplier: fractionText(heroBonus.multiplier, locale),
                    date: heroBonusEnd,
                  })}
                </time>
              </p>
            )}

            {deadline === null ? null : (
              <p
                className={cn(
                  "text-body-sm font-medium text-text-muted",
                  countdownTarget === null ? "mt-s5" : heroBonus === null ? "mt-s3" : "mt-s1",
                )}
              >
                <time dateTime={deadline.iso}>
                  {deadline.kind === "opens"
                    ? t("hero.opensOn", { date: deadline.text })
                    : heroBonus === null
                      ? t("hero.closesOn", { date: deadline.text })
                      : t("hero.drawClosesOn", { date: deadline.text })}
                </time>
              </p>
            )}

            {/*
             * EL ESTADO, SOLO CUANDO LAS COMPRAS NO CUENTAN (DEC-069).
             *
             * Abierta, el chip "Abierta" y el "CIERRA EN" ya lo dicen, y el
             * recuadro de "esta promocion esta abierta" solo empujaba los
             * paquetes hacia abajo. En cualquier otro estado -antes de abrir,
             * cerrada, en sorteo, cancelada- una compra NO suma
             * participaciones, y eso hay que decirlo donde se decide comprar.
             */}
            {presentation.acceptsEntries ? null : (
              <HeroNote title={stateNotice.title} className="mt-s4">
                {stateNotice.body}
              </HeroNote>
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
             * llevaria a un 404; la nota de mas arriba lo explica.
             *
             * DEC-069 puso debajo el descargo de participaciones; DEC-077 lo
             * retira: decia lo mismo que "Sujeto a las Reglas Oficiales".
             */}
            <p className="mt-s5 max-w-narrow text-center text-caption italic text-text-subtle sm:text-left">
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
             * Desde DEC-082 la banda roja de arriba tambien lo anuncia, en una
             * linea y con su cuenta atras, en todas las paginas. Este es el
             * anuncio COMPLETO: el plazo escrito con su zona legal y los
             * periodos anunciados que vienen despues, que en la banda no caben.
             *
             * Y va DESPUES de la linea legal a proposito: lo ultimo que se lee
             * antes del anuncio es que manda el documento.
             */}
            <div className="mt-s6 max-w-narrow">
              <BonusAnnouncement
                // Con el bonus ya en el marcador grande, el recuadro no repite
                // su cuenta atras (DEC-084); sigue anunciando los que vienen.
                activeBonus={heroBonus === null ? activeBonus : null}
                upcomingBonuses={upcomingBonuses}
                locale={locale}
                timeZone={promotion.legal_timezone}
                nowIso={nowIso}
              />
            </div>
          </div>
        </div>
      </section>

      {/* DEC-069: aqui iban la banda del marcador -con la lista "Abre / Cierra"
          y la nota de zona horaria- y la banda de avisos. El marcador y el
          plazo escrito suben al hero; el estado se dice alli solo cuando una
          compra no cuenta; el descargo de participaciones pasa a la letra
          pequena. La cifra de participaciones EMITIDAS ya se habia retirado
          con DEC-044 y sigue sin existir. */}
    </>
  );
}

/**
 * Enlace del hero: a otra pagina por el `Link` localizado, o a una seccion de
 * la MISMA pagina (`#packages`) con un `<a>` normal. El `Link` de next-intl
 * antepone el idioma a la ruta y convertiria el ancla en una navegacion.
 */
function HeroLink({
  href,
  className,
  metaEvent,
  children,
}: {
  readonly href: string;
  readonly className: string;
  /** DEC-086: evento del pixel de Meta al pulsarlo (lo envia `MetaPixel`). */
  readonly metaEvent?: string;
  readonly children: ReactNode;
}) {
  const eventAttribute = metaEvent === undefined ? {} : { "data-meta-event": metaEvent };
  return href.startsWith("#") ? (
    <a href={href} className={className} {...eventAttribute}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} {...eventAttribute}>
      {children}
    </Link>
  );
}

/**
 * Nota del hero (DEC-068, DEC-069): un aviso de ESTADO, no de error. Texto
 * visible, con un icono decorativo y un titulo opcional.
 */
function HeroNote({
  title,
  className,
  children,
}: {
  readonly title?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex max-w-narrow items-start gap-s2 rounded-md border border-brand/30 bg-brand/[0.07] px-s3 py-s2 text-body-sm text-text-muted",
        className,
      )}
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        focusable="false"
        className="mt-[2px] h-4 w-4 shrink-0 text-brand"
      >
        <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <p>
        {title === undefined ? null : (
          <strong className="block font-semibold text-text">{title}</strong>
        )}
        {children}
      </p>
    </div>
  );
}
