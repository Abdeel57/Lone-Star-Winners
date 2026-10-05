import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { CartTotals } from "@/components/cart-totals";
import { CheckoutForm } from "@/components/checkout-form";
import { EligibilityDeclarationForm } from "@/components/eligibility-declaration-form";
import { EntryQuotePanel } from "@/components/entry-quote-panel";
import type { CashDeliveryOptions } from "@/components/fulfillment-choice";
import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  fetchActivePromotion,
  fetchCart,
  fetchMyEligibility,
  fetchSiteConfig,
  pickLocalized,
  type CartWithQuote,
} from "@/lib/api";
import { isFeatureEnabled, toFeatureFlags } from "@/lib/flags";
import { loadParticipant } from "@/lib/participant-server";
import { readSession } from "@/lib/session-server";

/** Un checkout es de una sesion concreta: nunca se prerenderiza. */
export const dynamic = "force-dynamic";

/**
 * Checkout.
 *
 * TRES COMPROBACIONES ANTES DE ENSENAR EL FORMULARIO, y las tres son estados de
 * pantalla y no errores:
 *
 * 1. Sin sesion -> se pide la cuenta (crearla o iniciarla), con vuelta a esta
 *    misma pagina. Un pedido pertenece a una cuenta. DEC-079: el visitante ve a
 *    la vez su carrito y su total, y al volver el carrito ya es de la cuenta.
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
  const tEligibility = await getTranslations("eligibility");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    // DEC-079: el visitante sin cuenta llega aqui con SU carrito (sesion de
    // carrito). Se le pide la cuenta para pagar, y a la vez se le ensena lo que
    // va a pagar: pedir una cuenta sin decir por cuanto es lo que hace que la
    // gente se vaya. Al volver del alta o del login, el carrito ya es de la
    // cuenta (lo pasa la API) y esta misma pagina sigue con el pago.
    const guestCart = await fetchCart(locale, await readSession());
    const hasLines = guestCart.ok && guestCart.data.lines.length > 0;

    return (
      <CheckoutShell title={t("title")}>
        {hasLines ? (
          <div className="grid gap-s6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <AccountRequired />
            <aside className="flex flex-col gap-s4">
              <OrderSummary cart={guestCart.data} locale={locale} />
            </aside>
          </div>
        ) : (
          <SignInRequired returnPath="/checkout" />
        )}
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

  // DEC-067: si la promocion comprueba edad o estado y la cuenta no los ha
  // declarado, se piden ANTES de cobrar. Si alguna de las dos lecturas falla no
  // se bloquea el pago: el backend vuelve a comprobarlo al otorgar.
  const [configResult, eligibilityResult] = await Promise.all([
    fetchSiteConfig(locale),
    fetchMyEligibility(locale, session),
  ]);
  const flags = configResult.ok ? toFeatureFlags(configResult.data) : null;
  const checksEligibility =
    flags !== null &&
    (isFeatureEnabled(flags, "age_gate_enabled") ||
      isFeatureEnabled(flags, "state_eligibility_enforcement_enabled"));
  const needsDeclaration =
    checksEligibility && eligibilityResult.ok && !eligibilityResult.data.declared;
  const requiredConsents = configResult.ok ? (configResult.data.required_consents ?? []) : [];

  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : "UTC";

  return (
    <CheckoutShell title={t("title")} intro={t("intro")}>
      <div className="grid gap-s6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {needsDeclaration ? (
          <section aria-labelledby="checkout-eligibility">
            <h2 id="checkout-eligibility" className="lsw-display text-heading-lg text-text">
              {tEligibility("title")}
            </h2>

            <div className="mt-s5">
              <EligibilityDeclarationForm locale={locale} consents={requiredConsents} />
            </div>
          </section>
        ) : (
          // DEC-078: el formulario abre con la forma de pago -tarjeta o efectivo
          // en un punto de venta- y sigue con la direccion; los dos titulos
          // viven dentro de el, en el orden en que se rellenan.
          <section aria-label={t("title")}>
            <CheckoutForm locale={locale} cashDelivery={cashDeliveryOf(cartResult.data, locale)} />
          </section>
        )}

        <aside className="flex flex-col gap-s4">
          <OrderSummary cart={cartResult.data} locale={locale} />

          <EntryQuotePanel quote={quote} locale={locale} timeZone={timeZone} />

          <p className="text-caption text-text-subtle">{t("entriesNote")}</p>
        </aside>
      </div>
    </CheckoutShell>
  );
}

/**
 * DEC-079: cuanto se paga en efectivo segun se recoja o se envie, con las
 * cifras de la API formateadas. `null` si el carrito no lleva mercancia (solo
 * paquetes): no hay nada que recoger ni que enviar.
 *
 * Recogerlo cuesta el SUBTOTAL: es lo que cobra el backend cuando no hay envio
 * (y no hay impuestos, pendiente legal). Enviarlo cuesta el TOTAL del carrito,
 * que ya lleva el envio. Ninguna de las dos cifras se suma aqui.
 */
function cashDeliveryOf(cart: CartWithQuote, locale: Locale): CashDeliveryOptions | null {
  if (cart.shipping.status === "NOT_REQUIRED" || cart.subtotal === null) return null;

  const pickupTotal = formatMoney(cart.subtotal, locale);
  if (pickupTotal === null) return null;

  const shipping = cart.shipping.amount === null ? null : formatMoney(cart.shipping.amount, locale);
  const total = cart.total === null ? null : formatMoney(cart.total, locale);

  return {
    pickupTotal,
    delivery:
      cart.shipping.status === "CHARGED" && shipping !== null && total !== null
        ? { shipping, total }
        : null,
  };
}

/**
 * Lo que se va a pagar: lineas, y subtotal, envio y total (DEC-079).
 *
 * Lo comparten el checkout con cuenta y el del visitante sin cuenta. Ninguna
 * cifra se calcula aqui: el subtotal de linea, el envio y el total llegan
 * calculados por el backend.
 */
async function OrderSummary({
  cart,
  locale,
}: {
  readonly cart: CartWithQuote;
  readonly locale: Locale;
}) {
  const t = await getTranslations("checkout");

  return (
    <Card elevation="raised" padding="md">
      <CardTitle as="h2" size="sm">
        {t("reviewHeading")}
      </CardTitle>

      <ul className="mt-s4 flex list-none flex-col gap-s3">
        {cart.lines.map((line) => (
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

      <div className="mt-s4 border-t border-border pt-s3">
        <CartTotals cart={cart} locale={locale} />
      </div>

      {/* DEC-079: el total de arriba es el de envio a domicilio. Quien paga en
          efectivo y lo recoge no paga el envio, y tiene que saberlo antes de
          elegir. */}
      {cart.shipping.status === "NOT_REQUIRED" ? null : (
        <p className="mt-s3 text-caption text-text-subtle">{t("pickupNote")}</p>
      )}

      <div className="mt-s4">
        <Link href="/cart" className="text-body-sm text-text-muted underline underline-offset-4">
          {t("backToCart")}
        </Link>
      </div>
    </Card>
  );
}

/**
 * DEC-079: el visitante sin cuenta, en el paso de pagar.
 *
 * Crear cuenta va PRIMERO: quien llega aqui sin sesion lo mas probable es que
 * no la tenga. Las dos salidas llevan `?next=/checkout`, y al volver el carrito
 * ya es de la cuenta: lo pasa la API al registrarse o iniciar sesion.
 */
async function AccountRequired() {
  const t = await getTranslations("checkout.accountRequired");
  const query = `?next=${encodeURIComponent("/checkout")}`;

  return (
    <section aria-labelledby="checkout-account-required">
      <h2 id="checkout-account-required" className="lsw-display text-heading-lg text-text">
        {t("title")}
      </h2>
      <p className="mt-s3 max-w-[40rem] text-body text-text-muted">{t("body")}</p>

      <div className="mt-s6 flex flex-col gap-s3 sm:flex-row sm:flex-wrap">
        <Link
          href={`/account/register${query}`}
          className={buttonVariants({ variant: "accent", size: "lg" })}
        >
          {t("register")}
        </Link>
        <Link
          href={`/account/login${query}`}
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          {t("signIn")}
        </Link>
      </div>
    </section>
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
