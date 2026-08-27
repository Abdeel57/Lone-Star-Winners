import { Badge, Card, CardTitle } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatInteger, formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { EntryOffer } from "@/lib/api";
import { shouldShowMultiplier, type PromotionPresentation } from "@/lib/promotion-state";

/**
 * Oferta de participaciones de la promocion.
 *
 * TRES COSAS QUE ESTE COMPONENTE NO HACE
 * --------------------------------------
 * 1. **No multiplica.** No calcula "5 por dolar por 2X igual a 10". Muestra el
 *    ratio y el multiplicador como dos datos distintos, porque la cifra que
 *    vale es la que produce el backend para un carrito o un pedido concreto
 *    (DEC-023, requisito R13 de `security`). Una multiplicacion hecha aqui
 *    seria una cifra de participaciones calculada en el navegador, que es
 *    exactamente lo que el sistema no puede permitirse.
 * 2. **No fija ningun ratio.** `base_entries_per_unit` y `unit_amount` llegan
 *    del contrato. Aqui no hay ni un numero (CLAUDE.md #3 y #14).
 * 3. **No promete nada.** El texto dice que las cantidades las calculan los
 *    sistemas y las rigen las Reglas Oficiales.
 *
 * EL MULTIPLICADOR TIENE TRES CERROJOS
 * ------------------------------------
 * El flag `entry_multipliers_enabled`, que el dato exista y amplifique de
 * verdad, y que la promocion admita participaciones ahora mismo. El tercero es
 * el que se olvida: anunciar "2X" sobre una promocion cerrada no es una
 * decoracion caducada, es una afirmacion falsa.
 *
 * EL MULTIPLICADOR ES UNA FRACCION, NO UN NUMERO
 * ----------------------------------------------
 * DEC-010 lo hace viajar como `{ numerator, denominator }`. Aqui NO se divide
 * para convertirlo en "1.5": se imprimen los dos numeros. Un multiplicador
 * fraccionario redondeado a decimal es una cifra distinta de la que aplico el
 * motor, y en esta pantalla eso seria decir algo falso sobre la promocion.
 *
 * SIN REGLAS PUBLICADAS NO SE PUBLICA LA OFERTA (DEC-044)
 * -------------------------------------------------------
 * El ratio -"5 participaciones por cada $1 de mercancia elegible"- es una
 * afirmacion sobre COMO FUNCIONA la promocion, de la misma clase que las que
 * DEC-044 retiro del hero y de la banda de anuncio. Y es la mas concreta de
 * todas: un numero que el participante puede multiplicar por su carrito. Ese
 * numero no lo fija este panel ni el catalogo, lo fija la version de reglas
 * (DEC-012); mientras no exista documento que lo gobierne, no hay nada que
 * publicar. El multiplicador cae con el, y por el mismo motivo: es el ratio
 * amplificado.
 *
 * El panel NO desaparece. Es la misma linea que se trazo en la banda de
 * anuncio: conserva su titulo y dice exactamente que falta. Enmudecerlo dejaria
 * un hueco sin explicacion justo donde el visitante viene a buscar la cifra.
 *
 * La senal es `rules_version_id`, leida por la pagina y pasada como prop. Es la
 * misma que consultan el hero y la banda, y llega ya resuelta por el mismo
 * motivo que `multipliersEnabled`: la decision se toma en SERVIDOR, en la misma
 * peticion que el render, y este componente no vuelve a preguntar por su
 * cuenta.
 */
export function EntryOfferPanel({
  offer,
  presentation,
  multipliersEnabled,
  rulesPublished,
  locale,
  timeZone,
}: {
  readonly offer: EntryOffer | null;
  readonly presentation: PromotionPresentation;
  /** Valor de `entry_multipliers_enabled`, leido en servidor (DEC-013). */
  readonly multipliersEnabled: boolean;
  /**
   * Si la promocion tiene version de Reglas Oficiales publicada (DEC-044).
   *
   * OBLIGATORIA A PROPOSITO, sin valor por defecto: un `true` implicito haria
   * que quien anadiera un tercer sitio de uso publicara el ratio por olvido, y
   * el olvido caeria del lado inseguro.
   */
  readonly rulesPublished: boolean;
  readonly locale: Locale;
  readonly timeZone: string;
}) {
  const t = useTranslations("entryOffer");

  // Sin oferta declarada no hay nada que publicar NI que retener: el panel no
  // se renderiza, con reglas o sin ellas.
  if (offer === null) return null;

  if (!rulesPublished) {
    return (
      <Card as="section" elevation="flat" padding="md">
        <CardTitle as="h2" size="sm">
          {t("heading")}
        </CardTitle>

        {/*
         * En tono de dato y no de alarma: el aviso fuerte -`home.rulesNotPublished`
         * en `Alert tone="warning"`- ya esta en el hero de la portada y en la
         * banda de avisos del detalle. Repetir aqui la misma alerta seria decir
         * dos veces lo mismo en la misma pantalla; lo que este panel aporta es
         * por que ESTA seccion se ha quedado sin cifra.
         *
         * Tampoco se pinta `governedNote`: dice que "las cifras que se muestran
         * aqui son informativas", y aqui ya no se muestra ninguna.
         */}
        <p className="mt-s3 text-body-md text-text-muted">{t("rulesPending")}</p>
      </Card>
    );
  }

  const showMultiplier = shouldShowMultiplier(multipliersEnabled, offer.multiplier, presentation);

  const multiplierUntil =
    showMultiplier && offer.multiplier_ends_at !== null
      ? formatZonedDateTime(offer.multiplier_ends_at, locale, {
          timeZone,
          showTimeZoneName: true,
        })
      : null;

  const unitAmount = formatMoney(offer.unit_amount, locale);

  return (
    <Card as="section" elevation="flat" padding="md">
      <CardTitle as="h2" size="sm">
        {t("heading")}
      </CardTitle>

      <p className="mt-s3 text-body-md text-text">
        {/* Un importe que no respeta DEC-010 se trata como oferta ausente: mas
            vale decir que no hay oferta declarada que pintar un importe roto
            junto a una cifra de participaciones. */}
        {unitAmount === null
          ? t("ratioUnavailable")
          : t("ratio", {
              entries: formatInteger(offer.base_entries_per_unit, locale),
              amount: unitAmount,
            })}
      </p>

      {showMultiplier && offer.multiplier !== null ? (
        <div className="mt-s4 flex flex-col items-start gap-2">
          {/* ORO (DEC-042). `accent` paso a ser el rojo de accion de compra, y
              esto no es una accion: es una cifra de participaciones, que en
              este sistema son siempre doradas. El tono `brand` hace lo mismo
              que hacia el "oro intenso" anterior. */}
          <Badge tone="brand">
            {offer.multiplier.denominator === 1
              ? t("multiplierBadge", {
                  numerator: formatInteger(offer.multiplier.numerator, locale),
                })
              : t("multiplierFractionBadge", {
                  numerator: formatInteger(offer.multiplier.numerator, locale),
                  denominator: formatInteger(offer.multiplier.denominator, locale),
                })}
          </Badge>

          {multiplierUntil === null ? null : (
            <p className="text-body-sm text-text-muted">
              {t("multiplierUntil", { until: multiplierUntil })}
            </p>
          )}
        </div>
      ) : null}

      <p className="mt-s4 text-caption text-text-subtle">{t("governedNote")}</p>
    </Card>
  );
}
