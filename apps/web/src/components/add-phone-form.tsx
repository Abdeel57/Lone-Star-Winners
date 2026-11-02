"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { startAddPhoneAction, verifyAddPhoneAction } from "@/lib/account-actions";

import { FormError, LocaleField, useFieldError } from "./auth-form-shell";
import { TurnstileWidget } from "./turnstile-widget";

/**
 * Anadir el celular de ACCESO a una cuenta que entro con correo (DEC-097).
 *
 * POR QUE EXISTE
 * --------------
 * Antes de DEC-089 la cuenta se creaba con correo. Si esa persona intenta
 * entrar hoy con su celular, el sistema no la reconoce y le crea una cuenta
 * nueva y vacia, sin sus participaciones. Con el celular ya guardado aqui,
 * entrar con el la lleva a ESTA cuenta.
 *
 * DOS PASOS, COMO EL CODIGO PARA ENTRAR
 * -------------------------------------
 * 1. El numero, con la comprobacion anti-bots: cada SMS se paga.
 * 2. El codigo. `one-time-code` deja que el telefono lo rellene desde el SMS.
 *
 * El numero no se guarda hasta acertar el codigo: es lo que demuestra que es
 * suyo. Al guardarlo, la accion refresca la pagina y esta tarjeta deja sitio al
 * numero ya guardado.
 */
export function AddPhoneForm({ locale }: { readonly locale: Locale }) {
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");

  // Estables a proposito, como en `SignInFlow`: los pasos las usan en efectos,
  // y una funcion nueva en cada tecla reiniciaria el anti-bots tras un error.
  const toCode = useCallback(() => {
    setStep("code");
  }, []);
  const toPhone = useCallback(() => {
    setStep("phone");
  }, []);

  if (step === "phone") {
    return <PhoneStep locale={locale} phone={phone} onPhoneChange={setPhone} onSent={toCode} />;
  }

  return <CodeStep locale={locale} phone={phone} onChangeNumber={toPhone} />;
}

function PhoneStep({
  locale,
  phone,
  onPhoneChange,
  onSent,
}: {
  readonly locale: Locale;
  readonly phone: string;
  readonly onPhoneChange: (next: string) => void;
  readonly onSent: () => void;
}) {
  const t = useTranslations("account.profile");
  const tCode = useTranslations("auth.code");
  const tFields = useTranslations("auth.fields");
  const [state, formAction, pending] = useActionState(startAddPhoneAction, IDLE);
  const [resetSignal, setResetSignal] = useState(0);
  const fieldError = useFieldError(state);

  useEffect(() => {
    if (state.status === "idle") return;
    // El token anti-bots sirve una vez: se renueva tras cada envio.
    setResetSignal((current) => current + 1);
    if (state.status === "ok") onSent();
  }, [state, onSent]);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />

      <p className="text-body-sm text-text-muted">{t("phoneIntro")}</p>

      <FormError result={state} />

      <FormField
        label={tFields("phone")}
        description={tCode("contactHint")}
        required
        requiredHint={tFields("requiredHint")}
        error={fieldError("phone")}
      >
        <Input
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => {
            onPhoneChange(event.target.value);
          }}
        />
      </FormField>

      <p className="text-body-sm text-text-muted">{tCode("smsDisclosure")}</p>

      <TurnstileWidget locale={locale} resetSignal={resetSignal} />

      <Button type="submit" variant="accent" size="lg" loading={pending}>
        {t("phoneSend")}
      </Button>
    </form>
  );
}

function CodeStep({
  locale,
  phone,
  onChangeNumber,
}: {
  readonly locale: Locale;
  readonly phone: string;
  readonly onChangeNumber: () => void;
}) {
  const t = useTranslations("account.profile");
  const tCode = useTranslations("auth.code");
  const tFields = useTranslations("auth.fields");
  const [verifyState, verifyAction, verifying] = useActionState(verifyAddPhoneAction, IDLE);
  const [resendState, resendAction, resending] = useActionState(startAddPhoneAction, IDLE);
  const [resetSignal, setResetSignal] = useState(0);
  const fieldError = useFieldError(verifyState);

  useEffect(() => {
    if (resendState.status === "idle") return;
    setResetSignal((current) => current + 1);
  }, [resendState]);

  if (verifyState.status === "ok") {
    return <Alert tone="success">{t("phoneAdded")}</Alert>;
  }

  return (
    <div className="flex flex-col gap-s5">
      <Alert tone="success" title={tCode("sentSmsTitle")}>
        {tCode("sentSmsBody", { contact: phone })}
      </Alert>

      <form action={verifyAction} className="flex flex-col gap-s5">
        <LocaleField locale={locale} />
        <input type="hidden" name="phone" value={phone} />

        <FormError result={verifyState} />

        <FormField
          label={tCode("codeLabel")}
          description={tCode("codeHint")}
          required
          requiredHint={tFields("requiredHint")}
          error={fieldError("code")}
        >
          <Input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" />
        </FormField>

        <Button type="submit" variant="accent" size="lg" loading={verifying}>
          {t("phoneSave")}
        </Button>
      </form>

      <form action={resendAction} className="flex flex-col gap-s3">
        <LocaleField locale={locale} />
        <input type="hidden" name="phone" value={phone} />

        {resendState.status === "ok" ? (
          <p role="status" className="text-body-sm text-text-muted">
            {tCode("resent")}
          </p>
        ) : null}
        <FormError result={resendState} />

        <TurnstileWidget locale={locale} resetSignal={resetSignal} />

        <Button type="submit" variant="secondary" loading={resending}>
          {tCode("resend")}
        </Button>
      </form>

      <Button type="button" variant="ghost" onClick={onChangeNumber}>
        {t("phoneChange")}
      </Button>
    </div>
  );
}
