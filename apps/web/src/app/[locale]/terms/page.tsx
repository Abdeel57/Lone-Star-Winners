import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalPage } from "@/components/legal-page";
import { routing } from "@/i18n/routing";
import { TERMS_AND_CONDITIONS } from "@/legal/terms-and-conditions";
import { TERMS_AND_CONDITIONS_ES } from "@/legal/terms-and-conditions-es";

/**
 * Terminos y condiciones del sitio, tal como los entrego el cliente. En ingles,
 * los del abogado (prevalecen); en espanol, los de la Segunda Edicion (DEC-104).
 */
export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "legal.terms" });

  return (
    <LegalPage
      locale={locale}
      document={locale === "es" ? TERMS_AND_CONDITIONS_ES : TERMS_AND_CONDITIONS}
      title={t("title")}
      lead={t("lead")}
    />
  );
}
