import { buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
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
 * DOS USOS, segun la sesion:
 *
 * - `MFA_PENDING`: completar la entrada, que es para lo que nacio.
 * - `ACTIVE`: RENOVAR el codigo. Las acciones con step-up -activar o cerrar una
 *   promocion, activar reglas, devolver un pago- exigen uno escrito hace pocos
 *   minutos, y `POST /auth/mfa/verify` lo renueva con la sesion abierta
 *   (`markMfaVerified`). Antes esta pantalla redirigia al panel, y la unica
 *   forma de renovarlo era cerrar sesion y volver a entrar. Llega desde
 *   "Confirmar codigo" en la cabecera, con `next` apuntando a donde se estaba.
 *
 * Sin sesion no hay nada que completar, y la pantalla lo dice en vez de pedir
 * un codigo que no corresponde a ninguna sesion.
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

  if (state.kind === "active") {
    return (
      <AdminAccessFrame locale={locale}>
        <Card elevation="raised" padding="lg">
          <CardTitle as="h2" size="md">
            {t("renewTitle")}
          </CardTitle>

          <p className="mt-s3 text-body-sm text-text-muted">{t("renewBody")}</p>

          <div className="mt-s6">
            <StaffMfaForm locale={locale} returnPath={returnPathOrNull(next)} />
          </div>
        </Card>
      </AdminAccessFrame>
    );
  }

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
