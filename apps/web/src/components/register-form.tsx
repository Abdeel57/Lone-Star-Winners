"use client";

import { Button, Checkbox, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { useConsentText } from "@/i18n/account-labels";
import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import type { ConsentRequirement } from "@/lib/api";
import { registerAction } from "@/lib/auth-actions";

import {
  EmailField,
  FormError,
  LocaleField,
  PasswordField,
  useFieldError,
} from "./auth-form-shell";

/**
 * Formulario de alta.
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
 */
export function RegisterForm({
  locale,
  consents,
  returnPath,
}: {
  readonly locale: Locale;
  readonly consents: readonly ConsentRequirement[];
  readonly returnPath: string | null;
}) {
  const t = useTranslations("auth");
  const consentText = useConsentText();
  const [state, formAction, pending] = useActionState(registerAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />}

      <FormError result={state} />

      <EmailField result={state} />

      <FormField
        label={t("fields.displayName")}
        description={t("fields.displayNameHint")}
        error={fieldError("display_name")}
      >
        <Input name="display_name" type="text" autoComplete="name" />
      </FormField>

      <PasswordField
        result={state}
        name="password"
        label={t("fields.password")}
        purpose="new-password"
        description={t("fields.passwordHint")}
      />

      <PasswordField
        result={state}
        name="password_confirmation"
        label={t("fields.passwordConfirmation")}
        purpose="new-password"
      />

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

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("register.submit")}
      </Button>
    </form>
  );
}
