import { Card, CardTitle } from "@lsw/ui";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AdminAccessFrame } from "@/components/admin/admin-chrome";
import { AdminUnavailable } from "@/components/admin/admin-screen";
import { StaffLoginForm } from "@/components/admin/staff-auth-forms";
import { adminHref } from "@/i18n/admin-routing";
import { isLocale } from "@/i18n/locales";
import { loadAdminSession } from "@/lib/admin/session-server";

/** Una pantalla de acceso depende de la sesion: nunca se prerenderiza. */
export const dynamic = "force-dynamic";

/**
 * Inicio de sesion del personal (DEC-006, DEC-048).
 *
 * NO EXISTE `/admin/login` EN LA API. Esta pantalla llama a `POST /auth/login`,
 * la misma ruta que usa el escaparate: `CLAUDE.md` seccion 4 prohibe dos
 * sistemas de autenticacion. Lo que cambia es la POLITICA que el backend aplica
 * segun los roles -cookie `<base>_staff`, `SameSite=Strict`, `Path=/admin`, TTL
 * de 8 horas, inactividad de 15 minutos y MFA obligatorio- y el frontend no
 * rellena ni uno de esos atributos.
 *
 * QUIEN YA TIENE SESION NO VE ESTE FORMULARIO
 * -------------------------------------------
 * Con sesion de personal activa se va al panel; con una a la espera del segundo
 * factor, al segundo factor. Dejar el formulario visible ahi produce el bucle
 * mas confuso posible: tecleas la contrasena, funciona, y vuelves al mismo
 * formulario.
 *
 * Una sesion de PARTICIPANTE, en cambio, SI ve el formulario: es una cuenta
 * distinta, y esta pantalla es donde alguien con las dos cuentas entra con la
 * de trabajo. No se le echa la de cliente.
 */
export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { next } = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.auth" });
  const { state } = await loadAdminSession(locale);

  if (state.kind === "active") redirect(adminHref(locale));

  if (state.kind === "mfaPending") {
    const destination = returnPathOrPanel(next, locale);
    redirect(`${adminHref(locale, "/mfa")}?next=${encodeURIComponent(destination)}`);
  }

  if (state.kind === "unavailable") {
    return <AdminUnavailable locale={locale} failure={state.failure} />;
  }

  return (
    <AdminAccessFrame locale={locale}>
      <Card elevation="raised" padding="lg">
        <CardTitle as="h2" size="md">
          {t("signInTitle")}
        </CardTitle>

        <p className="mt-s3 text-body-sm text-text-muted">{t("signInBody")}</p>

        <div className="mt-s6">
          <StaffLoginForm locale={locale} returnPath={returnPathOrNull(next)} />
        </div>
      </Card>
    </AdminAccessFrame>
  );
}

/**
 * Destino de vuelta, VALIDADO.
 *
 * Solo se acepta una ruta interna del panel. Sin esta comprobacion, el
 * formulario de personal seria un redirector abierto enlazable desde un correo
 * dirigido justo a quien tiene credenciales de administracion. La accion vuelve
 * a validarlo: aqui se filtra para no pintar un `<input hidden>` con basura, y
 * alli porque un campo oculto se edita en cinco segundos.
 */
function returnPathOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!value.startsWith("/admin/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (value.length > 512) return null;

  return value;
}

function returnPathOrPanel(value: string | undefined, locale: "en" | "es"): string {
  return returnPathOrNull(value) ?? adminHref(locale);
}
