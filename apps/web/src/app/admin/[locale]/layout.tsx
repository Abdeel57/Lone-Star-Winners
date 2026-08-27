import "@lsw/design-system/tokens.css";
import "../../globals.css";

import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { isLocale, localeTag } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";

import { bodyFont, displayFont } from "../../fonts";

/**
 * Layout raiz del PANEL (DEC-048).
 *
 * POR QUE EXISTE UN SEGUNDO LAYOUT RAIZ
 * -------------------------------------
 * El del escaparate vive en `app/[locale]/layout.tsx` y solo cubre `/es/...` y
 * `/en/...`. El panel esta deliberadamente fuera de ese arbol: la cookie de
 * personal tiene `Path=/admin` (DEC-006) y bajo `/es/admin` el navegador no la
 * enviaria, de modo que el panel quedaria permanentemente deslogueado. Asi que
 * el panel necesita su propio `<html>`, su propio proveedor de i18n y su propia
 * negociacion de idioma (la hace el middleware).
 *
 * MISMO DICCIONARIO, NO OTRO. El panel usa `messages/en-US.json` y
 * `messages/es-US.json` bajo el espacio `admin.*`. Un diccionario aparte se
 * quedaria fuera del test de paridad y del escaner de copy, que son las dos
 * redes que garantizan el principio #4.
 *
 * EL IDIOMA SE PASA EXPLICITO A `loadMessages` y a `getTranslations`, en vez de
 * dejarlo salir de `requestLocale`: quien pone `requestLocale` es el middleware
 * de next-intl, y bajo `/admin` ese middleware NO corre. Depender de el aqui
 * daria el panel entero en el idioma de desempate sin que nada fallara.
 */

/** El panel entero depende de la sesion: nunca se prerenderiza. */
export const dynamic = "force-dynamic";

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
  if (!isLocale(locale)) notFound();

  const t = await getTranslations({ locale, namespace: "admin.meta" });

  return {
    title: t("title"),
    description: t("description"),
    /*
     * NADA DEL PANEL SE INDEXA. No es una preferencia de posicionamiento: un
     * buscador que indexe `/admin/es/participants` publica la existencia y la
     * forma de la superficie mas sensible del sistema, y sus estados de error
     * pueden filtrar mas de lo que parece. Se declara aqui, en el layout raiz
     * del panel, para que valga para todas sus paginas sin que ninguna tenga
     * que acordarse.
     */
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function AdminRootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  /*
   * QUIEN LE DICE A next-intl EN QUE IDIOMA ESTAMOS.
   *
   * En el escaparate lo hace su middleware, que escribe el locale en la
   * peticion. Bajo `/admin` ese middleware NO corre (DEC-048), asi que sin esta
   * linea `requestLocale` quedaria sin resolver y todo componente de servidor
   * que use `useTranslations()` -entre ellos `ApiErrorState`- pintaria en el
   * idioma de desempate. Es decir: el panel entero en ingles, sin que nada
   * fallara y sin que ningun test de paridad lo detectara.
   *
   * Se llama tambien en cada pagina del panel: el layout es lo primero que se
   * ejecuta, pero repetirlo cuesta una linea y evita que una pagina nueva
   * dependa de un orden de ejecucion que no controla.
   */
  setRequestLocale(locale);

  const messages = await loadMessages(locale);
  const t = await getTranslations({ locale, namespace: "a11y" });

  return (
    <html
      lang={localeTag(locale)}
      className={`${bodyFont.variable} ${displayFont.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-svh flex-col bg-bg text-text">
        {/*
         * `timeZone` explicito y no heredado: DEC-011 prohibe que la zona del
         * servidor decida como se formatea nada. UTC es la zona NEUTRA de
         * formateo; los instantes legalmente relevantes se formatean contra
         * `legal_timezone` de su promocion, que llega en los datos.
         */}
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
          <a href="#admin-main" className="lsw-skip-link">
            {t("skipToContent")}
          </a>

          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
