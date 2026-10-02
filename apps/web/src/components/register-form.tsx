"use client";

import { Alert, Button, Checkbox, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import { useConsentText } from "@/i18n/account-labels";
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
import { TurnstileWidget } from "./turnstile-widget";

/**
 * Formulario de alta: con correo o con celular (DEC-060).
 *
 * LO QUE ESTE FORMULARIO NO PREGUNTA
 * ----------------------------------
 * No pregunta la edad. No pregunta el estado de residencia. No pide confirmar
 * que se cumple ningun requisito de elegibilidad. No es un olvido: la
 * elegibilidad la fijan las Official Rules y sigue en `docs/LEGAL_PENDING.md`
 * (edad minima y jurisdicciones, ambas en TBD). Anadir aqui un "confirmo que
 * tengo 18 anos" seria escribir un requisito legal desde el frontend, que es lo
 * que CLAUDE.md #2 prohibe expresamente.
 *
 * LOS CONSENTIMIENTOS SON DATO, NO CODIGO
 * ---------------------------------------
 * Las casillas que se pintan llegan de `GET /config` (`required_consents`), con
 * su clave, su version y si son obligatorias. Si el backend no publica ninguno
 * -que es el caso HOY- no se pinta ninguna casilla, y eso es lo correcto: mejor
 * ninguna que una inventada. Cuando el abogado del cliente decida cuales son,
 * aparecen aqui sin tocar este archivo.
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

/** Nombre, contrasena y consentimientos: lo mismo con correo que con celular. */
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
  const consentText = useConsentText();
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

      <NewPasswordFields result={result} minimumLength={passwordMinimum} />

      {consents.length === 0 ? null : (
        <fieldset className="flex flex-col gap-s3 border-0 p-0">
          <legend className="text-label font-medium text-text">{t("consent.heading")}</legend>

          {consents.map((consent) => (
            <div key={consent.key}>
              {/*
               * Tres campos por consentimiento, y los tres hacen falta:
               *
               * - `consent` lleva clave y version, y es lo que la accion
               *   recorre. Va como campo oculto porque tiene que llegar tanto
               *   si se marca la casilla como si no: sin el, un consentimiento
               *   obligatorio SIN marcar seria indistinguible de uno que no
               *   existe, y el formulario se enviaria.
               * - `consent_required:<clave>` dice si es obligatorio, para que
               *   la accion no tenga que saberlo de antemano.
               * - `consent_accepted:<clave>` es la casilla.
               */}
              <input type="hidden" name="consent" value={`${consent.key}:${consent.version}`} />
              <input
                type="hidden"
                name={`consent_required:${consent.key}`}
                value={String(consent.required)}
              />

              <Checkbox
                name={`consent_accepted:${consent.key}`}
                label={consentText(consent.text_key)}
                description={t("consent.versionLabel", { version: consent.version })}
                {...(consent.required && fieldError("consent") !== undefined
                  ? { error: fieldError("consent") }
                  : {})}
              />
            </div>
          ))}
        </fieldset>
      )}
    </>
  );
}
