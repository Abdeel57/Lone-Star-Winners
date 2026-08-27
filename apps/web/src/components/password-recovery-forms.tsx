"use client";

import { Alert, Button } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { IDLE } from "@/lib/action-result";
import { forgotPasswordAction, resetPasswordAction } from "@/lib/auth-actions";

import { EmailField, FormError, LocaleField, PasswordField } from "./auth-form-shell";

/**
 * Los dos pasos del restablecimiento de contrasena.
 *
 * ESTAN EN EL MISMO ARCHIVO porque son dos mitades de un solo recorrido y
 * comparten la unica decision no obvia: que el estado de exito lo pinta el
 * PROPIO componente y no la pagina. Tiene que ser asi porque el resultado vive
 * en `useActionState`, que es estado de cliente; una pagina de servidor no
 * puede saber que el envio salio bien sin recargar.
 *
 * LA RESPUESTA DEL PRIMER PASO NO REVELA SI LA CUENTA EXISTE
 * ---------------------------------------------------------
 * Y no es solo que el backend responda lo mismo: esta pantalla tampoco pinta
 * dos ramas. Sale el mismo panel exista o no la direccion, y el texto lo dice
 * en voz alta, porque una interfaz que se comporta igual pero no lo explica
 * deja a quien se equivoco de correo esperando un mensaje que no va a llegar.
 */
export function ForgotPasswordForm({ locale }: { readonly locale: Locale }) {
  const t = useTranslations("auth.forgot");
  const [state, formAction, pending] = useActionState(forgotPasswordAction, IDLE);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-s4">
        <Alert tone="success" title={t("sentTitle")}>
          {t("sentBody")}
        </Alert>

        <Link
          href="/account/login"
          className="text-body-sm text-text-muted underline underline-offset-4"
        >
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <FormError result={state} />

      <EmailField result={state} />

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}

/**
 * Segundo paso: fijar la contrasena nueva con el token del correo.
 *
 * El token viaja en un campo OCULTO y no en la URL del envio. Es deliberado:
 * una URL acaba en el historial del navegador, en la barra de direcciones
 * compartida y en la cabecera `Referer` de cualquier recurso externo de la
 * pagina. Que llegue por la URL es inevitable -es un enlace de correo-, pero no
 * hace falta reenviarlo por ahi otra vez.
 */
export function ResetPasswordForm({
  locale,
  token,
}: {
  readonly locale: Locale;
  readonly token: string;
}) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(resetPasswordAction, IDLE);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-s4">
        <Alert tone="success" title={t("reset.doneTitle")}>
          {t("reset.doneBody")}
        </Alert>

        <Link
          href="/account/login"
          className="text-body-sm text-text-muted underline underline-offset-4"
        >
          {t("reset.signInLink")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <input type="hidden" name="token" value={token} />

      <FormError result={state} />

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

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("reset.submit")}
      </Button>
    </form>
  );
}
