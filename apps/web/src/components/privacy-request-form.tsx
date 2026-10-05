"use client";

import { Alert, Button, Checkbox, FormField, Input, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { PRIVACY_REQUEST_TYPES } from "@/legal/privacy-request-types";
import { IDLE } from "@/lib/action-result";
import { submitPrivacyRequestAction } from "@/lib/privacy-actions";

import { EmailField, FormError, LocaleField, useFieldError } from "./auth-form-shell";
import { TurnstileWidget } from "./turnstile-widget";

/**
 * Formulario de `/privacychoices` (DEC-063).
 *
 * Pide lo minimo para que una persona pueda localizar los datos y contestar:
 * que quiere, quien es, como contactarla y en que estado vive -los derechos
 * dependen del estado-. No decide nada: la solicitud va al buzon del negocio y
 * la atiende una persona, que es lo que describe la Politica de Privacidad.
 */
export function PrivacyRequestForm({ locale }: { readonly locale: Locale }) {
  const t = useTranslations("legal.privacyChoices");
  const tFields = useTranslations("auth.fields");
  const [state, formAction, pending] = useActionState(submitPrivacyRequestAction, IDLE);
  const fieldError = useFieldError(state);
  const [resetSignal, setResetSignal] = useState(0);

  // El token de Turnstile vale una vez: tras cada envio fallido hay que pedir otro.
  useEffect(() => {
    if (state.status === "error") setResetSignal((current) => current + 1);
  }, [state]);

  if (state.status === "ok") {
    return (
      <Alert tone="success" title={t("sentTitle")}>
        {t("sentBody", { reference: state.detail ?? "" })}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <FormError result={state} />

      <FormField
        label={t("requestType")}
        required
        requiredHint={tFields("requiredHint")}
        error={fieldError("request_type")}
      >
        <Select name="request_type" required defaultValue="">
          <option value="" disabled>
            {t("requestTypePlaceholder")}
          </option>
          {PRIVACY_REQUEST_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`types.${type}`)}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={t("fullName")}
        required
        requiredHint={tFields("requiredHint")}
        error={fieldError("full_name")}
      >
        <Input name="full_name" autoComplete="name" maxLength={200} required />
      </FormField>

      <EmailField result={state} />

      <FormField label={t("phone")}>
        <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} />
      </FormField>

      <FormField
        label={t("state")}
        required
        requiredHint={tFields("requiredHint")}
        error={fieldError("state")}
      >
        <Input name="state" autoComplete="address-level1" maxLength={60} required />
      </FormField>

      <FormField label={t("details")} description={t("detailsHint")}>
        <Textarea name="details" rows={5} maxLength={4000} />
      </FormField>

      <Checkbox name="authorized_agent" label={t("authorizedAgent")} />

      <TurnstileWidget locale={locale} resetSignal={resetSignal} />

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
