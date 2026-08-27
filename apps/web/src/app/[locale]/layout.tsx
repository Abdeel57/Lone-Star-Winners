import "@lsw/design-system/tokens.css";
import "../globals.css";

import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { AnnouncementBar } from "@/components/announcement-bar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { localeTag } from "@/i18n/locales";
import { routing } from "@/i18n/routing";

import { bodyFont, displayFont } from "../fonts";

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

/**
 * Cromo del navegador (DEC-038).
 *
 * `themeColor` tine la barra de direcciones en movil y `colorScheme` le dice al
 * navegador que la pagina es oscura ANTES de que llegue el CSS, de modo que el
 * primer fotograma no es un rectangulo blanco. El valor es el mismo que
 * `--lsw-color-bg`; se escribe literal porque una cabecera `<meta>` no puede
 * resolver una custom property, y es el unico sitio de la aplicacion donde eso
 * pasa.
 */
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#08080a",
};

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
    /*
     * Las dos variables de fuente se declaran en el ELEMENTO RAIZ, que es el
     * mismo al que apunta el `:root` de los tokens: `--lsw-font-display`
     * referencia a `--font-lsw-display`, y una custom property solo puede
     * resolver otra declarada en su propio elemento o en un ancestro. En
     * `<body>` tambien funcionaria, pero entonces cualquier cosa renderizada en
     * un portal fuera del body -o el propio `<html>` en una impresion- se
     * quedaria sin la familia de marca.
     */
    <html
      lang={localeTag(locale)}
      className={`${bodyFont.variable} ${displayFont.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-svh flex-col bg-bg text-text">
        <NextIntlClientProvider messages={messages}>
          <a href="#main" className="lsw-skip-link">
            {t("skipToContent")}
          </a>

          {/* La banda de anuncio va POR ENCIMA de la cabecera y no es pegajosa:
              dos elementos fijos apilados se comen un tercio de la pantalla de
              un telefono. Si no hay promocion vigente -o la lectura falla- no
              renderiza nada, de modo que la cabecera queda exactamente donde
              estaba. */}
          <AnnouncementBar locale={locale} />

          <SiteHeader locale={locale} />

          <main id="main" aria-label={t("mainLandmark")} className="flex-1">
            {children}
          </main>

          <SiteFooter showMockNotice={showMockNotice} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
