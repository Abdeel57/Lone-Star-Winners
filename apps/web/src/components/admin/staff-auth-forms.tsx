"use client";

import { Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EmailField, FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { staffLoginAction, staffMfaAction } from "@/lib/admin/actions";

/**
 * Formularios de acceso del PERSONAL.
 *
 * REUTILIZAN LAS PIEZAS DEL ESCAPARATE (`auth-form-shell`) A PROPOSITO. El
 * campo de correo, el aviso de error del formulario y la asociacion accesible
 * de un error con su campo son identicos, y duplicarlos aqui significaria que
 * un dia el panel dejara de anunciar los errores a un lector de pantalla y
 * nadie se enterara.
 *
 * Lo que NO se reutiliza son las acciones: `staffLoginAction` y `staffMfaAction`
 * llaman a LAS MISMAS rutas de la API -no existe `/admin/login`, DEC-006- pero
 * redirigen dentro de `/admin` y tratan `MFA_PENDING` como el camino normal en
 * vez de como una excepcion.
 *
 * SON `<form>` CON SERVER ACTION y funcionan sin JavaScript. `useActionState`
 * esta solo para conservar el error sin recargar. La contrasena no pasa por
 * JavaScript de cliente: no hay estado controlado, no hay `onChange` y no hay
 * `fetch`. Y no hay token de vuelta: la sesion llega en una cookie `httpOnly`
 * que este componente nunca ve.
 */

export function StaffLoginForm({
  locale,
  returnPath,
}: {
  readonly locale: Locale;
  readonly returnPath: string | null;
}) {
  const t = useTranslations("admin.auth");
  const [state, formAction, pending] = useActionState(staffLoginAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />}

      <FormError result={state} />

      {/*
       * Cuanto hay que esperar tras un bloqueo. El backend publica
       * `retry_after_seconds` en el 423 y aqui se convierte a minutos
       * redondeando HACIA ARRIBA: decir "en 14 minutos" cuando faltan 14 y
       * medio manda a alguien a chocar otra vez con el mismo bloqueo.
       */}
      {state.retryAfterSeconds === null ? null : (
        <p className="text-body-sm text-text-muted">
          {t("lockedRetry", { minutes: Math.ceil(state.retryAfterSeconds / 60) })}
        </p>
      )}

      <EmailField result={state} />

      <FormField label={t("passwordLabel")} required error={fieldError("password")}>
        <Input name="password" type="password" autoComplete="current-password" />
      </FormField>

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("signInSubmit")}
      </Button>

      <p className="text-caption text-text-subtle">{t("mfaAlwaysRequired")}</p>
    </form>
  );
}

/**
 * Segundo factor del panel.
 *
 * OBLIGATORIO PARA TODO ROL ADMINISTRATIVO (DEC-006). No hay forma de saltarlo
 * y no hay "recordar este dispositivo": una sesion de personal dura ocho horas
 * y caduca por inactividad a los quince minutos, asi que el segundo factor se
 * pide a menudo por diseno.
 *
 * `inputMode="numeric"` y `autoComplete="one-time-code"`: en un telefono, el
 * primero abre el teclado numerico y el segundo ofrece el codigo recien
 * llegado. Sin `pattern` ni `maxLength`: la longitud la fija el backend, y una
 * restriccion del navegador que no coincida rechazaria codigos validos.
 */
export function StaffMfaForm({
  locale,
  returnPath,
}: {
  readonly locale: Locale;
  readonly returnPath: string | null;
}) {
  const t = useTranslations("admin.auth");
  const [state, formAction, pending] = useActionState(staffMfaAction, IDLE);
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
        {t("verifySubmit")}
      </Button>
    </form>
  );
}
