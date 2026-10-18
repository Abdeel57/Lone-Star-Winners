import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthPanel } from "@/components/auth-panel";
import { SignInFlow } from "@/components/sign-in-flow";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { fetchSiteConfig, type ConsentRequirement } from "@/lib/api";
import { returnPathFrom } from "@/lib/form-input";
import { loadSession } from "@/lib/participant-server";

/**
 * Render por peticion, siempre.
 *
 * La pagina consulta la sesion para no ensenar un formulario de inicio de
 * sesion a quien ya la tiene. Prerenderizarla serviria la decision de la
 * primera persona que la cargo a todas las demas.
 *
 * DEC-089: entrar y crear la cuenta son el MISMO flujo con codigo, asi que
 * esta pagina tambien lee los documentos que el alta exige aceptar, por si el
 * contacto resulta no tener cuenta. Si la lectura falla no se pinta ninguna
 * casilla y el backend rechaza el alta: es la direccion segura (ver
 * `register/page.tsx`).
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
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

  /*
   * El destino de vuelta se VALIDA aqui y otra vez en la accion.
   *
   * Aqui, para no pintarlo en un campo oculto si no es una ruta interna; y en
   * la accion, porque el campo oculto se edita en el navegador y la unica
   * validacion que cuenta es la que ocurre donde se usa el valor.
   */
  const returnPath = returnPathFrom(query.next);

  const [{ state }, configResult] = await Promise.all([
    loadSession(locale),
    fetchSiteConfig(locale),
  ]);

  /*
   * Quien ya tiene sesion no ve esta pantalla: va a donde queria ir.
   *
   * El destino se compone con el prefijo de idioma EXPLICITO. Un `redirect` a
   * `/account` a secas mandaria a alguien a una ruta sin idioma, y el
   * middleware volveria a negociarlo: en el mejor caso una redireccion de mas,
   * y en el peor un cambio de idioma justo al entrar en su cuenta (DEC-021).
   */
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
    <AuthPanel title={t("code.loginTitle")} intro={t("code.loginIntro")}>
      {returnPath === null ? null : (
        <p className="mb-s4 text-body-sm text-text-muted">{t("login.returnNotice")}</p>
      )}

      <SignInFlow locale={locale} consents={consents} returnPath={returnPath} />
    </AuthPanel>
  );
}
