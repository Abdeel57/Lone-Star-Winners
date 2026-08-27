import { Alert } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { AuthPanel } from "@/components/auth-panel";
import { MfaForm } from "@/components/mfa-form";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { returnPathFrom } from "@/lib/form-input";
import { loadSession } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Segundo factor (seccion 10).
 *
 * ESTA PANTALLA SOLO EXISTE PARA UNA SESION EN `MFA_PENDING`. Los otros tres
 * estados salen de aqui, y cada uno por su motivo:
 *
 * - `active` ....... ya esta dentro; no hay segundo paso pendiente.
 * - `anonymous` .... no hay sesion que completar; se empieza por el principio.
 * - `unavailable` .. no se sabe; se dice, con su referencia.
 *
 * Es deliberado que NO ensene nada de la cuenta -ni el correo de la sesion-.
 * Una sesion en `MFA_PENDING` no autentica, y pintar con ella cualquier dato
 * seria abrir en la interfaz una puerta que el backend tiene cerrada.
 */
export default async function MfaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("auth.mfa");
  const query = await searchParams;
  const returnPath = returnPathFrom(query.next);

  const { state } = await loadSession(locale);

  if (state.kind === "active") {
    redirect({ href: returnPath ?? "/account", locale });
  }

  if (state.kind === "unavailable") {
    return (
      <AuthPanel title={t("title")}>
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AuthPanel>
    );
  }

  if (state.kind === "anonymous") {
    const tLogin = await getTranslations("auth.login");

    return (
      <AuthPanel
        title={t("title")}
        footer={
          <Link href="/account/login" className="underline underline-offset-4">
            {tLogin("title")}
          </Link>
        }
      >
        <Alert tone="info">{t("pendingBody")}</Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title={t("title")} intro={t("intro")}>
      <MfaForm locale={locale} returnPath={returnPath} />
    </AuthPanel>
  );
}
