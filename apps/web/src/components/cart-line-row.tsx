import { Alert, Button, Card, Input, VisuallyHidden } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { useIneligibilityReason } from "@/i18n/storefront-labels";
import { pickLocalized, type CartLine } from "@/lib/api";
import { removeCartItemFormAction, updateCartItemFormAction } from "@/lib/cart-actions";

import { AvailabilityBadge } from "./availability-badge";

/**
 * Una linea del carrito.
 *
 * PINTA EXACTAMENTE LO QUE EL CONTRATO PUBLICA, NI UN CAMPO MAS
 * ------------------------------------------------------------
 * `docs/API_CONTRACT.md` seccion 5 publica por linea: `id`, `variant_id`,
 * `product_slug`, `sku`, `name`, `quantity`, `unit_price`, `line_subtotal`,
 * `image_url` y `availability`. Los dos ultimos los publico HO-017 y esta fila
 * los llevaba degradados a proposito desde que HO-034 encontro que no existian.
 *
 * LA DISPONIBILIDAD YA SE DICE, Y DICE LO QUE DICE EL CONTRATO
 * -----------------------------------------------------------
 * `availability.status` compara el stock de la variante con LA CANTIDAD DE ESTA
 * LINEA, no con el articulo. De ahi tres decisiones de esta fila:
 *
 *   - `OUT_OF_STOCK` NO se traduce como "agotado". Significa "esta cantidad no
 *     se puede servir hoy", que puede querer decir "quedan tres y pediste
 *     cinco", y por eso ademas de la insignia hay una frase que lo dice.
 *   - Ningun texto promete unidades. La cantidad exacta de existencias no
 *     viaja (HO-017 pidio expresamente que no se publicara), asi que "quedan
 *     pocas" se puede decir y "quedan tres" no.
 *   - `OUT_OF_STOCK` NO bloquea nada aqui: ni la linea, ni los formularios, ni
 *     la cotizacion. La elegibilidad de la mercancia que no se puede entregar
 *     es una pregunta legal ABIERTA (`docs/LEGAL_PENDING.md`), y una interfaz
 *     que descontara esa linea estaria respondiendola por su cuenta. Lo que si
 *     bloquea es un `PATCH` que pida esa cantidad, y eso lo dice el backend con
 *     `409 INSUFFICIENT_STOCK`, que la pagina traduce arriba del todo.
 *
 * SIGUE SIN HABER IMAGEN, Y AHORA SE SABE POR QUE
 * -----------------------------------------------
 * `image_url` se consume -esta en el tipo y llega a este componente- y no se
 * pinta. El contrato dice que HOY ES SIEMPRE `null`: el esquema no tiene
 * ninguna tabla de medios. Un marco vacio en todas las lineas de todos los
 * carritos no seria un hueco a la espera de una foto, seria el aspecto
 * permanente del carrito, y en una lista densa se lee como una foto rota.
 *
 * El marcador de posicion de `ProductCard` no es un precedente para esto: alli
 * la imagen ES la tarjeta y el hueco mantiene la rejilla alineada. Aqui la
 * linea es texto, y reservar una columna de imagen a 360px le quita sitio a lo
 * unico que distingue dos lineas, que es el nombre y el SKU. Cuando exista
 * modelo de medios, la imagen entra aqui con `MediaFrame` como en la tienda.
 *
 * TODAS LAS CIFRAS VIENEN DEL SERVIDOR
 * ------------------------------------
 * `unit_price`, `quantity` y `line_subtotal` se PINTAN. El subtotal de linea no
 * se calcula aqui multiplicando los dos primeros: si el backend aplicara un
 * descuento, un redondeo o un precio distinto al de catalogo, una multiplicacion
 * hecha en el navegador mostraria una cifra que no coincide con la que se va a
 * cobrar. Y en un producto donde el subtotal elegible determina participaciones,
 * esa discrepancia no es cosmetica.
 *
 * EL SKU NO ES DECORACION
 * -----------------------
 * `name` es el nombre del PRODUCTO; el contrato no publica el de la variante.
 * Dos lineas del mismo producto en tallas distintas se leerian identicas sin el
 * SKU, que es lo unico que hoy las distingue. Es tambien lo que soporte necesita
 * para casar una linea con un pedido.
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
 * `id` es la misma identidad en el carrito y en la cotizacion, y eso permite
 * decir QUE articulo no cuenta en vez de dar el aviso a nivel de carrito entero.
 * El motivo llega como `reason_key` y el texto es del frontend.
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
  const ineligibilityReason = useIneligibilityReason();

  const productName = pickLocalized(line.name, locale);
  const unitPrice = formatMoney(line.unit_price, locale);
  const lineSubtotal = formatMoney(line.line_subtotal, locale);

  return (
    <Card as="li" elevation="flat" className="flex flex-col gap-4">
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
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-mono text-body-sm text-text-muted">{line.sku}</p>
            <AvailabilityBadge status={line.availability.status} />
          </div>

          {/* La insignia sola diria "existencias insuficientes" y quien la lea
              entenderia "se acabo". Esta frase es lo que separa las dos cosas, y
              es literalmente lo que dice el contrato: la cantidad no se puede
              servir HOY. No se ofrece un numero porque no viaja ninguno. */}
          {line.availability.status === "OUT_OF_STOCK" ? (
            <p className="mt-s2 text-caption text-text-subtle">{t("outOfStockNote")}</p>
          ) : null}
        </div>

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

          {lineSubtotal === null ? null : (
            <div className="flex gap-2">
              <dt className="text-text-muted">{t("lineSubtotal")}</dt>
              <dd className="font-semibold text-text">{lineSubtotal}</dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap items-end gap-3">
          <form action={updateCartItemFormAction} className="flex items-end gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="line_id" value={line.id} />

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`quantity-${line.id}`} className="text-label font-medium text-text">
                {t("quantityLabel")}
                <VisuallyHidden> {productName}</VisuallyHidden>
              </label>
              <Input
                id={`quantity-${line.id}`}
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
            <input type="hidden" name="line_id" value={line.id} />

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
