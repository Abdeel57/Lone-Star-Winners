import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { CheckoutForm } from "@/components/checkout-form";
import { EntryQuotePanel } from "@/components/entry-quote-panel";
import { formatMoney } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchCart, pickLocalized } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

/** Un checkout es de una sesion concreta: nunca se prerenderiza. */
export const dynamic = "force-dynamic";

/**
 * Checkout.
 *
 * TRES COMPROBACIONES ANTES DE ENSENAR EL FORMULARIO, y las tres son estados de
 * pantalla y no errores:
 *
 * 1. Sin sesion -> se pide iniciarla, con vuelta a esta misma pagina. Un pedido
 *    pertenece a una cuenta.
 * 2. Con el carrito vacio -> se dice, y se enlaza a la tienda. Ensenar un
 *    formulario de direccion para cobrar cero es peor que decirlo.
 * 3. Si el carrito no se puede leer -> el estado de error con su referencia.
 *
 * LA COTIZACION SE ENSENA Y SE ETIQUETA COMO ORIENTATIVA
 * ------------------------------------------------------
 * La cifra que se ve aqui la calculo el backend sobre el carrito de servidor, y
 * sigue siendo informativa hasta que la orden alcance el estado que las
 * Official Rules definan como cualificante. Esta pagina no la recalcula, no la
 * confirma y no promete que vaya a mantenerse: eso lo decide el backend cuando
 * llegue la confirmacion del pago.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("checkout");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <CheckoutShell title={t("title")}>
        <SignInRequired returnPath="/checkout" />
      </CheckoutShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <CheckoutShell title={t("title")}>
        <MfaRequired returnPath="/checkout" />
      </CheckoutShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <CheckoutShell title={t("title")}>
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </CheckoutShell>
    );
  }

  const [cartResult, promotionResult] = await Promise.all([
    fetchCart(locale, session),
    fetchActivePromotion(locale),
  ]);

  if (!cartResult.ok) {
    return (
      <CheckoutShell title={t("title")}>
        <ApiErrorState failure={cartResult.error} headingLevel="h2" />
      </CheckoutShell>
    );
  }

  const { lines, entry_quote: quote } = cartResult.data;

  if (lines.length === 0) {
    return (
      <CheckoutShell title={t("title")}>
        <EmptyState
          headingLevel="h2"
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            <Link href="/shop" className={buttonVariants({ variant: "accent" })}>
              {t("backToCart")}
            </Link>
          }
        />
      </CheckoutShell>
    );
  }

  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : "UTC";

  // `subtotal` es `null` en un carrito vacio, que aqui ya se descarto arriba.
  // Se comprueba igualmente: imprimir "null" donde va el importe a pagar es el
  // peor sitio posible para un texto sin sentido.
  const subtotal =
    cartResult.data.subtotal === null ? null : formatMoney(cartResult.data.subtotal, locale);

  return (
    <CheckoutShell title={t("title")} intro={t("intro")}>
      <div className="grid gap-s6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="checkout-address">
          <h2 id="checkout-address" className="lsw-display text-heading-lg text-text">
            {t("addressHeading")}
          </h2>

          <div className="mt-s5">
            <CheckoutForm locale={locale} />
          </div>
        </section>

        <aside className="flex flex-col gap-s4">
          <Card elevation="raised" padding="md">
            <CardTitle as="h2" size="sm">
              {t("reviewHeading")}
            </CardTitle>

            <ul className="mt-s4 flex list-none flex-col gap-s3">
              {lines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-s3">
                  <span className="min-w-0 text-body-sm text-text-muted">
                    {pickLocalized(line.name, locale)}
                    {" · "}
                    <span className="tabular-nums">{line.quantity}</span>
                  </span>

                  {/* El subtotal de linea LLEGA CALCULADO. Aqui no se multiplica
                      cantidad por precio, ni siquiera cuando parece trivial. */}
                  <span className="shrink-0 text-body-sm tabular-nums text-text">
                    {formatMoney(line.line_subtotal, locale)}
                  </span>
                </li>
              ))}
            </ul>

            {subtotal === null ? null : (
              <p className="mt-s4 flex items-baseline justify-between gap-s3 border-t border-border pt-s3">
                <span className="text-body-sm text-text-muted">{t("reviewHeading")}</span>
                <span className="font-display text-heading-sm font-bold tabular-nums text-text">
                  {subtotal}
                </span>
              </p>
            )}

            <div className="mt-s4">
              <Link
                href="/cart"
                className="text-body-sm text-text-muted underline underline-offset-4"
              >
                {t("backToCart")}
              </Link>
            </div>
          </Card>

          <EntryQuotePanel quote={quote} locale={locale} timeZone={timeZone} />

          <p className="text-caption text-text-subtle">{t("entriesNote")}</p>
        </aside>
      </div>
    </CheckoutShell>
  );
}

/** Contenedor comun de la pantalla, para no repetirlo en los cinco estados. */
function CheckoutShell({
  title,
  intro,
  children,
}: {
  readonly title: string;
  readonly intro?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="lsw-container py-s10 pb-s16">
      <h1 className="lsw-display text-display-sm text-text">{title}</h1>
      <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

      {intro === undefined ? null : (
        <p className="mt-s4 max-w-[52rem] text-body text-text-muted">{intro}</p>
      )}

      <div className="mt-s8">{children}</div>
    </div>
  );
}
