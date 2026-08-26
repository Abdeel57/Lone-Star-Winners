import { buttonVariants } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FaqList } from "@/components/faq-list";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Preguntas frecuentes.
 *
 * Es copy de producto puro (DEC-022): vive en los dos diccionarios y el test de
 * paridad garantiza que ninguna respuesta exista solo en un idioma.
 *
 * Ninguna respuesta establece condiciones de participacion. Todas remiten a las
 * Reglas Oficiales, y la pagina termina con un enlace a ellas para que la
 * remision no sea retorica.
 */
export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();

  return (
    <div className="lsw-container max-w-narrow py-s10">
      <h1 className="text-display-md font-bold text-text">{t("faq.title")}</h1>
      <p className="mt-s3 text-body-lg text-text-muted">{t("faq.intro")}</p>

      <div className="mt-s8">
        <FaqList />
      </div>

      <div className="mt-s8">
        <Link href="/official-rules" className={buttonVariants({ variant: "secondary" })}>
          {t("nav.officialRules")}
        </Link>
      </div>
    </div>
  );
}
