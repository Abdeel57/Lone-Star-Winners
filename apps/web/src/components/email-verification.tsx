"use client";

import { Alert, Button } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { IDLE } from "@/lib/action-result";
import { resendVerificationAction, verifyEmailAction } from "@/lib/auth-actions";

import { FormError, LocaleField } from "./auth-form-shell";

/**
 * Verificacion del correo.
 *
 * LO QUE ESTAS PANTALLAS NO DICEN
 * -------------------------------
 * No dicen que sin verificar el correo no se pueda participar, ni que las
 * participaciones no cuenten, ni que la cuenta este limitada. Que la
 * verificacion condicione o no la participacion es un TBD legal
 * (`docs/LEGAL_PENDING.md`), y afirmarlo aqui seria inventar un requisito
 * (CLAUDE.md #2). La verificacion es un MECANISMO -confirma que la direccion es
 * de quien dice- y eso es exactamente lo que el texto afirma, ni una palabra
 * mas.
 *
 * El dia que las Official Rules digan algo al respecto, lo dira el backend por
 * configuracion y la interfaz lo pintara; no antes.
 *
 * NO SE VERIFICA SOLA AL CARGAR LA PAGINA
 * ---------------------------------------
 * Hay un boton, y hace falta pulsarlo. Un `useEffect` que dispare la
 * verificacion al montar convierte un enlace de correo en una accion que
 * ejecutan tambien los previsualizadores de enlaces de los clientes de correo y
 * los antivirus corporativos, que abren cada URL que reciben. El resultado es
 * un token consumido antes de que la persona llegue a verlo.
 */
export function VerifyEmailForm({
  locale,
  token,
}: {
  readonly locale: Locale;
  readonly token: string;
}) {
  const t = useTranslations("auth.verify");
  const [state, formAction, pending] = useActionState(verifyEmailAction, IDLE);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-s4">
        <Alert tone="success" title={t("doneTitle")}>
          {t("doneBody")}
        </Alert>

        <Link href="/account" className="text-body-sm text-text-muted underline underline-offset-4">
          {t("continueLink")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <input type="hidden" name="token" value={token} />

      <FormError result={state} />

      <Button type="submit" variant="accent" size="lg" loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}

/**
 * Aviso de correo sin verificar, con reenvio.
 *
 * Tono `info` y no `warning`: no hay nada roto ni en riesgo. Un tono de aviso
 * comunicaria una consecuencia que nadie ha establecido todavia.
 */
export function UnverifiedEmailNotice({
  locale,
  email,
}: {
  readonly locale: Locale;
  readonly email: string;
}) {
  const t = useTranslations("auth.unverified");
  const [state, formAction, pending] = useActionState(resendVerificationAction, IDLE);

  return (
    <Alert tone="info" title={t("title")}>
      <p>{t("body", { email })}</p>

      {state.status === "ok" ? (
        <p className="mt-s2 font-medium">{t("resent")}</p>
      ) : (
        <form action={formAction} className="mt-s3">
          <LocaleField locale={locale} />
          <Button type="submit" variant="secondary" size="sm" loading={pending}>
            {t("resend")}
          </Button>
        </form>
      )}
    </Alert>
  );
}
