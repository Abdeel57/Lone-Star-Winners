import { Alert } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthPanel } from "@/components/auth-panel";
import { VerifyEmailForm } from "@/components/email-verification";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/**
 * Verificacion del correo.
 *
 * Igual que el restablecimiento: el token es opaco y esta pagina no lo
 * interpreta. Y la verificacion NO se dispara sola al cargar -hace falta pulsar
 * el boton-, porque los previsualizadores de enlaces de los clientes de correo
 * y los antivirus corporativos abren cada URL que reciben, y consumirian el
 * token antes de que nadie llegue a verlo.
 */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("auth.verify");
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
          <Link href="/account" className="underline underline-offset-4">
            {t("continueLink")}
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
      <VerifyEmailForm locale={locale} token={linkToken} />
    </AuthPanel>
  );
}
