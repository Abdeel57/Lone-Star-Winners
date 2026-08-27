import { Alert, Card, CardTitle } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountShell, MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { UnverifiedEmailNotice } from "@/components/email-verification";
import { ProfileForm } from "@/components/profile-form";
import { formatZonedDate } from "@/i18n/formatters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Perfil del participante.
 *
 * SE PINTA CON LO QUE YA TRAE LA SESION y no se vuelve a pedir `GET /me`. Los
 * dos devuelven el mismo `ParticipantProfile`, asi que una segunda lectura solo
 * anadiria una peticion y una ventana en la que las dos respuestas pudieran
 * discrepar. `GET /me` existe en la capa de API para quien lo necesite; esta
 * pantalla no lo necesita.
 *
 * LO QUE NO SE PIDE AQUI
 * ----------------------
 * Ni fecha de nacimiento, ni estado de residencia, ni telefono. La elegibilidad
 * la fijan las Official Rules y sigue en `docs/LEGAL_PENDING.md`; recoger un
 * dato personal por si acaso hiciera falta es exactamente lo que no se hace
 * (CLAUDE.md #2).
 */
export default async function AccountProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("account.profile");
  const { state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <AccountShell title={t("title")} current="/account/profile">
        <SignInRequired returnPath="/account/profile" />
      </AccountShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <AccountShell title={t("title")} current="/account/profile">
        <MfaRequired returnPath="/account/profile" />
      </AccountShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <AccountShell title={t("title")} current="/account/profile">
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </AccountShell>
    );
  }

  const { participant } = state;
  const createdAt = formatZonedDate(participant.created_at, locale, { timeZone: "UTC" });

  return (
    <AccountShell title={t("title")} current="/account/profile">
      <div className="flex flex-col gap-s8">
        <p className="max-w-[52rem] text-body-sm text-text-muted">{t("intro")}</p>

        {participant.email_verified ? null : (
          <UnverifiedEmailNotice locale={locale} email={participant.email} />
        )}

        <ProfileForm participant={participant} locale={locale} />

        <Card elevation="raised" padding="lg" className="max-w-[32rem]">
          <CardTitle as="h2" size="sm">
            {t("securityHeading")}
          </CardTitle>

          <p className="mt-s3 text-body-sm text-text-muted">{t("securityBody")}</p>

          <div className="mt-s4">
            <Link
              href="/account/forgot-password"
              className="text-body-sm font-medium text-brand underline underline-offset-4"
            >
              {t("changePassword")}
            </Link>
          </div>
        </Card>

        {createdAt === null ? null : (
          <Alert tone="info">{t("memberSince", { date: createdAt })}</Alert>
        )}
      </div>
    </AccountShell>
  );
}
