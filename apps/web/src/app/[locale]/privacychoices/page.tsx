import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PrivacyRequestForm } from "@/components/privacy-request-form";
import { SectionHeading } from "@/components/section-heading";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { BUSINESS_CONTACT, LEGAL_ROUTES } from "@/legal/links";

/**
 * Tus opciones de privacidad (DEC-063).
 *
 * La URL es literal: la Politica de Privacidad y el Aviso de California publican
 * `https://LoneStarWinners.com/privacychoices` como una de las dos vias para
 * ejercer derechos. La otra es el correo, y la pagina la nombra tambien: quien
 * no quiera usar un formulario no tiene por que.
 */
export default async function PrivacyChoicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "legal.privacyChoices" });

  return (
    <div className="pb-s16">
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container max-w-narrow">
          <SectionHeading title={t("title")} lead={t("lead")} level="h1" size="lg" />
        </div>
      </div>

      <div className="lsw-container max-w-narrow pt-s10">
        <div className="flex flex-col gap-s4 text-body-md text-text-muted">
          <p>{t("intro")}</p>
          <p>
            {t("emailAlternative")}{" "}
            <a
              href={`mailto:${BUSINESS_CONTACT.email}`}
              className="text-brand underline underline-offset-4 hover:text-text"
            >
              {BUSINESS_CONTACT.email}
            </a>
          </p>
          <p>
            <Link
              href={LEGAL_ROUTES.privacy}
              className="text-brand underline underline-offset-4 hover:text-text"
            >
              {t("readPolicy")}
            </Link>
          </p>
        </div>

        <div className="mt-s8 rounded-lg border border-border bg-surface p-s6 sm:p-s8">
          <PrivacyRequestForm locale={locale} />
        </div>
      </div>
    </div>
  );
}
