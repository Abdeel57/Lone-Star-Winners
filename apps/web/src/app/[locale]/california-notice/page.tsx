import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalPage } from "@/components/legal-page";
import { routing } from "@/i18n/routing";
import { CALIFORNIA_NOTICE } from "@/legal/california-notice";

/**
 * Aviso de recopilacion para residentes de California (CCPA).
 *
 * Se enlaza en los puntos donde se piden datos -alta, direccion de envio y
 * solicitudes de privacidad-, que es donde ese aviso tiene que estar a mano.
 */
export default async function CaliforniaNoticePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "legal.californiaNotice" });

  return (
    <LegalPage locale={locale} document={CALIFORNIA_NOTICE} title={t("title")} lead={t("lead")} />
  );
}
