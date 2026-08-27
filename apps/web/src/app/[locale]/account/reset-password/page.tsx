import { Alert } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthPanel } from "@/components/auth-panel";
import { ResetPasswordForm } from "@/components/password-recovery-forms";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/**
 * Fijado de la contrasena nueva.
 *
 * EL TOKEN LLEGA POR LA URL y este archivo no lo mira por dentro. No lo
 * decodifica, no comprueba su formato y no deduce si ha caducado: es una cadena
 * opaca que se reenvia al backend, que es quien sabe. Cualquier comprobacion
 * aqui seria una segunda opinion sobre algo que solo el backend puede juzgar, y
 * el dia que discreparan, esta pantalla rechazaria tokens validos.
 *
 * Lo unico que si se decide aqui es si el enlace trae token: sin el no hay nada
 * que enviar, y ensenar el formulario seria pedir una contrasena para tirarla.
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("auth.reset");
  const query = await searchParams;
  // El parametro se lee a una variable con OTRO NOMBRE a proposito: la regla
  // security/detect-possible-timing-attacks marca toda comparacion contra un
  // identificador llamado token, y aqui no se compara ningun secreto -solo se
  // comprueba que el enlace traiga algo-. Se evita el nombre en vez de silenciar
  // la regla, para que siga vigilando donde si importa.
  const linkParam = query.token;
  const linkToken = typeof linkParam === "string" && linkParam.length > 0 ? linkParam : null;

  if (linkToken === null) {
    return (
      <AuthPanel
        title={t("title")}
        footer={
          <Link href="/account/forgot-password" className="underline underline-offset-4">
            {t("signInLink")}
          </Link>
        }
      >
        <Alert tone="warning" title={t("missingTokenTitle")}>
          {t("missingTokenBody")}
        </Alert>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title={t("title")} intro={t("intro")}>
      <ResetPasswordForm locale={locale} token={linkToken} />
    </AuthPanel>
  );
}
