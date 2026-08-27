"use client";

import { Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { verifyMfaAction } from "@/lib/auth-actions";

import { FormError, LocaleField, useFieldError } from "./auth-form-shell";

/**
 * Segundo factor.
 *
 * LA SESION EXISTE Y TODAVIA NO AUTENTICA. Es el estado `MFA_PENDING` de la
 * seccion 10: la contrasena ya era correcta, pero esa sesion "no vale para
 * nada" salvo para completar este paso. Por eso esta pantalla no ensena nada de
 * la cuenta -ni el correo, ni un saldo- y solo pide el codigo.
 *
 * UN CODIGO NO VALE DOS VECES, ni siquiera dentro de su ventana de 30 segundos:
 * el consumo de la ventana es atomico en el backend. La interfaz lo dice en la
 * ayuda del campo, porque quien reintenta con el mismo codigo tras un error de
 * red no lo espera.
 *
 * NO SE DISTINGUE POR QUE FALLO. El backend responde 401 igual si el codigo es
 * invalido, si ha caducado o si ya se uso, y la interfaz no intenta adivinar
 * cual de las tres: inventarse el motivo seria peor que decir que no vale.
 *
 * `inputMode="numeric"` y `autoComplete="one-time-code"`: en un telefono, el
 * primero abre el teclado numerico y el segundo ofrece el codigo que acaba de
 * llegar. Sin `pattern` ni `maxLength`: el contrato dice seis digitos y admite
 * espacios, y una restriccion del navegador que no coincida exactamente con la
 * del backend rechaza codigos validos.
 */
export function MfaForm({
  locale,
  returnPath,
}: {
  readonly locale: Locale;
  readonly returnPath: string | null;
}) {
  const t = useTranslations("auth.mfa");
  const [state, formAction, pending] = useActionState(verifyMfaAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />}

      <FormError result={state} />

      <FormField
        label={t("codeLabel")}
        description={t("codeHint")}
        required
        error={fieldError("code")}
      >
        <Input
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
        />
      </FormField>

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
