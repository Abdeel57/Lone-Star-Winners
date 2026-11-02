"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Celular de CONTACTO de un cliente, desde la tarjeta "Cliente" (DEC-097).
 *
 * Para quien se dio de alta con correo y no tiene celular: sin el, la tarjeta
 * no ofrece WhatsApp ni SMS. Es solo contacto: no da acceso a la cuenta. El
 * celular con el que se entra lo anade el propio cliente desde su perfil, con
 * un codigo SMS.
 *
 * Sin celular, el formulario esta a la vista. Con celular, queda plegado bajo
 * "Cambiar": corregir un numero es raro y no debe competir con los botones de
 * escribirle.
 */
export function ContactPhoneForm({
  locale,
  participantId,
  hasPhone,
  action,
}: {
  readonly locale: Locale;
  readonly participantId: string;
  readonly hasPhone: boolean;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("admin.orderContact");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  const form = (
    <form action={formAction} className="flex flex-col gap-s3">
      <LocaleField locale={locale} />
      <input type="hidden" name="participant_id" value={participantId} />

      <FormField
        label={t("phoneFieldLabel")}
        description={t("phoneFieldHint")}
        error={fieldError("phone")}
      >
        <Input name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={32} />
      </FormField>

      <Button
        type="submit"
        variant="secondary"
        size="md"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {hasPhone ? t("savePhone") : t("addPhone")}
      </Button>
    </form>
  );

  return (
    <div className="mt-s5 flex flex-col gap-s3">
      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("phoneSaved")}</Alert> : null}

      {hasPhone ? (
        <details>
          <summary className="cursor-pointer text-body-sm text-text-muted underline underline-offset-2">
            {t("changePhone")}
          </summary>
          <div className="mt-s3">{form}</div>
        </details>
      ) : (
        <>
          <p className="text-body-sm text-text-muted">{t("noPhoneIntro")}</p>
          {form}
        </>
      )}
    </div>
  );
}
