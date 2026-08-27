import { Alert, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState, useApiErrorMessage } from "@/components/api-error-state";
import { CartLineRow } from "@/components/cart-line-row";
import { EntryQuotePanel } from "@/components/entry-quote-panel";
import { formatMoney } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchActivePromotion, fetchCart } from "@/lib/api";
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
  // de la promocion, no del navegador (DEC-011). Las dos lecturas van en
  // paralelo: ninguna depende de la otra.
  const [cartResult, promotionResult] = await Promise.all([
    fetchCart(locale, session),
    fetchActivePromotion(locale),
  ]);

  const timeZone =
    promotionResult.ok && promotionResult.data !== null
      ? promotionResult.data.legal_timezone
      : null;

  return (
    <div className="lsw-container py-s10 pb-s16">
      <h1 className="lsw-display text-display-md text-text">{t("cart.title")}</h1>
      <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

      {errorCode === null ? null : (
        <div className="mt-s5">
          <CartActionError code={errorCode} />
        </div>
      )}

      {!cartResult.ok && cartResult.error.status === 401 ? (
        // UN 401 AQUI NO ES UN FALLO.
        //
        // Las cinco rutas de carrito son `PARTICIPANT_SELF` y la identidad la
        // resuelve `packages/security` (DEC-006, un unico sistema de sesion).
        // Hasta que ese puerto este conectado -y despues, para cualquier
        // visitante sin sesion- la respuesta legitima es "inicia sesion", no
        // una pantalla de error. Pintar aqui "algo ha fallado" mandaria a
        // soporte a alguien que solo tiene que entrar en su cuenta.
        <div className="mt-s8">
          <EmptyState
            headingLevel="h2"
            title={t("cart.signInRequired.title")}
            description={t("cart.signInRequired.body")}
            action={
              // Con vuelta al carrito. Mandar a alguien a la portada despues de
              // entrar le obliga a rehacer el camino hasta donde estaba, y el
              // sitio donde peor sienta eso es justo el paso anterior a pagar.
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/account/login?next=%2Fcart"
                  className={buttonVariants({ variant: "accent" })}
                >
                  {t("account.signInRequired.signIn")}
                </Link>
                <Link href="/shop" className={buttonVariants({ variant: "secondary" })}>
                  {t("cart.continueShopping")}
                </Link>
              </div>
            }
          />
        </div>
      ) : !cartResult.ok ? (
        <div className="mt-s8">
          <ApiErrorState failure={cartResult.error} headingLevel="h2" />
        </div>
      ) : cartResult.data.cart.items.length === 0 ? (
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
              {cartResult.data.cart.items.map((line) => (
                <CartLineRow
                  key={line.line_id}
                  line={line}
                  locale={locale}
                  ineligibleReasonKey={
                    cartResult.data.entry_quote?.ineligible_items.find(
                      (item) => item.line_id === line.line_id,
                    )?.reason_key ?? null
                  }
                />
              ))}
            </ul>
          </section>

          <aside className="flex flex-col gap-4">
            <Card elevation="raised" padding="md">
              <CardTitle as="h2" size="sm">
                {t("cart.subtotal")}
              </CardTitle>

              <p className="font-display mt-s2 text-display-md font-bold tabular-nums text-text">
                {formatMoney(cartResult.data.cart.subtotal, locale)}
              </p>

              <p className="mt-s2 text-caption text-text-subtle">{t("cart.subtotalNote")}</p>

              {/* ROJO (DEC-042): es la accion de COMPRA de la pantalla. El oro
                  de esta columna se queda donde importa, en la cifra de
                  participaciones que pinta `EntryQuotePanel` justo debajo. */}
              <div className="mt-s4 flex flex-col gap-s3">
                <Link
                  href="/checkout"
                  className={buttonVariants({ variant: "accent", fullWidth: true })}
                >
                  {t("cart.checkout")}
                </Link>

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
              cart={cartResult.data.cart}
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
