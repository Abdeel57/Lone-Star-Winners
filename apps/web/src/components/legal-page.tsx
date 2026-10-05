import { Alert } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { formatZonedDate } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { LEGAL_DOCUMENTS, LEGAL_ROUTES } from "@/legal/links";
import type { LegalDocument } from "@/legal/types";

import { LegalDocumentView } from "./legal-document-view";
import { SectionHeading } from "./section-heading";

/**
 * Pagina de un documento legal: Terminos, Privacidad o Aviso de California.
 *
 * Lo que pone el frontend es solo el marco -titulo traducido, fecha de
 * vigencia, aviso de idioma y enlaces a los demas documentos-. El documento va
 * dentro tal cual lo escribio el abogado.
 *
 * EL AVISO DE IDIOMA SE DICE, NO SE TAPA. Los documentos solo existen en
 * ingles; quien navega en espanol tiene que saber que esta leyendo el original
 * en ingles, igual que en las Reglas Oficiales. No se afirma cual controla: eso
 * no lo dicen estos documentos.
 */
export async function LegalPage({
  locale,
  document,
  title,
  lead,
}: {
  readonly locale: Locale;
  readonly document: LegalDocument;
  readonly title: string;
  readonly lead: string;
}) {
  const t = await getTranslations({ locale, namespace: "legal" });
  const effective = formatZonedDate(`${document.version}T12:00:00Z`, locale, { timeZone: "UTC" });

  return (
    <div className="pb-s16">
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container max-w-narrow">
          <SectionHeading title={title} lead={lead} level="h1" size="lg" />
        </div>
      </div>

      <div className="lsw-container max-w-narrow pt-s10">
        <div className="flex flex-col gap-s4">
          {effective === null ? null : (
            <p className="text-body-sm text-text-muted">{t("effective", { date: effective })}</p>
          )}

          {locale === "en" ? null : <Alert tone="info">{t("englishOnly")}</Alert>}
        </div>

        <div className="mt-s8 border-t border-border pt-s8">
          <LegalDocumentView document={document} />
        </div>

        <nav
          aria-label={t("otherDocuments")}
          className="mt-s12 flex flex-col gap-s3 border-t border-border pt-s8"
        >
          <p className="text-label font-medium text-text">{t("otherDocuments")}</p>
          <ul className="flex flex-wrap gap-x-s6 gap-y-2">
            {LEGAL_DOCUMENTS.filter((entry) => entry.document.key !== document.key).map((entry) => (
              <li key={entry.route}>
                <Link
                  href={entry.route}
                  className="text-body-sm text-brand underline underline-offset-4 hover:text-text"
                >
                  {t(`links.${entry.labelKey}`)}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={LEGAL_ROUTES.privacyChoices}
                className="text-body-sm text-brand underline underline-offset-4 hover:text-text"
              >
                {t("links.privacyChoices")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
