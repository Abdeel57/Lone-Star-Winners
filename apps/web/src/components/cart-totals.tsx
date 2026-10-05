import { useTranslations } from "next-intl";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
// La hoja y no el indice: el indice arrastra `http.ts`, que es de servidor.
import type { CartWithQuote } from "@/lib/api/contract";

/**
 * Subtotal, envio y total de un carrito (DEC-079).
 *
 * NINGUNA CIFRA SE CALCULA AQUI
 * -----------------------------
 * Ni el envio ni el total: los dos llegan calculados por el backend con la MISMA
 * regla con que se cobra al pagar. Sumar aqui subtotal y tarifa daria otra cifra
 * el dia que la regla cambie, y esa cifra seria la que la persona ve antes de
 * pagar.
 *
 * TRES ESTADOS DEL ENVIO, TRES TEXTOS
 * -----------------------------------
 * - `CHARGED`: el importe.
 * - `NOT_REQUIRED`: "No aplica". Solo paquetes de participaciones, que no se
 *   envian; decir "$0.00" sonaria a envio gratis, que no es lo que pasa.
 * - `NOT_CONFIGURED`: "Por confirmar", y sin total: un total sin el envio que se
 *   va a cobrar seria una cifra falsa. Quien pinta el boton de pagar lo bloquea.
 *
 * El envio no genera participaciones, y se dice junto a la cifra: es la pregunta
 * que alguien se hace al ver que el total sube.
 */
export function CartTotals({
  cart,
  locale,
}: {
  readonly cart: Pick<CartWithQuote, "subtotal" | "shipping" | "total">;
  readonly locale: Locale;
}) {
  const t = useTranslations("cart.totals");

  const shipping =
    cart.shipping.status === "CHARGED" && cart.shipping.amount !== null
      ? formatMoney(cart.shipping.amount, locale)
      : cart.shipping.status === "NOT_REQUIRED"
        ? t("shippingNotRequired")
        : t("shippingPending");

  return (
    <div>
      <dl className="flex flex-col gap-s2">
        <Row label={t("subtotal")}>
          {cart.subtotal === null ? "—" : formatMoney(cart.subtotal, locale)}
        </Row>
        <Row label={t("shipping")}>{shipping}</Row>
        <div className="mt-s1 flex items-baseline justify-between gap-s3 border-t border-border pt-s3">
          <dt className="text-body font-semibold text-text">{t("total")}</dt>
          <dd className="font-display text-display-sm font-bold tabular-nums text-text">
            {cart.total === null ? "—" : formatMoney(cart.total, locale)}
          </dd>
        </div>
      </dl>

      {cart.shipping.status === "CHARGED" ? (
        <p className="mt-s2 text-caption text-text-subtle">{t("shippingNoEntries")}</p>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-s3">
      <dt className="text-body-sm text-text-muted">{label}</dt>
      <dd className="text-body-sm tabular-nums text-text">{children}</dd>
    </div>
  );
}
