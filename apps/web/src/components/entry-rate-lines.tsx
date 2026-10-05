import { Badge, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";

import { formatInteger, formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { BonusPeriod, EntryMultiplier, EntryRate, ProductKind } from "@/lib/api";

/**
 * Piezas compartidas para hablar de la oferta de participaciones (§13.5).
 *
 * Existen aparte porque las MISMAS tres frases -la tasa, el tope y el periodo
 * bonus- se pintan en cuatro sitios: el hero de la portada, el panel de oferta,
 * la pagina de la promocion y la ficha de un paquete. Escritas cuatro veces,
 * acabarian diciendo cosas distintas del mismo dato, que es exactamente lo que
 * no puede pasar con una cifra que gobiernan las Official Rules.
 *
 * NINGUNA DE ESTAS FUNCIONES OPERA CON PARTICIPACIONES
 * ----------------------------------------------------
 * La tasa llega como FRACCION (DEC-010) y se imprime como dos numeros: `3/2`
 * NO se convierte en "1.5", porque un multiplicador fraccionario redondeado a
 * decimal es una cifra distinta de la que aplica el motor. El importe llega en
 * unidad menor y solo se formatea. No hay ni una multiplicacion.
 */

/**
 * Una fraccion, escrita.
 *
 * Con denominador 1 se imprime solo el numerador -"2", no "2/1"- porque es lo
 * que la gente lee; con cualquier otro, los dos numeros separados por barra.
 * Es FORMATEO: los dos enteros ya vienen decididos y aqui no se dividen.
 */
export function fractionText(fraction: EntryMultiplier, locale: Locale): string {
  const numerator = formatInteger(fraction.numerator, locale);
  if (fraction.denominator === 1) return numerator;

  return `${numerator}/${formatInteger(fraction.denominator, locale)}`;
}

/**
 * La tasa de un tipo de producto, en una frase.
 *
 * TRES FRASES Y NO UNA, porque tres cosas distintas se dicen distinto: "por
 * cada $1 en mercancia elegible", "por cada $1 en paquetes de participaciones"
 * y, con el modo de tasa unica, "por cada $1 de compra elegible". La tercera es
 * la que se usa cuando la promocion no distingue tipos: decir "en mercancia"
 * ahi excluiria a los paquetes sin motivo.
 *
 * Un importe que no respeta DEC-010 se trata como tasa ausente: no se pinta.
 * Mas vale una linea de menos que un importe roto junto a una cifra de
 * participaciones.
 */
export function RateLine({ rate, locale }: { readonly rate: EntryRate; readonly locale: Locale }) {
  const sentence = useRateSentence();
  const text = sentence(rate, locale);
  if (text === null) return null;

  return <li className="text-body-md text-text">{text}</li>;
}

/**
 * Singular o plural de "participacion". Solo es singular la tasa entera 1/1:
 * "1 participacion", pero "3/2 participaciones" y "2 participaciones". Es
 * GRAMATICA, no aritmetica: no se divide nada.
 */
function pluralCount(fraction: EntryMultiplier): number {
  return fraction.numerator === 1 && fraction.denominator === 1 ? 1 : 2;
}

/** La frase completa de una tasa, o `null` si el importe no respeta DEC-010. */
function useRateSentence(): (rate: EntryRate, locale: Locale) => string | null {
  const t = useTranslations("entryOffer");

  return (rate, locale) => {
    const amount = formatMoney(rate.amount_unit, locale);
    if (amount === null) return null;

    const entries = fractionText(rate.entries_per_amount_unit, locale);
    const count = pluralCount(rate.entries_per_amount_unit);

    return rate.product_kind === "ENTRY_PACKAGE"
      ? t("ratePackage", { entries, amount, count })
      : rate.product_kind === "MERCHANDISE"
        ? t("rateMerchandise", { entries, amount, count })
        : t("rateAny", { entries, amount, count });
  };
}

/**
 * Las tasas como TARJETAS: la cifra grande en oro y debajo que es y por que
 * importe (DEC-071). Es la misma informacion que `RateList` -y la misma frase,
 * entera, para lectores de pantalla-; cambia la forma de ensenarla.
 *
 * ORO las cifras de participaciones, como en todo el sistema (DEC-042).
 */
export function RateTiles({
  rates,
  locale,
  className,
}: {
  readonly rates: readonly EntryRate[];
  readonly locale: Locale;
  readonly className?: string;
}) {
  const tiles = useRateFigures(rates, locale);

  if (tiles.length === 0) return null;

  return (
    <ul
      className={cn(
        "grid list-none gap-s3",
        tiles.length > 1 ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {tiles.map((tile) => (
        <li
          key={tile.key}
          className="relative flex flex-col items-center overflow-hidden rounded-xl border border-brand/30 bg-gradient-to-b from-brand/[0.12] via-surface-raised to-surface-raised px-s3 pb-s4 pt-s5 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
        >
          {/* Filete de oro arriba, como los pases de la banda de paquetes. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand/0 via-brand to-brand/0"
          />
          {/* La frase entera, una vez, para lectores de pantalla. */}
          <span className="sr-only">{tile.text}</span>
          <span
            aria-hidden="true"
            className="lsw-headline lsw-gold-sheen text-[clamp(3rem,15vw,4.5rem)] tabular-nums"
          >
            {tile.figure}
          </span>
          <span
            aria-hidden="true"
            className="mt-s1 font-headline text-label font-extrabold uppercase italic tracking-[0.06em] text-text"
          >
            {tile.unit}
          </span>
          <span aria-hidden="true" className="mt-s1 text-caption leading-snug text-text-muted">
            {tile.per}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Las tasas en FRANJA, para la banda dorada de la portada (DEC-072): las dos
 * cifras una junto a otra, en tinta sobre oro, separadas por un corte en
 * diagonal. Misma informacion y misma frase accesible que `RateTiles`.
 */
export function RateStrip({
  rates,
  locale,
  className,
}: {
  readonly rates: readonly EntryRate[];
  readonly locale: Locale;
  readonly className?: string;
}) {
  const tiles = useRateFigures(rates, locale);

  if (tiles.length === 0) return null;

  return (
    <ul
      className={cn(
        "mx-auto grid w-full max-w-2xl list-none",
        tiles.length > 1 ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {tiles.map((tile, index) => (
        <li
          key={tile.key}
          // DEC-075: las cifras entran una tras otra al llegar a la banda.
          data-reveal
          style={{ "--reveal-delay": `${String(index * 140)}ms` } as CSSProperties}
          className={cn(
            "relative flex items-center justify-center gap-s2 px-s2 sm:gap-s4",
            // El corte en diagonal entre las dos cifras.
            index > 0 &&
              "before:absolute before:inset-y-s1 before:left-0 before:w-[3px] before:-skew-x-12 before:rounded-pill before:bg-text-inverse/30",
          )}
        >
          <span className="sr-only">{tile.text}</span>
          <span
            aria-hidden="true"
            className="lsw-headline text-[clamp(3.25rem,17vw,6rem)] tabular-nums text-text-inverse [text-shadow:0_2px_0_rgb(255_255_255/0.25)]"
          >
            {tile.figure}
          </span>
          <span aria-hidden="true" className="flex min-w-0 flex-col text-left">
            <span className="font-headline text-label font-black uppercase italic leading-tight tracking-[0.04em] text-text-inverse sm:text-heading-sm">
              {tile.unit}
            </span>
            <span className="mt-[2px] text-caption font-medium leading-tight text-text-inverse/80 sm:text-body-sm">
              {tile.per}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

interface RateFigure {
  readonly key: string;
  readonly text: string;
  readonly figure: string;
  readonly unit: string;
  readonly per: string;
}

/** Las piezas de cada tasa para las dos formas visuales. Sin aritmetica. */
function useRateFigures(rates: readonly EntryRate[], locale: Locale): readonly RateFigure[] {
  const t = useTranslations("entryOffer");
  const sentence = useRateSentence();

  return rates.flatMap((rate) => {
    const text = sentence(rate, locale);
    const amount = formatMoney(rate.amount_unit, locale);
    if (text === null || amount === null) return [];
    return [
      {
        key: rate.product_kind ?? "ANY",
        text,
        figure: fractionText(rate.entries_per_amount_unit, locale),
        unit:
          pluralCount(rate.entries_per_amount_unit) === 1 ? t("tileUnitOne") : t("tileUnitOther"),
        per:
          rate.product_kind === "ENTRY_PACKAGE"
            ? t("tilePerPackage", { amount })
            : rate.product_kind === "MERCHANDISE"
              ? t("tilePerMerchandise", { amount })
              : t("tilePerAny", { amount }),
      },
    ];
  });
}

/** Las tasas declaradas, o nada si la promocion no declara ninguna. */
export function RateList({
  rates,
  locale,
  className,
}: {
  readonly rates: readonly EntryRate[];
  readonly locale: Locale;
  readonly className?: string;
}) {
  if (rates.length === 0) return null;

  return (
    <ul className={className === undefined ? LIST : `${LIST} ${className}`}>
      {rates.map((rate) => (
        <RateLine key={rate.product_kind ?? "ANY"} rate={rate} locale={locale} />
      ))}
    </ul>
  );
}

const LIST = "flex list-none flex-col gap-s2";

/**
 * A que alcanza un periodo bonus, en una palabra.
 *
 * `null` en el ambito significa TODOS los tipos. Con SKUs acotados ademas del
 * tipo, la pertenencia real es la interseccion y esta etiqueta se queda corta:
 * por eso el copy de "ambos tipos" no promete que alcance a todo el catalogo,
 * solo dice sobre que tipos se aplica.
 */
export function useBonusScopeLabel(): (scope: readonly ProductKind[] | null | undefined) => string {
  const t = useTranslations("entryOffer");

  return (scope) => {
    if (scope === null || scope === undefined || scope.length === 0) return t("scopeAll");
    if (scope.length === 1 && scope[0] === "ENTRY_PACKAGE") return t("scopePackages");
    if (scope.length === 1 && scope[0] === "MERCHANDISE") return t("scopeMerchandise");

    return t("scopeAll");
  };
}

/**
 * Insignia de un periodo bonus vigente.
 *
 * ORO (DEC-042): es una cifra de participaciones, no una accion de compra. El
 * rojo esta reservado a lo segundo.
 */
export function BonusBadge({
  period,
  locale,
}: {
  readonly period: BonusPeriod;
  readonly locale: Locale;
}) {
  const t = useTranslations("entryOffer");
  const scopeLabel = useBonusScopeLabel();

  return (
    <Badge tone="brand">
      {t("bonusBadge", {
        multiplier: fractionText(period.multiplier, locale),
        scope: scopeLabel(period.product_kind_scope),
      })}
    </Badge>
  );
}

/**
 * Un periodo bonus ANUNCIADO, con sus dos instantes.
 *
 * ES EL ANUNCIO PREVIO QUE EXIGEN LAS REGLAS: el segundo borrador pide que los
 * periodos bonus se anuncien en el sitio antes de que empiecen. Por eso se
 * pintan los que todavia no han arrancado y no solo el vigente.
 *
 * Las dos fechas se formatean contra la ZONA LEGAL de la promocion (DEC-011) y
 * se dice que es asi: "del 12 de sep a las 12:00 al 13 de sep a las 00:00" no
 * significa lo mismo en dos husos, y quien lee tiene que saber cual manda.
 */
export function BonusPeriodRow({
  period,
  locale,
  timeZone,
}: {
  readonly period: BonusPeriod;
  readonly locale: Locale;
  readonly timeZone: string;
}) {
  const t = useTranslations("entryOffer");
  const scopeLabel = useBonusScopeLabel();

  const from = formatZonedDateTime(period.starts_at, locale, { timeZone, showTimeZoneName: true });
  const to = formatZonedDateTime(period.ends_at, locale, { timeZone, showTimeZoneName: true });

  // Sin las dos fechas no hay periodo que anunciar: un "5X desde una fecha
  // ilegible" no es informacion, es ruido con aspecto de promesa.
  if (from === null || to === null) return null;

  return (
    <li className="flex flex-col gap-s1 border-t border-border pt-s3 text-body-sm text-text-muted">
      <span className="lsw-display text-body-md text-brand">
        {t("bonusBadge", {
          multiplier: fractionText(period.multiplier, locale),
          scope: scopeLabel(period.product_kind_scope),
        })}
      </span>
      <span>{t("bonusWindow", { from, to })}</span>
    </li>
  );
}
