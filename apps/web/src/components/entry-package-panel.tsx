import { Alert, Card, CardTitle } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { pickLocalized, type BonusPeriod, type ProductDetail } from "@/lib/api";
import { offerHasBonus } from "@/lib/entry-offer";

import { fractionText, useBonusScopeLabel } from "./entry-rate-lines";

/**
 * Participaciones que incluye un paquete (§13.4, DEC-052 punto 7).
 *
 * ES UN REQUISITO DE LAS OFFICIAL RULES, NO UNA DECISION DE DISEÑO. El segundo
 * borrador dice, sobre la Opcion 2, que "the number of entries included in each
 * package is stated on the page where the package is offered". Este bloque es
 * esa declaracion, y por eso vive en la ficha y no en un panel opcional.
 *
 * LAS CIFRAS LAS CALCULA EL BACKEND. `base_entries` y `entries_now` llegan
 * evaluadas con el motor real sobre UNA unidad de la variante, sin topes y con
 * `participantEntriesBefore = 0`. Este componente no multiplica `base_entries`
 * por el bonus, ni por la cantidad, ni por el precio: PINTA los dos numeros que
 * le llegan (DEC-023, requisito R13 de `security`).
 *
 * Y LO DICE EN VOZ ALTA. Debajo de las cifras hay una nota que explica que las
 * calculan los sistemas, que las gobiernan las Reglas Oficiales y que la
 * cantidad definitiva depende del estado del pedido. Sin esa nota, dos numeros
 * grandes en una ficha de producto se leen como una promesa cerrada.
 *
 * SIN OFERTA NO SE DICE NADA. Cuando el backend manda `entry_offer: null` -sin
 * promocion activa, sin version de reglas, sin tasa para el tipo o con el
 * producto no elegible- este bloque dice que la cifra no esta publicada y
 * remite a las Reglas. No estima.
 */
export function EntryPackagePanel({
  product,
  locale,
  activeBonus,
  timeZone,
}: {
  readonly product: ProductDetail;
  readonly locale: Locale;
  /**
   * Periodo bonus vigente de la promocion, si la pagina lo tiene.
   *
   * Sirve para NOMBRAR el bonus que produjo `entries_now` y decir hasta cuando
   * dura. Sin el, las cifras se pintan igual y la frase se queda corta: es
   * preferible a inventarse el plazo.
   */
  readonly activeBonus: BonusPeriod | null;
  /** Zona legal de la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
}) {
  const t = useTranslations("product");

  // Solo los paquetes declaran participaciones incluidas. Para la mercancia la
  // cifra depende del subtotal del pedido entero y no del articulo, asi que
  // declararla aqui prometeria un resultado que el motor puede no dar.
  if (product.kind !== "ENTRY_PACKAGE") return null;

  const variants = product.variants;

  return (
    <Card as="section" elevation="raised" padding="md">
      <CardTitle as="h2" size="sm">
        {t("packageEntriesHeading")}
      </CardTitle>

      <ul className="mt-s4 flex list-none flex-col gap-s4">
        {variants.map((variant) => {
          const offer = variant.entry_offer ?? null;
          const name = variant.name ?? null;

          return (
            <li key={variant.id} className="flex flex-col gap-s1">
              {/* El nombre de la variante solo se pinta cuando hay mas de una:
                  en un paquete de variante unica seria una etiqueta sin
                  alternativa que distinguir. */}
              {variants.length === 1 || name === null ? null : (
                <p className="text-label font-medium text-text-muted">
                  {pickLocalized(name, locale)}
                </p>
              )}

              {offer === null ? (
                <p className="text-body-md text-text-muted">{t("packageEntriesUnavailable")}</p>
              ) : (
                <>
                  <p className="lsw-display text-heading-md text-brand">
                    {t("packageIncludes", {
                      entries: formatEntryCount(offer.base_entries, locale),
                    })}
                  </p>

                  {offerHasBonus(offer) ? (
                    <BonusLine
                      entriesNow={offer.entries_now}
                      multiplierIds={offer.multiplier_ids}
                      activeBonus={activeBonus}
                      timeZone={timeZone}
                      locale={locale}
                    />
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/*
       * LA NOTA NO ES OPCIONAL.
       *
       * Dice tres cosas y las tres hacen falta: que las cantidades las calculan
       * los sistemas, que las gobiernan las Reglas Oficiales, y que la cifra
       * definitiva depende del estado del pedido -las participaciones se
       * generan cuando la orden alcanza el estado cualificante, no cuando el
       * navegador llega a una pagina de exito-.
       */}
      <Alert tone="info" className="mt-s5">
        {t("packageEntriesNote")}
      </Alert>
    </Card>
  );
}

/**
 * La cifra con el bonus aplicado.
 *
 * SE COMPRUEBA LA IDENTIDAD DEL PERIODO, no su existencia: que la promocion
 * tenga un bonus vigente no significa que sea el que se aplico a esta variante
 * -el ambito puede excluirla-. `multiplier_ids` es lo que el motor dice que
 * aplico, y es lo unico que autoriza a nombrarlo.
 */
function BonusLine({
  entriesNow,
  multiplierIds,
  activeBonus,
  timeZone,
  locale,
}: {
  readonly entriesNow: number;
  readonly multiplierIds: readonly string[];
  readonly activeBonus: BonusPeriod | null;
  readonly timeZone: string;
  readonly locale: Locale;
}) {
  const t = useTranslations("product");
  const scopeLabel = useBonusScopeLabel();

  const entries = formatEntryCount(entriesNow, locale);
  const applied =
    activeBonus !== null && multiplierIds.includes(activeBonus.id) ? activeBonus : null;

  if (applied === null) {
    return <p className="text-body-md text-text">{t("packageNow", { entries })}</p>;
  }

  const until = formatZonedDateTime(applied.ends_at, locale, {
    timeZone,
    showTimeZoneName: true,
  });

  const multiplier = fractionText(applied.multiplier, locale);
  const scope = scopeLabel(applied.product_kind_scope);

  return (
    <p className="text-body-md text-text">
      {until === null
        ? t("packageNowWithBonus", { entries, multiplier, scope })
        : t("packageNowWithBonusUntil", { entries, multiplier, scope, until })}
    </p>
  );
}
