"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import type { ConsentRequirement } from "@/lib/api";
import { registerAction, sendPhoneCodeAction } from "@/lib/auth-actions";

import {
  ChannelSwitch,
  EmailField,
  FormError,
  LocaleField,
  NewPasswordFields,
  PhoneField,
  SmsCodeField,
  useFieldError,
  type AuthChannel,
} from "./auth-form-shell";
import { ConsentFieldset, EligibilityFields } from "./eligibility-fields";
import { TurnstileWidget } from "./turnstile-widget";

/**
 * Formulario de alta: con correo o con celular (DEC-060).
 *
 * FECHA DE NACIMIENTO Y ESTADO SE PREGUNTAN, NO SE JUZGAN (DEC-067)
 * -----------------------------------------------------------------
 * Las Official Rules definen al "Entrant" por edad y estado de residencia, y
 * para saber si una compra da participaciones hay que conocer las dos cosas.
 * Este formulario las recoge; NO decide nada con ellas -ni avisa de "no puedes
 * participar"- porque que edad y que estados cuentan lo fija cada edicion, y el
 * backend lo evalua al otorgar. Comprar mercancia esta permitido igualmente.
 *
 * LOS CONSENTIMIENTOS SON DATO, NO CODIGO
 * ---------------------------------------
 * Las casillas que se pintan llegan de `GET /config` (`required_consents`), con
 * su clave, su version y si son obligatorias: hoy, Reglas Oficiales, Terminos y
 * Privacidad (DEC-067). Si el backend no publicara ninguno no se pintaria
 * ninguna casilla: mejor ninguna que una inventada.
 *
 * La VERSION viaja de vuelta con cada consentimiento aceptado. "Acepto las
 * reglas" sin decir que version se acepto es una afirmacion sin fecha.
 *
 * CON CELULAR SON DOS PASOS
 * -------------------------
 * Primero se pide el codigo -con la comprobacion anti-bots, porque cada SMS se
 * paga- y despues se escribe junto con la contrasena. El aviso de que se enviara
 * un mensaje de texto esta pendiente de revision del abogado
 * (`docs/LEGAL_PENDING.md`, consentimiento del SMS).
 */
export function RegisterForm({
  locale,
  consents,
  returnPath,
  passwordMinimum = null,
}: {
  readonly locale: Locale;
  readonly consents: readonly ConsentRequirement[];
  readonly returnPath: string | null;
  /** `password_policy.minimum_length` de `GET /config`; `null` si no se publico. */
  readonly passwordMinimum?: number | null;
}) {
  const [channel, setChannel] = useState<AuthChannel>("email");
  const shared = { locale, consents, returnPath, passwordMinimum };

  return (
    <div className="flex flex-col gap-s5">
      <ChannelSwitch value={channel} onChange={setChannel} />

      {channel === "email" ? <EmailRegisterForm {...shared} /> : <PhoneRegisterFlow {...shared} />}
    </div>
  );
}

interface RegisterFlowProps {
  readonly locale: Locale;
  readonly consents: readonly ConsentRequirement[];
  readonly returnPath: string | null;
  readonly passwordMinimum: number | null;
}

function EmailRegisterForm({ locale, consents, returnPath, passwordMinimum }: RegisterFlowProps) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(registerAction, IDLE);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <input type="hidden" name="method" value="email" />
      {returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />}

      <FormError result={state} />

      <EmailField result={state} />

      <ProfileAndPasswordFields
        result={state}
        consents={consents}
        passwordMinimum={passwordMinimum}
      />

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("register.submit")}
      </Button>
    </form>
  );
}

/**
 * Alta con celular: pedir el codigo y, despues, crear la cuenta con el.
 *
 * El numero vive en el estado del cliente para sobrevivir al cambio de paso
 * (ver `PhoneField`). El token anti-bots se renueva tras cada envio: cada uno
 * sirve una sola vez.
 */
function PhoneRegisterFlow({ locale, consents, returnPath, passwordMinimum }: RegisterFlowProps) {
  const t = useTranslations("auth");
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [resetSignal, setResetSignal] = useState(0);

  const [sendState, sendAction, sending] = useActionState(sendPhoneCodeAction, IDLE);
  const [registerState, registerFormAction, registering] = useActionState(registerAction, IDLE);

  useEffect(() => {
    if (sendState.status === "idle") return;
    setResetSignal((current) => current + 1);
    if (sendState.status === "ok") setStep("code");
  }, [sendState]);

  if (step === "phone") {
    return (
      <form action={sendAction} className="flex flex-col gap-s5">
        <LocaleField locale={locale} />
        <input type="hidden" name="purpose" value="REGISTER" />

        <FormError result={sendState} />

        <PhoneField result={sendState} value={phone} onChange={setPhone} />

        <p className="text-body-sm text-text-muted">{t("phone.disclosure")}</p>

        <TurnstileWidget locale={locale} resetSignal={resetSignal} />

        <Button type="submit" variant="accent" size="lg" fullWidth loading={sending}>
          {t("phone.sendCode")}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-s5">
      <Alert tone="success" title={t("phone.sentTitle")}>
        {t("phone.sentBody", { phone })}
      </Alert>

      <form action={registerFormAction} className="flex flex-col gap-s5">
        <LocaleField locale={locale} />
        <input type="hidden" name="method" value="phone" />
        <input type="hidden" name="phone" value={phone} />
        {returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />}

        <FormError result={registerState} />

        <SmsCodeField result={registerState} />

        <ProfileAndPasswordFields
          result={registerState}
          consents={consents}
          passwordMinimum={passwordMinimum}
        />

        <Button type="submit" variant="accent" size="lg" fullWidth loading={registering}>
          {t("register.submit")}
        </Button>
      </form>

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setStep("phone");
        }}
      >
        {t("phone.changeNumber")}
      </Button>
    </div>
  );
}

/**
 * Nombre, contrasena, fecha de nacimiento, estado y consentimientos: lo mismo
 * con correo que con celular.
 */
function ProfileAndPasswordFields({
  result,
  consents,
  passwordMinimum,
}: {
  readonly result: ActionResult;
  readonly consents: readonly ConsentRequirement[];
  readonly passwordMinimum: number | null;
}) {
  const t = useTranslations("auth");
  const fieldError = useFieldError(result);

  return (
    <>
      <FormField
        label={t("fields.displayName")}
        description={t("fields.displayNameHint")}
        error={fieldError("display_name")}
      >
        <Input name="display_name" type="text" autoComplete="name" />
      </FormField>

      <EligibilityFields result={result} />

      <NewPasswordFields result={result} minimumLength={passwordMinimum} />

      <ConsentFieldset result={result} consents={consents} />
    </>
  );
}
