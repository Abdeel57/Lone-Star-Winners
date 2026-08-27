"use client";

import { Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { startCheckoutAction } from "@/lib/checkout-actions";

import { FormError, useFieldError } from "./auth-form-shell";

/**
 * Formulario de checkout.
 *
 * AQUI NO SE RECOGE NI UN DATO DE PAGO
 * ------------------------------------
 * Ni numero de tarjeta, ni caducidad, ni CVC. Lo que hay es una direccion de
 * envio; el cobro ocurre despues, fuera de este dominio, en la pantalla del
 * proveedor. Es la consecuencia directa de que el checkout sea un ADAPTADOR: el
 * backend responde COMO se cobra y la interfaz nunca es la que cobra.
 *
 * LOS CAMPOS NO LLEVAN NINGUNA REGLA DE JURISDICCION
 * --------------------------------------------------
 * `region` es un campo de texto libre y no un desplegable de estados. `country`
 * es un campo de texto y no una lista con un valor por defecto. Y no hay patron
 * de codigo postal. Los tres son la misma decision: la elegibilidad territorial
 * la fijan las Official Rules y sigue en `docs/LEGAL_PENDING.md`, asi que un
 * desplegable con la lista de estados admitidos seria una regla legal escrita
 * por el frontend (CLAUDE.md #2 y #14). Cuando el backend publique la lista, el
 * desplegable se pinta con SUS valores.
 *
 * Lo que si llevan es `autoComplete` con los tokens estandar, que es lo que
 * hace que un telefono rellene la direccion de una vez.
 *
 * EL CARRITO NO VIAJA EN ESTE FORMULARIO. Lo que se cobra sale del carrito de
 * servidor (DEC-023); si el cliente aportara las lineas, aportaria tambien los
 * precios.
 */
export function CheckoutForm({ locale }: { readonly locale: Locale }) {
  const t = useTranslations("checkout");
  const [state, formAction, pending] = useActionState(startCheckoutAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <input type="hidden" name="locale" value={locale} />

      <FormError result={state} />

      <FormField label={t("fields.fullName")} required error={fieldError("full_name")}>
        <Input name="full_name" type="text" autoComplete="shipping name" />
      </FormField>

      <FormField label={t("fields.line1")} required error={fieldError("line1")}>
        <Input name="line1" type="text" autoComplete="shipping address-line1" />
      </FormField>

      <FormField
        label={t("fields.line2")}
        description={t("fields.line2Hint")}
        error={fieldError("line2")}
      >
        <Input name="line2" type="text" autoComplete="shipping address-line2" />
      </FormField>

      <div className="grid gap-s5 sm:grid-cols-2">
        <FormField label={t("fields.city")} required error={fieldError("city")}>
          <Input name="city" type="text" autoComplete="shipping address-level2" />
        </FormField>

        <FormField label={t("fields.region")} required error={fieldError("region")}>
          <Input name="region" type="text" autoComplete="shipping address-level1" />
        </FormField>
      </div>

      <div className="grid gap-s5 sm:grid-cols-2">
        <FormField label={t("fields.postalCode")} required error={fieldError("postal_code")}>
          <Input
            name="postal_code"
            type="text"
            inputMode="text"
            autoComplete="shipping postal-code"
          />
        </FormField>

        <FormField label={t("fields.country")} required error={fieldError("country")}>
          <Input name="country" type="text" autoComplete="shipping country-name" />
        </FormField>
      </div>

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("payCta")}
      </Button>

      <p className="text-caption text-text-subtle">{t("providerNote")}</p>
    </form>
  );
}
