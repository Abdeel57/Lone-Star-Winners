import { Alert, Badge, Button, Card, Input, MediaFrame, VisuallyHidden } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { useAvailabilityLabel, useIneligibilityReason } from "@/i18n/storefront-labels";
import { pickLocalized, type CartLine } from "@/lib/api";
import { removeCartItemFormAction, updateCartItemFormAction } from "@/lib/cart-actions";

/**
 * Una linea del carrito.
 *
 * TODAS LAS CIFRAS VIENEN DEL SERVIDOR
 * ------------------------------------
 * `unit_price`, `quantity` y `line_total` se PINTAN. El total de linea no se
 * calcula aqui multiplicando los dos primeros: si el backend aplicara un
 * descuento, un redondeo o un precio distinto al de catalogo, una multiplicacion
 * hecha en el navegador mostraria una cifra que no coincide con la que se va a
 * cobrar. Y en un producto donde el subtotal elegible determina participaciones,
 * esa discrepancia no es cosmetica.
 *
 * DOS FORMULARIOS, NO UNO
 * -----------------------
 * Cambiar cantidad y quitar son acciones distintas con consecuencias distintas.
 * Un solo formulario con dos botones de envio obligaria a distinguirlos por el
 * `name` del boton, que es justo lo que deja de funcionar cuando el envio lo
 * dispara el teclado y no el raton.
 *
 * LA NO ELEGIBILIDAD SE DICE EN LA LINEA
 * --------------------------------------
 * `line_id` es la misma identidad en el carrito y en la cotizacion, y eso
 * permite decir QUE articulo no cuenta en vez de dar el aviso a nivel de
 * carrito entero. El motivo llega como `reason_key` y el texto es del frontend.
 */
export function CartLineRow({
  line,
  locale,
  ineligibleReasonKey,
}: {
  readonly line: CartLine;
  readonly locale: Locale;
  /**
   * Motivo por el que la cotizacion excluyo esta linea, o `null` si cuenta (o
   * si no hay cotizacion). No lo decide este componente: llega de la cotizacion
   * del backend.
   */
  readonly ineligibleReasonKey: string | null;
}) {
  const t = useTranslations("cart");
  const availabilityLabel = useAvailabilityLabel();
  const ineligibilityReason = useIneligibilityReason();

  const productName = pickLocalized(line.product_name, locale);
  const variantName = pickLocalized(line.variant_name, locale);
  const unitPrice = formatMoney(line.unit_price, locale);
  const lineTotal = formatMoney(line.line_total, locale);

  const unavailable = line.availability === "OUT_OF_STOCK" || line.availability === "UNAVAILABLE";

  return (
    <Card as="li" elevation="flat" className="flex flex-col gap-4 sm:flex-row">
      <div className="w-full shrink-0 sm:w-32">
        <MediaFrame className="lsw-studio border border-border">
          {line.image_url === null ? null : (
            // Ver `product-card.tsx`: faltan dominios de imagen en `next.config`.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.image_url} alt="" loading="lazy" />
          )}
        </MediaFrame>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        <div>
          <h3 className="lsw-display text-heading-sm text-text">
            <Link
              href={`/products/${line.product_slug}`}
              className="rounded-md underline underline-offset-4 transition-colors duration-fast ease-standard hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {productName}
            </Link>
          </h3>
          <p className="mt-1 text-body-sm text-text-muted">{variantName}</p>
        </div>

        {unavailable ? (
          <Alert tone="warning">{t("quantityUnavailable")}</Alert>
        ) : line.availability === "LOW_STOCK" ? (
          <Badge tone="warning" size="sm">
            {availabilityLabel(line.availability)}
          </Badge>
        ) : null}

        {ineligibleReasonKey === null ? null : (
          <Alert tone="info">{ineligibilityReason(ineligibleReasonKey)}</Alert>
        )}

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
          {unitPrice === null ? null : (
            <div className="flex gap-2">
              <dt className="text-text-muted">{t("unitPrice")}</dt>
              <dd className="font-medium text-text">{unitPrice}</dd>
            </div>
          )}

          {lineTotal === null ? null : (
            <div className="flex gap-2">
              <dt className="text-text-muted">{t("lineTotal")}</dt>
              <dd className="font-semibold text-text">{lineTotal}</dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap items-end gap-3">
          <form action={updateCartItemFormAction} className="flex items-end gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="line_id" value={line.line_id} />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`quantity-${line.line_id}`}
                className="text-label font-medium text-text"
              >
                {t("quantityLabel")}
                <VisuallyHidden> {productName}</VisuallyHidden>
              </label>
              <Input
                id={`quantity-${line.line_id}`}
                name="quantity"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                defaultValue={line.quantity}
                className="w-24"
              />
            </div>

            <Button type="submit" variant="secondary">
              {t("update")}
            </Button>
          </form>

          <form action={removeCartItemFormAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="line_id" value={line.line_id} />

            <Button type="submit" variant="ghost">
              {t("remove")}
              <VisuallyHidden> {productName}</VisuallyHidden>
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
