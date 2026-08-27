import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AdminAccessFrame } from "@/components/admin/admin-chrome";
import { AdminUnavailable, NotStaffNotice } from "@/components/admin/admin-screen";
import { StaffMfaForm } from "@/components/admin/staff-auth-forms";
import { adminHref } from "@/i18n/admin-routing";
import { isLocale } from "@/i18n/locales";
import { loadAdminSession } from "@/lib/admin/session-server";

export const dynamic = "force-dynamic";

/**
 * Segundo factor del panel (DEC-006).
 *
 * SOLO TIENE SENTIDO EN UN ESTADO. Si no hay sesion en `MFA_PENDING`, no hay
 * nada que completar, y esta pantalla lo dice en vez de pedir un codigo que no
 * corresponde a ninguna sesion. Es el estado que ve cualquiera que abra esta
 * URL de memoria, y tiene que ser legible, no un formulario que siempre falla.
 *
 * `POST /auth/mfa/verify` es `PUBLIC` en el contrato: la sesion existe pero
 * todavia no autentica, asi que exigir sesion valida ahi seria circular.
 */
export default async function AdminMfaPage({
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

  if (state.kind === "unavailable") {
    return <AdminUnavailable locale={locale} failure={state.failure} />;
  }

  if (state.kind === "notStaff") return <NotStaffNotice locale={locale} />;

  if (state.kind === "anonymous") {
    return (
      <AdminAccessFrame locale={locale}>
        <EmptyState
          headingLevel="h1"
          title={t("nothingToVerifyTitle")}
          description={t("nothingToVerifyBody")}
          action={
            <Link
              href={adminHref(locale, "/login")}
              className={buttonVariants({ variant: "accent" })}
            >
              {t("signInCta")}
            </Link>
          }
        />
      </AdminAccessFrame>
    );
  }

  return (
    <AdminAccessFrame locale={locale}>
      <Card elevation="raised" padding="lg">
        <CardTitle as="h2" size="md">
          {t("mfaTitle")}
        </CardTitle>

        <p className="mt-s3 text-body-sm text-text-muted">{t("mfaBody")}</p>

        <div className="mt-s6">
          <StaffMfaForm locale={locale} returnPath={returnPathOrNull(next)} />
        </div>
      </Card>
    </AdminAccessFrame>
  );
}

/** Destino de vuelta, validado igual que en el inicio de sesion. */
function returnPathOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!value.startsWith("/admin/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (value.length > 512) return null;

  return value;
}
