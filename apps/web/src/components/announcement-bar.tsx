import { cn } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatInteger, formatZonedDate } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { usePromotionStatusLabel } from "@/i18n/promotion-labels";
import {
  fetchActivePromotion,
  fetchPromotion,
  type EntryPool,
  type PromotionSummary,
} from "@/lib/api";
import { presentPromotion } from "@/lib/promotion-state";

/**
 * Banda de anuncio, por encima de la cabecera.
 *
 * QUE DICE Y QUE NO DICE
 * ----------------------
 * Dice EL ESTADO de la promocion vigente y su plazo, tal como los reporta el
 * backend. Nada mas.
 *
 * La referencia visual pone aqui su reclamo comercial -"ultima semana",
 * "multiplicador activo"-, y eso es exactamente lo que este producto no puede
 * escribir: seria urgencia fabricada sobre una cifra de participaciones fuera
 * del carrito, que es doble infraccion (CLAUDE.md seccion 1 y DEC-023). Se toma
 * la PIEZA -banda fina, caja alta, flechas a los lados, frases que rotan- y se
 * llena con el unico contenido que aqui es verdad: en que fase esta la
 * promocion, cuando abre o cierra, y que el documento que gobierna son las
 * Reglas Oficiales.
 *
 * SI NO HAY NADA QUE ANUNCIAR, NO HAY BANDA
 * -----------------------------------------
 * Sin promocion vigente -o si la llamada falla- el componente no renderiza
 * nada. Una banda vacia, o una que anunciara las Reglas Oficiales de una
 * promocion que no existe, seria peor que su ausencia. Es la misma direccion
 * segura de fallo que gobierna los feature flags.
 *
 * EL UNIVERSO DE PARTICIPACIONES SI ENTRA (DEC-042)
 * -------------------------------------------------
 * Y no contradice lo anterior. El tope de participaciones de una promocion es
 * CONFIGURACION suya -la fija la version de reglas- y llega como dato, igual
 * que el estado y el plazo. Lo que sigue sin poder escribirse aqui es cuantas
 * quedan, cuanto falta o por que habria que darse prisa: la barra dice cuantas
 * declara el universo y nada mas, sin exclamacion y sin comparar.
 *
 * Eso obliga a una segunda peticion -el universo esta en el DETALLE, no en el
 * resumen- y esa peticion es OPCIONAL: si falla, la frase se compone sin el
 * dato. Es el mismo viaje de mas que hace la portada, y esta pedido a `backend`
 * junto con ella: o el universo entra en `PromotionSummary`, o hay una ruta que
 * lo publique.
 *
 * DOS PIEZAS Y NO UNA
 * -------------------
 * Este componente asincrono solo PIDE los datos; quien decide que frases se
 * escriben es `AnnouncementBand`, que es sincrono y recibe la promocion por
 * props. La division es la misma que ya tenia `PromotionHero`, y por el mismo
 * motivo: la decision de que se anuncia sobre una promocion dada se puede
 * probar entonces con un fixture, sin simular el servidor de Next ni la capa de
 * red.
 */
export async function AnnouncementBar({ locale }: { readonly locale: Locale }) {
  const result = await fetchActivePromotion(locale);
  if (!result.ok || result.data === null) return null;

  const promotion = result.data;

  /*
   * SIN REGLAS PUBLICADAS NO SE PIDE EL DETALLE (DEC-044).
   *
   * No es solo un viaje que se ahorra: es que el unico dato que ese viaje trae
   * -el universo de participaciones- es precisamente el que la banda no puede
   * escribir cuando la promocion no tiene documento que la gobierne. La
   * condicion se vuelve a evaluar dentro de `AnnouncementBand`, que es donde
   * manda; aqui pasar `null` deja el fallo del lado seguro aunque aquella
   * cambiara.
   */
  const entryPool =
    promotion.rules_version_id === null ? null : await fetchEntryPool(promotion, locale);

  return <AnnouncementBand promotion={promotion} entryPool={entryPool} locale={locale} />;
}

/**
 * Universo de participaciones, si la promocion declara uno.
 *
 * La peticion del detalle es de mejor esfuerzo: un fallo aqui deja la barra
 * exactamente como estaba antes de DEC-042, no la tumba. La misma direccion
 * segura de fallo que gobierna los feature flags.
 */
async function fetchEntryPool(
  promotion: PromotionSummary,
  locale: Locale,
): Promise<EntryPool | null> {
  const detailResult = await fetchPromotion(promotion.slug, locale);
  if (!detailResult.ok) return null;

  /*
   * `?? null` Y NO `!== null`.
   *
   * `entry_pool` es un campo `[PROVISIONAL]`: esta pedido a `backend` y hoy no
   * lo publica `docs/API_CONTRACT.md`. El tipo dice `EntryPool | null`, pero un
   * backend que todavia no lo conozca no manda `null`: no manda NADA, y en
   * tiempo de ejecucion eso es `undefined`, que pasa limpiamente por una
   * comprobacion contra `null` y revienta en el acceso siguiente. Lo medimos:
   * la barra devolvia un 500 en todas las paginas del sitio contra una API que
   * servia la forma anterior. Mientras un campo sea provisional se lee asi.
   */
  return detailResult.data.entry_pool ?? null;
}

/**
 * Las frases de la banda, ya decidido que hay promocion vigente.
 *
 * SIN REGLAS OFICIALES PUBLICADAS, LA BANDA NO ANUNCIA LA PROMOCION (DEC-044)
 * ---------------------------------------------------------------------------
 * El hero de la portada ya se contiene cuando `rules_version_id` es `null`:
 * retira el verbo, el chip de estado, la cuenta atras, el universo y el boton
 * rojo. Esta banda vive por ENCIMA de ese hero y en todas las paginas del
 * sitio, asi que decir aqui "Abierta - cierra el 30 dic 2026 - universo de
 * 10,000 participaciones" contradecia al hero en la misma pantalla, y lo
 * repetia en la tienda, en el carrito y en las preguntas frecuentes, que es
 * donde nadie lo iba a corregir.
 *
 * La banda NO desaparece, y esa es la diferencia con "no hay promocion
 * vigente". Ahi no habia nada que anunciar; aqui hay algo, y es justamente lo
 * que falta. Enmudecer la banda dejaria el sitio sin ninguna senal de por que
 * el hero se ha quedado corto. Lo que se publica es una sola frase -que las
 * Reglas Oficiales estan pendientes de publicacion- sin estado, sin plazo, sin
 * universo y sin rotacion.
 *
 * La senal es `rules_version_id`, por el mismo motivo que en el hero: ES el
 * identificador de la version ACTIVE de las reglas, y el contrato lo declara
 * `null` mientras no haya ninguna (DEC-012). Comprobar ademas que el documento
 * se sirve exigiria una peticion mas por render cuyo fallo transitorio haria
 * afirmar que las reglas no estan publicadas cuando si lo estan.
 *
 * ROTACION SIN JAVASCRIPT
 * -----------------------
 * Las frases se apilan en la misma celda y alternan por opacidad con una
 * animacion CSS (`.lsw-announce-item` en `globals.css`). Sin JavaScript se ve
 * igual; con `prefers-reduced-motion` no rota y se queda la primera, que es la
 * informativa. Ninguna es un enlace: una diana que aparece y desaparece sola es
 * una trampa para el puntero y para el teclado.
 *
 * Con UNA sola frase no se usa esa clase, y no es un detalle de estilo: la
 * animacion arranca en `opacity: 0` y solo es legible porque hay una segunda
 * frase cubriendo el hueco. Una unica frase con `.lsw-announce-item` estaria
 * invisible la mitad del tiempo.
 */
export function AnnouncementBand({
  promotion,
  entryPool,
  locale,
}: {
  readonly promotion: PromotionSummary;
  readonly entryPool: EntryPool | null;
  readonly locale: Locale;
}) {
  const t = useTranslations();
  const statusLabelFor = usePromotionStatusLabel();

  const hasRules = promotion.rules_version_id !== null;
  const presentation = presentPromotion(promotion.status);

  /*
   * El plazo que se anuncia es el MISMO al que apunta la cuenta atras, y por la
   * misma razon: antes de abrir interesa la apertura, mientras esta abierta
   * interesa el cierre, y en las fases posteriores no interesa ninguna fecha
   * porque el proceso ya no depende de un plazo. La decision la toma la maquina
   * de estados, no esta banda.
   */
  const deadlineIso =
    presentation.countdownTarget === "starts_at"
      ? promotion.starts_at
      : presentation.countdownTarget === "ends_at"
        ? promotion.ends_at
        : null;

  const deadline =
    deadlineIso === null
      ? null
      : // Fecha en formato medio: la banda es UNA linea en caja alta y con
        // tracking, y "30 de diciembre de 2026" no cabe en 360px sin recortarse
        // con puntos suspensivos. Se acorta el mes, nunca el ano. El plazo
        // completo -con hora y zona legal- sigue estando en el hero y en el
        // detalle de la promocion, que es donde se va a apuntar.
        formatZonedDate(deadlineIso, locale, {
          timeZone: promotion.legal_timezone,
          dateStyle: "medium",
        });

  const entryPoolCap = entryPool === null ? null : formatInteger(entryPool.cap, locale);

  const when =
    deadline === null
      ? null
      : presentation.countdownTarget === "starts_at"
        ? t("announcement.opensOn", { date: deadline })
        : t("announcement.closesOn", { date: deadline });

  const statusLabel = statusLabelFor(promotion.status);

  const statusPhrase =
    when === null
      ? entryPoolCap === null
        ? statusLabel
        : t("announcement.withPool", { status: statusLabel, entries: entryPoolCap })
      : entryPoolCap === null
        ? t("announcement.withDeadline", { status: statusLabel, when })
        : t("announcement.withDeadlineAndPool", {
            status: statusLabel,
            when,
            entries: entryPoolCap,
          });

  const phrases: readonly string[] = hasRules
    ? [statusPhrase, t("announcement.officialRules")]
    : [t("announcement.rulesPending")];

  const rotates = phrases.length > 1;

  return (
    <div
      // `role="region"` con nombre: es contenido de sitio, no un aviso urgente,
      // y por eso NO es `role="status"` ni una region viva. Anunciar por voz una
      // frase que cambia sola cada siete segundos haria la pagina inutilizable.
      role="region"
      aria-label={t("a11y.announcements")}
      className={cn(
        // ROJA (DEC-042). Es la franja de la referencia, y el unico sitio del
        // sitio donde el rojo hace de fondo a todo lo ancho. El texto va en
        // `on-accent` -blanco puro- y mide 5,49:1 sobre el relleno.
        //
        // El patron topografico va en su tinta NEGRA: el dorado, calibrado para
        // superficies casi negras, sobre este rojo no se ve.
        "lsw-topo-ink border-b border-accent-active bg-accent text-on-accent",
        // La banda no se hace pegajosa: la cabecera si lo es, y dos elementos
        // fijos apilados se comen un tercio de la pantalla de un telefono.
        "relative z-base",
      )}
    >
      <div className="lsw-container flex items-center justify-center gap-3 py-2">
        <Chevron direction="left" />

        {/* Rejilla de UNA celda: las frases se superponen, de modo que la barra
            tiene la altura de la mas alta y no da saltos al alternar. Por eso el
            texto puede envolver sin provocar reflujo: con el universo dentro, la
            frase de estado ya no cabe en una linea a 360px, y truncarla dejaria
            fuera justo el dato nuevo. */}
        <p className="grid min-w-0 flex-1 justify-items-center text-center">
          {phrases.map((phrase) => (
            <span key={phrase} className={rotates ? ROTATING_PHRASE : STATIC_PHRASE}>
              {phrase}
            </span>
          ))}
        </p>

        <Chevron direction="right" />
      </div>
    </div>
  );
}

const PHRASE = cn("lsw-display text-balance text-overline");

/**
 * La opacidad de partida y la rotacion las gobierna `.lsw-announce-item` en
 * `globals.css`, no una utilidad de Tailwind: las utilidades se emiten en una
 * capa posterior y ganarian a la regla de `prefers-reduced-motion`, dejando las
 * dos frases invisibles para quien pidio que nada se moviera.
 */
const ROTATING_PHRASE = cn("lsw-announce-item", PHRASE);

/** Una sola frase no rota, y por tanto no puede empezar en `opacity: 0`. */
const STATIC_PHRASE = PHRASE;

/**
 * Flecha decorativa de los extremos.
 *
 * No es un boton: no hay nada que pulsar, porque la rotacion es automatica y
 * las frases se leen enteras sin intervencion. Pintarla como control seria
 * ofrecer una diana que no hace nada, que es peor que no ofrecerla.
 */
function Chevron({ direction }: { readonly direction: "left" | "right" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // Sobre el rojo de la banda, el galon es del mismo blanco que el texto
        // rebajado: un oro aqui seria un tercer color en una franja de 28px.
        "shrink-0 select-none font-display text-body-sm leading-none text-on-accent/70",
        direction === "left" ? "order-first" : "order-last",
      )}
    >
      {direction === "left" ? "‹" : "›"}
    </span>
  );
}
