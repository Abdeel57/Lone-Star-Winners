import "@lsw/design-system/tokens.css";
import "../globals.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { localeTag } from "@/i18n/locales";
import { routing } from "@/i18n/routing";

/**
 * Layout raiz.
 *
 * Vive dentro de `[locale]` y no en `app/`, y eso es deliberado: no existe
 * ninguna pagina fuera de un idioma. Es la consecuencia estructural de DEC-021,
 * que prohibe servir un locale sin prefijo.
 *
 * El orden de los dos imports de CSS importa: primero los tokens del design
 * system, despues los estilos base de la app, que los consumen.
 */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("title"),
    description: t("description"),
    // Ambos idiomas se declaran como alternativas equivalentes. Ninguno es la
    // version canonica del otro (principio #4).
    alternates: {
      languages: {
        "en-US": "/en",
        "es-US": "/es",
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Permite renderizado estatico de las rutas de este segmento.
  setRequestLocale(locale);

  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: "a11y" });
  const showMockNotice = process.env.NODE_ENV !== "production";

  return (
    <html lang={localeTag(locale)} suppressHydrationWarning>
      <body className="flex min-h-svh flex-col">
        <NextIntlClientProvider messages={messages}>
          <a href="#main" className="lsw-skip-link">
            {t("skipToContent")}
          </a>

          <SiteHeader />

          <main id="main" aria-label={t("mainLandmark")} className="flex-1">
            {children}
          </main>

          <SiteFooter showMockNotice={showMockNotice} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
