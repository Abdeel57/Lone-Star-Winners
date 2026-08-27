import { Alert, Card, CardTitle } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatEntryCount, formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { useCapKindLabel, useIneligibilityReason } from "@/i18n/storefront-labels";
import type { EntryCalculationSnapshot } from "@/lib/api";

/**
 * Traza del calculo de participaciones de un pedido.
 *
 * PARA QUE EXISTE ESTA PANTALLA
 * -----------------------------
 * Para poder responder, meses despues, por que ESTA compra genero esta cifra y
 * no otra, cuando el catalogo y las reglas ya han cambiado. El contrato lo dice
 * con esas palabras. Es la mitad visible de lo que `EntryCalculationSnapshot`
 * persiste, y sin ella el participante tiene un numero sin explicacion y el
 * equipo de soporte tampoco.
 *
 * NO ES UNA COTIZACION. La cotizacion del carrito es orientativa y se
 * recalcula; esto es historico e inmutable, y por eso trae la version de reglas
 * y la del motor con las que se evaluo. Que las dos cosas se parezcan en
 * pantalla no las hace la misma: la de arriba puede cambiar en el siguiente
 * render y esta no cambia nunca.
 *
 * AQUI NO SE CALCULA NI SE COMPRUEBA NADA
 * ---------------------------------------
 * `entries_before_caps` y `final_entries` se pintan tal como llegan. No se
 * verifica que el tope explique la diferencia, no se deriva uno del otro y no
 * se suman los multiplicadores. Si el backend mandara dos cifras incoherentes,
 * la pantalla las ensenaria las dos -que es como se detecta el defecto- en vez
 * de taparlo con una resta hecha aqui.
 */
export function EntryCalculationTrace({
  calculation,
  locale,
  timeZone,
}: {
  readonly calculation: EntryCalculationSnapshot | null;
  readonly locale: Locale;
  /** Zona legal declarada por la promocion (DEC-011). */
  readonly timeZone: string;
}) {
  const t = useTranslations("account.order");
  const capKind = useCapKindLabel();
  const ineligibilityReason = useIneligibilityReason();

  if (calculation === null) {
    return <Alert tone="info">{t("noCalculation")}</Alert>;
  }

  const evaluatedAt = formatZonedDateTime(calculation.evaluated_at, locale, { timeZone });
  const eligibleSubtotal = formatMoney(calculation.eligible_subtotal, locale);
  const cappedDown = calculation.final_entries !== calculation.entries_before_caps;

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h3" size="sm">
        {t("calculationHeading")}
      </CardTitle>

      <p className="mt-s3 text-body-sm text-text-muted">{t("calculationIntro")}</p>

      <dl className="mt-s5 flex flex-col gap-s3">
        {eligibleSubtotal === null ? null : (
          <p className="text-body-sm text-text">
            {t("calculationEligibleSubtotal", { amount: eligibleSubtotal })}
          </p>
        )}

        {/* La cifra antes de los topes solo aparece cuando DIFIERE de la final:
            ensenar dos numeros iguales uno debajo del otro sugiere que ha pasado
            algo cuando no ha pasado nada. */}
        {cappedDown ? (
          <p className="text-body-sm text-text-muted">
            {t("calculationBeforeCaps", {
              entries: formatEntryCount(calculation.entries_before_caps, locale),
            })}
          </p>
        ) : null}

        <p className="font-display text-heading-sm font-bold tabular-nums text-brand">
          {t("calculationFinal", {
            entries: formatEntryCount(calculation.final_entries, locale),
          })}
        </p>
      </dl>

      {calculation.applied_multipliers.length === 0 ? null : (
        <section className="mt-s5">
          <h4 className="text-label font-medium text-text">{t("calculationMultipliers")}</h4>

          <ul className="mt-s2 flex list-none flex-wrap gap-2">
            {calculation.applied_multipliers.map((multiplier) => (
              <li
                key={multiplier.id}
                className="rounded-md border border-border px-2.5 py-1 text-caption tabular-nums text-text-muted"
              >
                {/* La fraccion se IMPRIME, no se evalua (DEC-010). `3/2` no se
                    puede pintar como "1.5x" sin redondear una cifra que el
                    motor aplica exacta. */}
                {multiplier.numerator}/{multiplier.denominator}
              </li>
            ))}
          </ul>
        </section>
      )}

      {calculation.applied_caps.length === 0 ? null : (
        <section className="mt-s5">
          <h4 className="text-label font-medium text-text">{t("calculationCaps")}</h4>

          <ul className="mt-s2 flex list-none flex-col gap-s2">
            {calculation.applied_caps.map((cap) => (
              <li key={`${cap.kind}-${cap.limit}`} className="text-body-sm text-text-muted">
                {t("calculationCapRow", {
                  kind: capKind(cap.kind),
                  limit: formatEntryCount(cap.limit, locale),
                  before: formatEntryCount(cap.entries_before, locale),
                  after: formatEntryCount(cap.entries_after, locale),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {calculation.ineligible_items.length === 0 ? null : (
        <section className="mt-s5">
          <h4 className="text-label font-medium text-text">{t("calculationIneligible")}</h4>

          <ul className="mt-s2 flex list-none flex-col gap-s2">
            {calculation.ineligible_items.map((item) => (
              <li key={item.line_id} className="text-body-sm text-text-muted">
                <span className="font-mono text-caption text-text-subtle">{item.sku}</span>{" "}
                {ineligibilityReason(item.reason_key)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-s5 border-t border-border pt-s3 text-caption text-text-subtle">
        {t("calculationRules", { rulesVersion: calculation.rules_version_id })}
        {" · "}
        {t("calculationEngine", { engineVersion: calculation.engine_version })}
        {evaluatedAt === null ? null : (
          <>
            {" · "}
            {t("calculationEvaluatedAt", { when: evaluatedAt })}
          </>
        )}
      </p>
    </Card>
  );
}
