import { cn } from "@lsw/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { formatEntryCount, formatZonedDate, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { usePromotionStatusLabel } from "@/i18n/promotion-labels";
import {
  fetchActivePromotion,
  fetchPromotion,
  type BonusPeriod,
  type PromotionSummary,
} from "@/lib/api";
import { normalizeEntryOffer, type NormalizedEntryOffer } from "@/lib/entry-offer";
import { isFeatureEnabled } from "@/lib/flags";
import { loadFeatureFlags } from "@/lib/flags-server";
import { presentPromotion } from "@/lib/promotion-state";

import { AnnouncementCountdown } from "./announcement-countdown";
import { fractionText, useBonusScopeLabel } from "./entry-rate-lines";

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
 * EL PERIODO BONUS SI ENTRA, CON SU CUENTA ATRAS (DEC-082)
 * -------------------------------------------------------
 * Lo pidio el usuario, y no contradice lo anterior: un periodo bonus no es un
 * reclamo inventado, es CONFIGURACION que las Reglas Oficiales prevén ("el
 * Patrocinador puede anunciar periodos limitados de bonificacion") y que el
 * backend publica con su multiplicador, su ambito y sus dos instantes. Lo que
 * sigue sin escribirse es cuantas participaciones da nada ni ningun adjetivo de
 * prisa: el plazo lo dice la cuenta atras, que cuenta hacia un instante real.
 *
 * SI NO HAY NADA QUE ANUNCIAR, NO HAY BANDA
 * -----------------------------------------
 * Sin promocion vigente -o si la llamada falla- el componente no renderiza
 * nada. Una banda vacia, o una que anunciara las Reglas Oficiales de una
 * promocion que no existe, seria peor que su ausencia. Es la misma direccion
 * segura de fallo que gobierna los feature flags.
 *
 * EL TOPE POR PERSONA SI ENTRA (DEC-042, rehecho por DEC-052)
 * -----------------------------------------------------------
 * Y no contradice lo anterior. El tope de participaciones POR PARTICIPANTE es
 * CONFIGURACION de la promocion -la fija la version de reglas- y llega como
 * dato, igual que el estado y el plazo. Lo que sigue sin poder escribirse aqui
 * es cuantas quedan, cuanto falta o por que habria que darse prisa: la barra
 * dice cuantas puede tener una persona y nada mas, sin exclamacion y sin
 * comparar.
 *
 * ANTES DECIA "UNIVERSO DE 10,000" Y ERA OTRA COSA. El segundo borrador de las
 * Official Rules aclaro que ese numero nunca fue un total: es el maximo por
 * persona, "por cualquier metodo o combinacion de metodos". `entry_pool` se
 * retiro del contrato (DEC-052 punto 6) y con el la unica cifra de esta barra
 * que invitaba a una resta.
 *
 * Eso obliga a una segunda peticion -la oferta esta en el DETALLE, no en el
 * resumen- y esa peticion es OPCIONAL: si falla, la frase se compone sin el
 * dato. Es el mismo viaje de mas que hace la portada, y esta pedido a `backend`
 * junto con ella: o la oferta entra en `PromotionSummary`, o hay una ruta que
 * la publique.
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
  // En paralelo: ninguna lectura depende de la otra. Los flags caen en su valor
  // seguro (apagado) si la configuracion no se puede leer.
  const [result, flags] = await Promise.all([
    fetchActivePromotion(locale),
    loadFeatureFlags(locale),
  ]);
  if (!result.ok || result.data === null) return null;

  const promotion = result.data;

  // Un solo instante para todo el render: separa bonus vigentes de anunciados y
  // es el primer valor de la cuenta atras, igual en servidor y en cliente.
  const nowIso = new Date().toISOString();

  /*
   * SIN REGLAS PUBLICADAS NO SE PIDE EL DETALLE (DEC-044).
   *
   * No es solo un viaje que se ahorra: es que los datos que ese viaje trae -el
   * tope por persona y los periodos bonus- son precisamente los que la banda no
   * puede escribir cuando la promocion no tiene documento que la gobierne. La
   * condicion se vuelve a evaluar dentro de `AnnouncementBand`, que es donde
   * manda; aqui pasar `null` deja el fallo del lado seguro aunque aquella
   * cambiara.
   */
  const offer =
    promotion.rules_version_id === null ? null : await fetchOffer(promotion, locale, nowIso);

  return (
    <AnnouncementBand
      promotion={promotion}
      perParticipantMax={offer?.perParticipantMax ?? null}
      bonus={bandBonusFor({
        promotion,
        offer,
        multipliersFlag: isFeatureEnabled(flags, "entry_multipliers_enabled"),
      })}
      nowIso={nowIso}
      locale={locale}
    />
  );
}

/**
 * El periodo bonus que la banda anuncia, si hay alguno (DEC-082).
 *
 * LOS MISMOS CERROJOS QUE EL HERO
 * -------------------------------
 * Reglas publicadas, el flag del sitio (`entry_multipliers_enabled`), el de la
 * propia oferta y una fase que admita participaciones. Si cualquiera falla, no
 * hay anuncio: un "2X" que el motor no aplica seria una promesa falsa en la
 * franja que se ve en TODAS las paginas, y la que mas se cree.
 *
 * VIGENTE ANTES QUE ANUNCIADO
 * ---------------------------
 * El vigente llega resuelto por el backend (`active_bonus`, ya con la
 * estrategia de conflicto aplicada). Si no hay ninguno, se anuncia el proximo
 * que empieza, porque las Reglas piden anunciar los periodos ANTES de que
 * empiecen. Solo uno: la banda es una linea.
 */
export type BandBonus =
  | { readonly kind: "ACTIVE"; readonly period: BonusPeriod }
  | { readonly kind: "UPCOMING"; readonly period: BonusPeriod };

export function bandBonusFor({
  promotion,
  offer,
  multipliersFlag,
}: {
  readonly promotion: PromotionSummary;
  readonly offer: NormalizedEntryOffer | null;
  readonly multipliersFlag: boolean;
}): BandBonus | null {
  if (promotion.rules_version_id === null) return null;
  if (!multipliersFlag || offer?.multipliersEnabled !== true) return null;
  if (!presentPromotion(promotion.status).acceptsEntries) return null;

  if (offer.activeBonus !== null) return { kind: "ACTIVE", period: offer.activeBonus };

  const next = [...offer.upcomingBonuses].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
  )[0];

  return next === undefined ? null : { kind: "UPCOMING", period: next };
}

/**
 * La oferta de participaciones de la promocion: el tope por persona y los
 * periodos bonus.
 *
 * La peticion del detalle es de mejor esfuerzo: un fallo aqui deja la barra
 * exactamente como estaba antes de DEC-042, no la tumba. La misma direccion
 * segura de fallo que gobierna los feature flags.
 */
async function fetchOffer(
  promotion: PromotionSummary,
  locale: Locale,
  nowIso: string,
): Promise<NormalizedEntryOffer | null> {
  const detailResult = await fetchPromotion(promotion.slug, locale);
  if (!detailResult.ok) return null;

  /*
   * SE LEE POR `normalizeEntryOffer`, Y NO A MANO.
   *
   * `entry_offer` y la mitad de sus claves son campos de §13 que la API real
   * todavia no publica (HO-041). El tipo dice `EntryOffer | null`, pero un
   * backend que no los conozca no manda `null`: no manda NADA, y en tiempo de
   * ejecucion eso es `undefined`, que pasa limpiamente por una comprobacion
   * contra `null` y revienta en el acceso siguiente. Lo medimos con la forma
   * anterior: la barra devolvia un 500 en TODAS las paginas del sitio.
   *
   * `normalizeEntryOffer` resuelve esa diferencia en un solo sitio, y ademas es
   * quien aplica `caps_enabled`: con los topes apagados devuelve `null`, porque
   * un tope declarado que el motor no aplica no se puede anunciar.
   *
   * El instante es el del render: separa los bonus vigentes de los anunciados.
   */
  return normalizeEntryOffer(detailResult.data.entry_offer, nowIso);
}

/**
 * Las frases de la banda, ya decidido que hay promocion vigente.
 *
 * SIN REGLAS OFICIALES PUBLICADAS, LA BANDA NO ANUNCIA LA PROMOCION (DEC-044)
 * ---------------------------------------------------------------------------
 * El hero de la portada ya se contiene cuando `rules_version_id` es `null`:
 * retira el verbo, el chip de estado, la cuenta atras, las tasas, el tope y el
 * boton rojo. Esta banda vive por ENCIMA de ese hero y en todas las paginas del
 * sitio, asi que decir aqui "Abierta - cierra el 30 dic 2026 - maximo 10,000
 * participaciones por persona" contradecia al hero en la misma pantalla, y lo
 * repetia en la tienda, en el carrito y en las preguntas frecuentes, que es
 * donde nadie lo iba a corregir.
 *
 * La banda NO desaparece, y esa es la diferencia con "no hay promocion
 * vigente". Ahi no habia nada que anunciar; aqui hay algo, y es justamente lo
 * que falta. Enmudecer la banda dejaria el sitio sin ninguna senal de por que
 * el hero se ha quedado corto. Lo que se publica es una sola frase -que las
 * Reglas Oficiales estan pendientes de publicacion- sin estado, sin plazo, sin
 * tope y sin rotacion.
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
  perParticipantMax,
  bonus,
  nowIso,
  locale,
}: {
  readonly promotion: PromotionSummary;
  /**
   * Tope de participaciones POR PERSONA, ya resuelto contra `caps_enabled`.
   *
   * `null` significa que no hay tope que anunciar -no lo declara, o los topes
   * estan apagados-. La banda NO lo deduce: llega decidido desde arriba, que es
   * donde se leyo la oferta.
   */
  readonly perParticipantMax: number | null;
  /**
   * Periodo bonus que anunciar, ya decidido por `bandBonusFor` (DEC-082).
   * Ausente o `null`: la banda dice lo de siempre.
   */
  readonly bonus?: BandBonus | null;
  /** Instante del render, generado en servidor: primer valor de la cuenta atras. */
  readonly nowIso?: string;
  readonly locale: Locale;
}) {
  const t = useTranslations();
  const statusLabelFor = usePromotionStatusLabel();
  const scopeLabel = useBonusScopeLabel();

  const hasRules = promotion.rules_version_id !== null;
  const presentation = presentPromotion(promotion.status);

  /*
   * CON UN BONUS QUE ANUNCIAR, LA BANDA DICE ESO Y NADA MAS (DEC-082).
   *
   * Una sola frase, SIN rotacion: la cuenta atras es lo que se viene a ver, y
   * rotando estaria oculta la mitad del tiempo. El estado y el cierre de la
   * promocion siguen en el hero y en su pagina, con su propia cuenta atras.
   *
   * `hasRules` se vuelve a comprobar aqui aunque `bandBonusFor` ya lo haga: esta
   * banda es la que manda sobre lo que se escribe sin Reglas (DEC-044), y no
   * debe depender de que quien la llama haya filtrado bien.
   */
  if (bonus !== undefined && bonus !== null && hasRules && nowIso !== undefined) {
    return (
      <BandShell label={t("a11y.announcements")}>
        <BonusPhrase
          bonus={bonus}
          nowIso={nowIso}
          locale={locale}
          timeZone={promotion.legal_timezone}
          headline={t("announcement.bonus", {
            multiplier: fractionText(bonus.period.multiplier, locale),
            scope: scopeLabel(bonus.period.product_kind_scope),
          })}
        />
      </BandShell>
    );
  }

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

  const cap = perParticipantMax === null ? null : formatEntryCount(perParticipantMax, locale);

  const when =
    deadline === null
      ? null
      : presentation.countdownTarget === "starts_at"
        ? t("announcement.opensOn", { date: deadline })
        : t("announcement.closesOn", { date: deadline });

  const statusLabel = statusLabelFor(promotion.status);

  const statusPhrase =
    when === null
      ? cap === null
        ? statusLabel
        : t("announcement.withCap", { status: statusLabel, entries: cap })
      : cap === null
        ? t("announcement.withDeadline", { status: statusLabel, when })
        : t("announcement.withDeadlineAndCap", {
            status: statusLabel,
            when,
            entries: cap,
          });

  const phrases: readonly string[] = hasRules
    ? [statusPhrase, t("announcement.officialRules")]
    : [t("announcement.rulesPending")];

  const rotates = phrases.length > 1;

  return (
    <BandShell label={t("a11y.announcements")}>
      {/* Rejilla de UNA celda: las frases se superponen, de modo que la barra
          tiene la altura de la mas alta y no da saltos al alternar. Por eso el
          texto puede envolver sin provocar reflujo: con el tope dentro, la
          frase de estado ya no cabe en una linea a 360px, y truncarla dejaria
          fuera justo el dato nuevo. */}
      <p className="grid min-w-0 flex-1 justify-items-center text-center">
        {phrases.map((phrase) => (
          <span key={phrase} className={rotates ? ROTATING_PHRASE : STATIC_PHRASE}>
            {phrase}
          </span>
        ))}
      </p>
    </BandShell>
  );
}

/**
 * La franja roja, con sus galones a los lados. Es la misma para las frases de
 * siempre y para el anuncio de un bonus: cambia lo que dice, no la pieza.
 */
function BandShell({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div
      // `role="region"` con nombre: es contenido de sitio, no un aviso urgente,
      // y por eso NO es `role="status"` ni una region viva. Anunciar por voz una
      // frase que cambia sola cada siete segundos -o una cuenta atras que cambia
      // cada segundo- haria la pagina inutilizable.
      role="region"
      aria-label={label}
      className={cn(
        // ROJA (DEC-042). Es la franja de la referencia, y el unico sitio del
        // sitio donde el rojo hace de fondo a todo lo ancho. El texto va en
        // `on-accent` -blanco puro- y mide 4,99:1 sobre el relleno (DEC-074).
        //
        // El patron topografico va en su tinta NEGRA: el dorado, calibrado para
        // superficies casi negras, sobre este rojo no se ve.
        "lsw-topo-ink border-b border-accent-active bg-accent text-on-accent",
        // Fija junto con la cabecera (DEC-082): la pega el contenedor de
        // `app/[locale]/layout.tsx`, no esta banda.
        "relative z-base",
      )}
    >
      <div className="lsw-container flex items-center justify-center gap-3 py-2">
        <Chevron direction="left" />
        {children}
        <Chevron direction="right" />
      </div>
    </div>
  );
}

/**
 * "BONUS 2× EN MERCANCIA · TERMINA EN 5d 03:12:45" (DEC-082).
 *
 * Tres datos y ninguno inventado: el multiplicador, sobre que aplica y cuanto
 * falta, todo tal como lo publica el backend. Sin exclamacion y sin "ultimas
 * horas": la cuenta atras ya dice el plazo, y decirlo dos veces seria la prisa
 * fabricada que la banda no puede escribir.
 *
 * Para el lector de pantalla, "termina en" y los digitos van ocultos y se
 * anuncia el plazo absoluto: "termina el 13 de octubre de 2026, 7:00 p.m. CDT".
 */
function BonusPhrase({
  bonus,
  nowIso,
  locale,
  timeZone,
  headline,
}: {
  readonly bonus: BandBonus;
  readonly nowIso: string;
  readonly locale: Locale;
  /** Zona legal de la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
  readonly headline: string;
}) {
  const t = useTranslations("announcement");

  const active = bonus.kind === "ACTIVE";
  const targetIso = active ? bonus.period.ends_at : bonus.period.starts_at;
  const absolute =
    formatZonedDateTime(targetIso, locale, { timeZone, showTimeZoneName: true }) ?? targetIso;
  const deadlineLabel = active
    ? t("bonusEndsAt", { until: absolute })
    : t("bonusStartsAt", { from: absolute });

  return (
    <p className={cn(STATIC_PHRASE, "min-w-0 flex-1 text-center")}>
      <span>{headline}</span>
      {/* En telefono la frase no cabe en una linea: se parte A PROPOSITO en
          dos -que es y cuanto falta- en vez de dejar que el navegador corte
          por donde caiga y deje el punto al principio de la segunda. */}
      <span aria-hidden="true" className="hidden sm:inline">
        {" · "}
      </span>
      <span className="block whitespace-nowrap sm:inline">
        <span aria-hidden="true">{active ? t("bonusEndsIn") : t("bonusStartsIn")} </span>
        <AnnouncementCountdown
          targetIso={targetIso}
          nowIso={nowIso}
          daysUnit={t("daysShort")}
          deadlineLabel={deadlineLabel}
          completedLabel={deadlineLabel}
        />
      </span>
    </p>
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
