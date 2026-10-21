"use client";

import { cn, FOCUS_VISIBLE_CLASSES } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useId } from "react";

import type { FulfillmentMethod, PaymentMethod } from "@/lib/api";

/**
 * Lo que se paga en cada forma de recibir un pedido, YA FORMATEADO por la
 * pagina con cifras de la API. Aqui no se suma nada. Es lo mismo en efectivo y
 * con tarjeta (DEC-091): recogiendo no hay envio.
 */
export interface CashDeliveryOptions {
  /** Recogiendolo: el subtotal del carrito, que es lo que cobra el backend (sin envio). */
  readonly pickupTotal: string;
  /** Enviandolo: envio y total con envio; `null` si todavia no hay tarifa. */
  readonly delivery: { readonly shipping: string; readonly total: string } | null;
}

/**
 * Como recibe su pedido quien compra (DEC-079, DEC-091).
 *
 * En efectivo el articulo se entrega en el mismo punto de venta donde se paga,
 * asi que RECOGERLO es la opcion por defecto y no lleva envio. Enviarlo a casa
 * es opcional y suma el envio. Cada tarjeta dice cuanto se paga, porque es lo
 * que cambia entre una y otra.
 *
 * DEC-091: con tarjeta tambien se puede recoger. Lo que cambia es el texto: en
 * efectivo se recoge donde se paga; con tarjeta se paga ahora y se pasa despues
 * por el pedido a un punto de venta fisico.
 *
 * Mismo patron que `PaymentMethodChoice`: radios nativos en un `fieldset`, la
 * tarjeta entera es la etiqueta. El valor viaja en el formulario y el servidor
 * lo compara contra la lista; el importe lo vuelve a calcular el backend.
 */
export function FulfillmentChoice({
  value,
  onChange,
  options,
  paymentMethod,
}: {
  readonly value: FulfillmentMethod;
  readonly onChange: (method: FulfillmentMethod) => void;
  readonly options: CashDeliveryOptions;
  readonly paymentMethod: PaymentMethod;
}) {
  const t = useTranslations("checkout.fulfillment");
  const legendId = useId();
  const delivery = options.delivery;
  const card = paymentMethod === "CARD";

  const choices: readonly {
    readonly method: FulfillmentMethod;
    readonly icon: string;
    readonly title: string;
    readonly body: string;
    readonly disabled: boolean;
  }[] = [
    {
      method: "PICKUP",
      icon: "🏬",
      title: card ? t("pickup.cardTitle") : t("pickup.title"),
      body: card
        ? t("pickup.cardBody", { total: options.pickupTotal })
        : t("pickup.body", { total: options.pickupTotal }),
      disabled: false,
    },
    {
      method: "DELIVERY",
      icon: "📦",
      title: t("delivery.title"),
      body:
        delivery === null
          ? t("delivery.unavailable")
          : t("delivery.body", { shipping: delivery.shipping, total: delivery.total }),
      disabled: delivery === null,
    },
  ];

  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-s3 border-0 p-0">
      <legend id={legendId} className="lsw-display text-heading-md text-text">
        {t("heading")}
      </legend>

      <div className="grid gap-s3 sm:grid-cols-2">
        {choices.map(({ method, icon, title, body, disabled }) => (
          <label
            key={method}
            className={cn(
              "relative flex flex-col gap-s2 rounded-lg border bg-surface p-s4",
              "transition-colors duration-fast ease-standard",
              "has-[:checked]:border-brand has-[:checked]:bg-brand/10",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
              disabled
                ? "cursor-not-allowed border-border opacity-60"
                : "cursor-pointer border-border hover:border-border-strong",
            )}
          >
            <span className="flex items-center gap-s3">
              <input
                type="radio"
                name="fulfillment_method"
                value={method}
                checked={value === method}
                disabled={disabled}
                onChange={() => onChange(method)}
                className={cn("h-5 w-5 shrink-0 accent-brand", FOCUS_VISIBLE_CLASSES)}
              />
              <span aria-hidden="true" className="text-heading-md leading-none">
                {icon}
              </span>
              <span className="font-display text-heading-sm font-bold text-text">{title}</span>
            </span>

            <span className="pl-8 text-body-sm text-text-muted">{body}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
