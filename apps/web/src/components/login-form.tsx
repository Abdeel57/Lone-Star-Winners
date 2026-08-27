"use client";

import { Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { IDLE } from "@/lib/action-result";
import { loginAction } from "@/lib/auth-actions";

import { EmailField, FormError, LocaleField, useFieldError } from "./auth-form-shell";

/**
 * Formulario de inicio de sesion.
 *
 * ES UN `<form>` CON SERVER ACTION, y funciona sin JavaScript. `useActionState`
 * esta aqui unicamente para poder conservar el error sin recargar la pagina; la
 * accion se pasa directamente a `<form action>`, asi que React la envia igual
 * antes de que cargue el bundle.
 *
 * LA CONTRASENA NO PASA POR JAVASCRIPT DE CLIENTE. No hay estado controlado, no
 * hay `onChange`, no hay `fetch`: el navegador envia el formulario al servidor
 * de Next, que es quien habla con `apps/api`. Y no hay token de vuelta: la
 * sesion llega en una cookie `httpOnly` que este componente nunca ve (DEC-006).
 *
 * EL DESTINO DE VUELTA VIAJA EN UN CAMPO OCULTO y lo valida la accion
 * (`returnPathFrom`). Sin esa validacion, esta pantalla seria un redirector
 * abierto: se enlaza desde un correo, la victima ve el dominio correcto, inicia
 * sesion, y acaba en otro sitio.
 */
export function LoginForm({
  locale,
  returnPath,
}: {
  readonly locale: Locale;
  readonly returnPath: string | null;
}) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(loginAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />}

      <FormError result={state} />

      {/*
       * Cuanto hay que esperar tras un bloqueo.
       *
       * El backend publica `retry_after_seconds` en el `423` (seccion 10) y
       * aqui se convierte a minutos redondeando HACIA ARRIBA: decir "en 14
       * minutos" cuando faltan 14 y medio manda a alguien a reintentar antes de
       * tiempo y a chocar con el mismo bloqueo.
       *
       * El bloqueo es TEMPORAL a proposito -uno permanente convertiria el
       * formulario en una forma de dejar fuera a cualquiera cuyo correo se
       * conozca- y por eso merece la pena decir cuanto dura.
       */}
      {state.retryAfterSeconds === null ? null : (
        <p className="text-body-sm text-text-muted">
          {t("login.lockedRetry", { minutes: Math.ceil(state.retryAfterSeconds / 60) })}
        </p>
      )}

      <EmailField result={state} />

      <FormField
        label={t("fields.password")}
        required
        requiredHint={t("fields.requiredHint")}
        error={fieldError("password")}
      >
        <Input name="password" type="password" autoComplete="current-password" />
      </FormField>

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("login.submit")}
      </Button>

      <p className="text-body-sm text-text-muted">
        <Link href="/account/forgot-password" className="underline underline-offset-4">
          {t("login.forgotLink")}
        </Link>
      </p>
    </form>
  );
}
