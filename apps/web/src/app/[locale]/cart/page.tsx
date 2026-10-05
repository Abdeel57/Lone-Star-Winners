import { Alert, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState, useApiErrorMessage } from "@/components/api-error-state";
import { CartLineRow } from "@/components/cart-line-row";
import { CartSummaryMeta } from "@/components/cart-summary-meta";
import { CartTotals } from "@/components/cart-totals";
import { EntryQuotePanel } from "@/components/entry-quote-panel";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchCart } from "@/lib/api";
import { loadSession } from "@/lib/participant-server";
import { readSession } from "@/lib/session-server";

/**
 * Render por peticion, siempre.
 *
 * Un carrito es, por definicion, de una sesion concreta. Prerenderizarlo
 * serviria el carrito de la primera persona que cargo la pagina a todas las
 * demas, y ademas congelaria la cotizacion de participaciones.
 */
export const dynamic = "force-dynamic";

/**
 * Carrito.
 *
 * EL CARRITO VIVE EN EL SERVIDOR (DEC-023)
 * ----------------------------------------
 * Esta pagina no posee el carrito: lo refleja. No hay estado de carrito en el
 * cliente, no hay `localStorage`, y las mutaciones son Server Actions que
 * vuelven a pedir el carrito al backend.
 *
 * La razon esta escrita en el propio contrato: la cotizacion de entries se
 * calcula sobre el carrito DEL SERVIDOR, nunca sobre una lista de items que
 * mande el cliente. En un producto donde una cifra mal calculada es un problema
 * legal, la traza de que se cotizo y cuando vale mas que la comodidad de
 * mantener el carrito en memoria.
 *
 * NINGUNA CIFRA SE CALCULA AQUI
 * -----------------------------
 * Ni el subtotal, ni los totales de linea, ni por supuesto las
 * participaciones. Todo llega calculado y esta pagina lo pinta.
 *
 * EL FALLO DE UNA MUTACION LLEGA POR LA URL
 * -----------------------------------------
 * `?error=CODE`. Es el unico canal que sobrevive a una navegacion completa y
 * funciona sin JavaScript. "He pulsado Actualizar y no ha pasado nada" es peor
 * que un mensaje de error: deja a alguien creyendo que su carrito dice algo que
 * no dice.
 */
export default async function CartPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const query = await searchParams;
  const errorCode = typeof query.error === "string" && query.error.length > 0 ? query.error : null;

  const session = await readSession();

  // La zona legal contra la que se formatea el instante de la cotizacion sale
  // de la promocion, no del navegador (DEC-011). Las lecturas van en paralelo:
  // ninguna depende de otra. `loadSession` solo sirve para saber si quien mira
  // tiene cuenta (DEC-079): sin cookie no sale a la red.
  const [cartResult, promotionResult, account] = await Promise.all([
    fetchCart(locale, session),
    fetchActivePromotion(locale),
    loadSession(locale),
  ]);

  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : null;

  // DEC-079: sin cuenta se llena el carrito; la cuenta se pide al pagar.
  const isGuest = account.state.kind !== "active";
  // Con mercancia y sin tarifa de envio puesta, enviar a domicilio responde
  // 409. Pagar sigue siendo posible -en efectivo, recogiendolo en el punto de
  // venta-, asi que el boton se queda y se avisa de lo que no esta disponible.
  const shippingPending = cartResult.ok && cartResult.data.shipping.status === "NOT_CONFIGURED";

  return (
    <div className="lsw-container py-s10 pb-s16">
      <h1 className="lsw-headline text-display-md text-text sm:text-display-lg">
        {t("cart.title")}
      </h1>
      <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

      {/* CUANTA MERCANCIA HAY Y CUANDO CAMBIO, JUNTO AL TITULO.

          Solo con lineas. En el carrito vacio, "0 articulos" debajo de "Tu
          carrito esta vacio" repite lo que ya dice el estado vacio, y la fecha
          de ultima actualizacion es `null` por contrato -no hay fila de
          carrito-, de modo que no habria nada que fechar.

          La zona horaria es la LEGAL de la promocion, la misma con la que se
          formatea el instante de la cotizacion: pintar los dos instantes del
          mismo carrito en dos relojes distintos invitaria a compararlos mal
          (DEC-011). Sin promocion abierta, UTC explicito. */}
      {cartResult.ok && cartResult.data.lines.length > 0 ? (
        <CartSummaryMeta
          itemCount={cartResult.data.item_count}
          updatedAt={cartResult.data.updated_at}
          locale={locale}
          timeZone={timeZone ?? "UTC"}
        />
      ) : null}

      {errorCode === null ? null : (
        <div className="mt-s5">
          <CartActionError code={errorCode} />
        </div>
      )}

      {/* DEC-079: un visitante SIN cuenta tiene carrito. Ya no hay rama de
          "inicia sesion para ver tu carrito": la cuenta se pide al pagar, y
          cualquier fallo de lectura es un fallo de verdad. */}
      {!cartResult.ok ? (
        <div className="mt-s8">
          <ApiErrorState failure={cartResult.error} headingLevel="h2" />
        </div>
      ) : cartResult.data.lines.length === 0 ? (
        <div className="mt-s8">
          <EmptyState
            headingLevel="h2"
            title={t("cart.empty.title")}
            description={t("cart.empty.body")}
            action={
              <Link href="/shop" className={buttonVariants({ variant: "primary" })}>
                {t("cart.continueShopping")}
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-s8 grid gap-s6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="cart-items">
            <h2 id="cart-items" className="lsw-display text-heading-lg text-text">
              {t("cart.itemsHeading")}
            </h2>

            <ul className="mt-s5 flex list-none flex-col gap-s4">
              {cartResult.data.lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  locale={locale}
                  ineligibleReasonKey={
                    cartResult.data.entry_quote?.ineligible_items.find(
                      (item) => item.line_id === line.id,
                    )?.reason_key ?? null
                  }
                />
              ))}
            </ul>
          </section>

          <aside className="flex flex-col gap-4">
            <Card elevation="raised" padding="md">
              <CardTitle as="h2" size="sm">
                {t("cart.totals.heading")}
              </CardTitle>

              {/* DEC-079: subtotal, envio y total, los tres calculados por el
                  backend. `subtotal` es `null` en un carrito vacio y esta rama
                  solo se pinta con lineas; aun asi, sin subtotal no hay nada
                  que resumir. */}
              <div className="mt-s4">
                {cartResult.data.subtotal === null ? (
                  <p className="text-body text-text-muted">{t("cart.subtotalUnavailable")}</p>
                ) : (
                  <CartTotals cart={cartResult.data} locale={locale} />
                )}
              </div>

              {/* ROJO (DEC-042): es la accion de COMPRA de la pantalla. El oro
                  de esta columna se queda donde importa, en la cifra de
                  participaciones que pinta `EntryQuotePanel` justo debajo. */}
              <div className="mt-s5 flex flex-col gap-s3">
                {shippingPending ? (
                  <Alert tone="warning">{t("cart.totals.shippingNotConfigured")}</Alert>
                ) : null}

                <Link
                  href="/checkout"
                  className={buttonVariants({ variant: "accent", fullWidth: true })}
                >
                  {t("cart.checkout")}
                </Link>

                {/* DEC-079: sin cuenta se puede llenar el carrito; para pagar se
                    pide. Se avisa AQUI, antes del clic, para que pedir la cuenta
                    no parezca una sorpresa ni un error. */}
                {isGuest ? (
                  <p className="text-caption text-text-subtle">{t("cart.guestNote")}</p>
                ) : null}

                <Link
                  href="/shop"
                  className={buttonVariants({ variant: "ghost", fullWidth: true })}
                >
                  {t("cart.continueShopping")}
                </Link>
              </div>
            </Card>

            {/* Sin promocion abierta no hay zona legal declarada contra la que
                formatear el instante de la cotizacion. Se usa UTC explicito en
                vez de caer en la del navegador (DEC-011). */}
            <EntryQuotePanel
              quote={cartResult.data.entry_quote}
              locale={locale}
              timeZone={timeZone ?? "UTC"}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

/**
 * Fallo de la ultima mutacion, traducido.
 *
 * Usa el mismo mapa de codigos que el resto de la interfaz: el backend manda
 * un enum y el texto es del frontend (DEC-022, DEC-031). Un codigo desconocido
 * cae al generico y nunca aparece en crudo.
 */
function CartActionError({ code }: { readonly code: string }) {
  const t = useTranslations();
  const message = useApiErrorMessage();

  return (
    <Alert tone="danger" title={t("states.loadFailed.title")}>
      {message(code)}
    </Alert>
  );
}
