"use client";

import { cn, FOCUS_VISIBLE_CLASSES } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useId } from "react";

import type { PaymentMethod } from "@/lib/api";

/**
 * Las dos formas de pagar del checkout (DEC-078): tarjeta o efectivo en un
 * punto de venta fisico.
 *
 * DOS TARJETAS GRANDES Y NO UN DESPLEGABLE
 * ----------------------------------------
 * Las dos opciones tienen que verse a la vez y entenderse sin abrir nada: lo
 * que cambia entre una y otra no es un detalle, es CUANDO se paga y CUANDO
 * llegan las participaciones. Cada tarjeta lo dice en una frase.
 *
 * RADIOS NATIVOS DENTRO DE UN `fieldset`
 * --------------------------------------
 * El navegador ya da el patron completo -una parada de tabulacion, flechas,
 * leyenda del grupo- y funciona sin JavaScript. La tarjeta entera es la
 * etiqueta, asi que se pulsa en cualquier punto, que en un telefono importa.
 *
 * AQUI NO SE DECIDE NADA. El valor viaja en el formulario y el servidor lo
 * compara contra la lista; el efectivo tiene su propia ruta en el backend.
 */
export function PaymentMethodChoice({
  value,
  onChange,
}: {
  readonly value: PaymentMethod;
  readonly onChange: (method: PaymentMethod) => void;
}) {
  const t = useTranslations("checkout.payment");
  const legendId = useId();

  const options: readonly { readonly method: PaymentMethod; readonly icon: string }[] = [
    { method: "CARD", icon: "💳" },
    { method: "CASH", icon: "💵" },
  ];

  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-s3 border-0 p-0">
      <legend id={legendId} className="lsw-display text-heading-md text-text">
        {t("heading")}
      </legend>

      <div className="grid gap-s3 sm:grid-cols-2">
        {options.map(({ method, icon }) => {
          const key = method === "CARD" ? "card" : "cash";
          return (
            <label
              key={method}
              className={cn(
                "relative flex cursor-pointer flex-col gap-s2 rounded-lg border bg-surface p-s4",
                "transition-colors duration-fast ease-standard",
                "has-[:checked]:border-brand has-[:checked]:bg-brand/10",
                "border-border hover:border-border-strong",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
              )}
            >
              <span className="flex items-center gap-s3">
                <input
                  type="radio"
                  name="payment_method"
                  value={method}
                  checked={value === method}
                  onChange={() => onChange(method)}
                  className={cn("h-5 w-5 shrink-0 accent-brand", FOCUS_VISIBLE_CLASSES)}
                />
                <span aria-hidden="true" className="text-heading-md leading-none">
                  {icon}
                </span>
                <span className="font-display text-heading-sm font-bold text-text">
                  {t(`${key}.title`)}
                </span>
              </span>

              <span className="pl-8 text-body-sm text-text-muted">{t(`${key}.body`)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
