import { buttonVariants } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FaqList } from "@/components/faq-list";
import { SectionHeading } from "@/components/section-heading";
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
    <div className="pb-s16">
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container max-w-narrow">
          <SectionHeading title={t("faq.title")} lead={t("faq.intro")} level="h1" size="lg" />
        </div>
      </div>

      <div className="lsw-container max-w-narrow pt-s10">
        <FaqList />

        {/* La remision a las Reglas Oficiales cierra la pagina, y es la accion
            principal: todas las respuestas remiten a ellas, asi que el enlace
            no puede ser el mas discreto de la pantalla. */}
        <div className="mt-s10 border-t border-border pt-s8">
          <Link
            href="/official-rules"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            {t("nav.officialRules")}
          </Link>
        </div>
      </div>
    </div>
  );
}
