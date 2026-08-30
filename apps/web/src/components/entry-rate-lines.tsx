import { Badge } from "@lsw/ui";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("entryOffer");

  const amount = formatMoney(rate.amount_unit, locale);
  if (amount === null) return null;

  const entries = fractionText(rate.entries_per_amount_unit, locale);

  return (
    <li className="text-body-md text-text">
      {rate.product_kind === "ENTRY_PACKAGE"
        ? t("ratePackage", { entries, amount })
        : rate.product_kind === "MERCHANDISE"
          ? t("rateMerchandise", { entries, amount })
          : t("rateAny", { entries, amount })}
    </li>
  );
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
