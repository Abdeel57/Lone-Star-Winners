"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { setShippingRateAction } from "@/lib/admin/shipping-actions";

/**
 * Formulario de la tarifa fija de envio (DEC-079).
 *
 * La server action se pasa TAL CUAL a `useActionState`: el formulario se envia
 * aunque la pagina no haya hidratado. El importe se teclea con decimales y se
 * convierte en servidor; el cero se rechaza junto al campo.
 */
export function ShippingRateForm({
  locale,
  currency,
  defaultAmount,
}: {
  readonly locale: Locale;
  /** Moneda de la tarifa: la de la vigente, o la de la tienda si no hay. */
  readonly currency: string;
  /** Importe vigente ya formateado sin simbolo ("7.99"), o vacio. */
  readonly defaultAmount: string;
}) {
  const t = useTranslations("admin.shipping");
  const [state, formAction, pending] = useActionState(setShippingRateAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="currency" value={currency} />

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      <FormField
        label={t("amountLabel")}
        description={t("amountHint")}
        required
        error={fieldError("amount")}
        className="max-w-[16rem]"
      >
        <Input name="amount" inputMode="decimal" required defaultValue={defaultAmount} />
      </FormField>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("save")}
      </Button>
    </form>
  );
}
