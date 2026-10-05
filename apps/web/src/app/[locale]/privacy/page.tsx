import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalPage } from "@/components/legal-page";
import { routing } from "@/i18n/routing";
import { PRIVACY_POLICY } from "@/legal/privacy-policy";

/** Politica de Privacidad, tal como la entrego el abogado del cliente. */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "legal.privacy" });

  return (
    <LegalPage locale={locale} document={PRIVACY_POLICY} title={t("title")} lead={t("lead")} />
  );
}
