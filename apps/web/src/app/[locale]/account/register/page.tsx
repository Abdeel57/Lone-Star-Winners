import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthPanel } from "@/components/auth-panel";
import { RegisterForm } from "@/components/register-form";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchSiteConfig, type ConsentRequirement } from "@/lib/api";
import { returnPathFrom } from "@/lib/form-input";
import { loadSession } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Alta de participante.
 *
 * LOS CONSENTIMIENTOS SE LEEN EN SERVIDOR, en la misma peticion que el render.
 * Es el mismo criterio que DEC-013 impone a los feature flags y por la misma
 * razon: lo que hay que aceptar para abrir una cuenta es materia legal, y no
 * puede depender de una variable de entorno del navegador ni de una cache.
 *
 * Si la lectura falla, NO se pinta ninguna casilla, y esa es la direccion
 * segura: el backend revalida y rechazara el alta si falta un consentimiento
 * obligatorio. Lo contrario -inventar una casilla por si acaso- pondria en
 * pantalla un texto legal que nadie ha aprobado.
 */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("auth");
  const query = await searchParams;
  const returnPath = returnPathFrom(query.next);

  const [{ state }, configResult] = await Promise.all([
    loadSession(locale),
    fetchSiteConfig(locale),
  ]);

  // Quien ya tiene sesion no ve esta pantalla; quien tiene el segundo factor
  // a medias va a completarlo, que es lo unico que su sesion permite hacer.
  if (state.kind === "active") {
    redirect({ href: returnPath ?? "/account", locale });
  }

  if (state.kind === "mfaPending") {
    redirect({ href: `/account/mfa?next=${encodeURIComponent(returnPath ?? "/account")}`, locale });
  }

  const consents: readonly ConsentRequirement[] = configResult.ok
    ? (configResult.data.required_consents ?? [])
    : [];

  return (
    <AuthPanel
      title={t("register.title")}
      intro={t("register.intro")}
      footer={
        <p>
          {t("register.alreadyHaveAccount")}{" "}
          <Link
            href={
              returnPath === null
                ? "/account/login"
                : `/account/login?next=${encodeURIComponent(returnPath)}`
            }
            className="font-medium text-brand underline underline-offset-4"
          >
            {t("register.signInLink")}
          </Link>
        </p>
      }
    >
      <RegisterForm locale={locale} consents={consents} returnPath={returnPath} />
    </AuthPanel>
  );
}
