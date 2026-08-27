import { Alert, Badge, Card, CardTitle, EmptyState } from "@lsw/ui";
import { useTranslations } from "next-intl";

import {
  formatEntryCount,
  formatInteger,
  formatMoney,
  formatZonedDateTime,
} from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { useCapKindLabel, useIneligibilityReason } from "@/i18n/storefront-labels";
import type { EntryQuote } from "@/lib/api";

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
 * NO SE AFIRMA NI SE NIEGA QUE LA CIFRA SIGA VIGENTE
 * ---------------------------------------------------
 * Este panel llego a comparar `evaluated_at` con un `updated_at` del carrito y
 * a avisar de que la cotizacion estaba caducada. `updated_at` NO EXISTE en la
 * respuesta que publica el contrato (HO-034 punto 2; sigue pedido en HO-017),
 * asi que la comparacion se hacia contra un campo inventado.
 *
 * Se ha retirado sin sustituirla por una afirmacion en el otro sentido: decir
 * "esta al dia" tampoco se puede demostrar. Lo que se publica es el INSTANTE de
 * evaluacion, que es un dato del servidor y deja que quien mira saque su propia
 * conclusion.
 *
 * Con el contrato en la mano ademas casi nunca hay nada que avisar: la
 * cotizacion viaja DENTRO de la misma respuesta de `GET /cart` y el backend la
 * calcula sobre ese mismo carrito, de modo que las dos cosas que la pantalla
 * pinta salen de la misma lectura. La carrera solo existiria con la ruta
 * separada `GET /cart/entry-quote`, que ninguna pantalla usa hoy.
 */
export function EntryQuotePanel({
  quote,
  locale,
  timeZone,
}: {
  readonly quote: EntryQuote | null;
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
  // `eligible_subtotal` es `null` con el carrito vacio: sin lineas no hay
  // moneda que declarar. No es cero -cero seria "hay articulos y ninguno
  // cuenta"-, asi que la linea del subtotal elegible simplemente no se pinta.
  const eligibleSubtotal =
    quote.eligible_subtotal === null ? null : formatMoney(quote.eligible_subtotal, locale);

  const cappedDown = quote.final_entries !== quote.entries_before_caps;

  return (
    <Card as="section" elevation="raised" padding="md" className="flex flex-col gap-4">
      <CardTitle as="h2" size="sm">
        {t("heading")}
      </CardTitle>

      {/*
       * LA CIFRA, CON EL PESO QUE LE CORRESPONDE (DEC-038).
       *
       * Es el UNICO numero de participaciones de todo el sitio: el catalogo no
       * lo declara y la portada no lo calcula. Que sea el unico es lo que
       * justifica que sea tambien el mas grande y el unico en oro.
       *
       * Etiqueta propia, no el titulo de la tarjeta: repetir la misma frase
       * dentro del recuadro que hay justo debajo del titulo hace dudar de si
       * son dos cosas distintas.
       */}
      <div className="rounded-lg border border-brand/40 bg-brand/10 p-s5">
        <p className="lsw-eyebrow text-brand">{t("statLabel")}</p>
        <p className="lsw-display lsw-gold-sheen mt-s2 text-display-md tabular-nums">
          {t("entries", {
            entries: formatEntryCount(quote.final_entries, locale),
          })}
        </p>
      </div>

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
                {/* ORO (DEC-042): una cifra de participaciones, no una accion.
                    Ver la nota equivalente en `EntryOfferPanel`. */}
                <Badge tone="brand" size="sm">
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
