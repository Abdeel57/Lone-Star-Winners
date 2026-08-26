import { Alert, Badge, Card, CardTitle, EmptyState, StatCard } from "@lsw/ui";
import { useTranslations } from "next-intl";

import {
  formatEntryCount,
  formatInteger,
  formatMoney,
  formatZonedDateTime,
} from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { useCapKindLabel, useIneligibilityReason } from "@/i18n/storefront-labels";
import type { Cart, EntryQuote } from "@/lib/api";

/**
 * Cotizacion de participaciones del carrito.
 *
 * ESTE COMPONENTE NO CALCULA NADA. NI UNA SUMA.
 * ---------------------------------------------
 * Es la regla mas importante del hito y conviene decirla sin rodeos: cada
 * numero que aparece aqui viene tal cual de `GET /cart/entry-quote`, que el
 * backend calcula sobre el carrito DEL SERVIDOR (DEC-023, requisito R13 de
 * `security`).
 *
 * En concreto, y aunque tentara:
 * - `final_entries` NO se deriva de `entries_before_caps` y los topes.
 * - `entries_before_caps` NO se deriva del subtotal y el ratio.
 * - los multiplicadores NO se aplican aqui; se listan.
 * - no se enseña una "estimacion optimista" mientras llega la cifra real. Una
 *   cifra provisional que luego cambia es peor que esperar: la primera es la
 *   que se recuerda.
 *
 * POR QUE SE MUESTRAN LAS DOS CIFRAS
 * ----------------------------------
 * `entries_before_caps` solo aparece cuando difiere de `final_entries`. Cuando
 * difieren, es porque se aplico un tope, y entonces la pantalla puede explicar
 * POR QUE la cifra bajo en vez de enseñar un numero mas pequeño del esperado
 * sin justificacion. Cuando coinciden, enseñar las dos solo confundiria.
 *
 * LA COTIZACION PUEDE ESTAR CADUCADA
 * ----------------------------------
 * Si el carrito se modifico despues de calcular la cifra, se dice y se ofrece
 * recargar. Lo que NO se hace es corregirla: corregirla seria calcularla.
 */
export function EntryQuotePanel({
  quote,
  cart,
  locale,
  timeZone,
}: {
  readonly quote: EntryQuote | null;
  readonly cart: Cart;
  readonly locale: Locale;
  /** Zona legal de la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
}) {
  const t = useTranslations("cart.quote");
  const capKindLabel = useCapKindLabel();
  const ineligibilityReason = useIneligibilityReason();

  if (quote === null) {
    return (
      <Card as="section" elevation="flat" padding="md">
        <EmptyState
          headingLevel="h2"
          title={t("unavailable.title")}
          description={t("unavailable.body")}
        />
      </Card>
    );
  }

  const evaluatedAt = formatZonedDateTime(quote.evaluated_at, locale, {
    timeZone,
    showTimeZoneName: true,
  });
  const eligibleSubtotal = formatMoney(quote.eligible_subtotal, locale);

  // COMPARACION de instantes, no aritmetica sobre participaciones. Si el
  // carrito cambio despues de cotizarlo, la cifra ya no describe este carrito.
  const stale = isStale(quote.evaluated_at, cart.updated_at);

  const cappedDown = quote.final_entries !== quote.entries_before_caps;

  return (
    <Card as="section" elevation="flat" padding="md" className="flex flex-col gap-4">
      <CardTitle as="h2" size="sm">
        {t("heading")}
      </CardTitle>

      {stale ? <Alert tone="warning">{t("stale")}</Alert> : null}

      <StatCard
        label={t("heading")}
        value={t("entries", {
          entries: formatEntryCount(quote.final_entries, locale),
        })}
      />

      <div className="flex flex-col gap-1 text-body-sm text-text-muted">
        {/* `entries_before_caps` solo se enseña cuando difiere de la cifra
            final. Si coinciden, dos numeros iguales uno encima de otro solo
            harian dudar de cual es el bueno. */}
        {cappedDown ? (
          <p>{t("beforeCaps", { entries: formatEntryCount(quote.entries_before_caps, locale) })}</p>
        ) : null}

        {eligibleSubtotal === null ? null : (
          <p>{t("eligibleSubtotal", { amount: eligibleSubtotal })}</p>
        )}
      </div>

      {quote.applied_multipliers.length === 0 ? null : (
        <section aria-labelledby="quote-multipliers">
          <h3 id="quote-multipliers" className="text-label font-medium text-text-muted">
            {t("multipliersHeading")}
          </h3>

          <ul className="mt-2 flex list-none flex-wrap gap-2">
            {quote.applied_multipliers.map((multiplier) => (
              <li key={multiplier.id}>
                {/* Se imprimen los dos numeros de la fraccion. Dividirlos para
                    enseñar "1.5X" seria redondear una cifra que el motor aplica
                    exacta (DEC-010). */}
                <Badge tone="accent" size="sm">
                  {multiplier.denominator === 1
                    ? `${formatInteger(multiplier.numerator, locale)}×`
                    : `${formatInteger(multiplier.numerator, locale)}/${formatInteger(multiplier.denominator, locale)}×`}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {quote.applied_caps.length === 0 ? null : (
        <section aria-labelledby="quote-caps">
          <h3 id="quote-caps" className="text-label font-medium text-text-muted">
            {t("capsHeading")}
          </h3>

          <ul className="mt-2 flex list-none flex-col gap-1 text-body-sm text-text-muted">
            {quote.applied_caps.map((cap) => (
              <li key={`${cap.kind}-${String(cap.limit)}`}>
                {t("capRow", {
                  kind: capKindLabel(cap.kind),
                  limit: formatEntryCount(cap.limit, locale),
                  before: formatEntryCount(cap.entries_before, locale),
                  after: formatEntryCount(cap.entries_after, locale),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {quote.ineligible_items.length === 0 ? null : (
        <section aria-labelledby="quote-ineligible">
          <h3 id="quote-ineligible" className="text-label font-medium text-text-muted">
            {t("ineligibleHeading")}
          </h3>

          <ul className="mt-2 flex list-none flex-col gap-1 text-body-sm text-text-muted">
            {quote.ineligible_items.map((item) => (
              <li key={item.line_id}>
                <span className="font-mono">{item.sku}</span>
                <span className="mx-1" aria-hidden="true">
                  —
                </span>
                {ineligibilityReason(item.reason_key)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-1 text-caption text-text-subtle">
        {evaluatedAt === null ? null : <p>{t("evaluatedAt", { when: evaluatedAt })}</p>}

        {/* Procedencia de la cifra. No es decoracion: es lo que permite a
            soporte -y a una auditoria- saber que version de reglas y que
            version de motor produjeron este numero. */}
        <p className="font-mono">
          {t("engineNote", {
            rulesVersion: quote.rules_version_id,
            engineVersion: formatInteger(quote.engine_version, locale),
          })}
        </p>
      </div>

      <Alert tone="info">{t("disclaimer")}</Alert>
    </Card>
  );
}

/**
 * Si la cotizacion es anterior al ultimo cambio del carrito.
 *
 * Es una comparacion de dos instantes que manda el servidor. NO usa el reloj
 * del navegador (DEC-011) y no toca ninguna cifra de participaciones. Ante una
 * fecha invalida devuelve `false`: avisar de una caducidad que no se puede
 * comprobar seria inventarse un problema.
 */
export function isStale(evaluatedAt: string, cartUpdatedAt: string): boolean {
  const evaluated = new Date(evaluatedAt).getTime();
  const updated = new Date(cartUpdatedAt).getTime();

  if (Number.isNaN(evaluated) || Number.isNaN(updated)) return false;

  return evaluated < updated;
}
