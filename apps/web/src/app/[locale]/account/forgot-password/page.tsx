import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthPanel } from "@/components/auth-panel";
import { ForgotPasswordChooser } from "@/components/password-recovery-forms";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchSiteConfig } from "@/lib/api";
import { passwordMinimumFrom } from "@/lib/password-policy";

export const dynamic = "force-dynamic";

/**
 * Solicitud de restablecimiento.
 *
 * NO comprueba la sesion, a diferencia de las de entrar y registrarse. Quien
 * llega aqui puede tener una sesion abierta en otro dispositivo y haber
 * olvidado igualmente su contrasena; redirigirle a su cuenta porque el
 * navegador tiene cookie seria negarle justo lo que ha venido a hacer.
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("auth.forgot");
  // El camino por SMS fija la contrasena nueva en esta misma pantalla.
  const passwordMinimum = passwordMinimumFrom(await fetchSiteConfig(locale));

  return (
    <AuthPanel
      title={t("title")}
      footer={
        <Link href="/account/login" className="underline underline-offset-4">
          {t("backToLogin")}
        </Link>
      }
    >
      {/* DEC-060: por correo o por celular. La introduccion depende del canal. */}
      <ForgotPasswordChooser locale={locale} passwordMinimum={passwordMinimum} />
    </AuthPanel>
  );
}
