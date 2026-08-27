import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthPanel } from "@/components/auth-panel";
import { ForgotPasswordForm } from "@/components/password-recovery-forms";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

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

  return (
    <AuthPanel
      title={t("title")}
      intro={t("intro")}
      footer={
        <Link href="/account/login" className="underline underline-offset-4">
          {t("backToLogin")}
        </Link>
      }
    >
      <ForgotPasswordForm locale={locale} />
    </AuthPanel>
  );
}
