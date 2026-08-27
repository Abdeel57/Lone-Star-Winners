import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * COHERENCIA DE DEC-044 FUERA DEL HERO.
 *
 * DEC-044 contuvo `PromotionHero` cuando la promocion vigente no tiene version
 * de Reglas Oficiales publicada: sin verbo, sin chip, sin cuenta atras, sin
 * universo de participaciones y sin boton rojo. Dos superficies mas hablaban de
 * la MISMA promocion sin mirar la misma senal, y por tanto la contradecian en
 * la misma pantalla:
 *
 *   1. la banda de anuncio, que va por encima del hero y ademas se repite en
 *      TODAS las paginas del sitio, seguia publicando "Abierta - cierra el 30
 *      dic 2026 - universo de 10,000 participaciones";
 *   2. el detalle de la promocion, que ya pintaba el aviso de reglas no
 *      publicadas y justo encima llevaba la cuenta atras al cierre.
 *
 * Lo que estos tests protegen no es el aspecto: es que las tres superficies
 * lean la MISMA senal. Sin ellos, cualquiera de las dos vuelve a divergir sin
 * que nada falle, exactamente como estaba.
 *
 * Cada superficie trae su mitad inversa. Sin ella, un cambio que dejara el
 * estado contenido siempre encendido pasaria en verde y el sitio se quedaria
 * mudo sobre la promocion vigente.
 */

/**
 * Locale del render en curso, para el traductor de servidor simulado.
 *
 * `vi.hoisted` porque el estado lo lee una factoria de `vi.mock`, y esas se
 * elevan por encima de los `import` de este fichero.
 */
const current = vi.hoisted((): { locale: Locale } => ({ locale: "en" }));

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
    Link: ({
      href,
      locale,
      children,
      ...rest
    }: {
      href: string;
      locale?: string;
      children: ReactNode;
    }) =>
      createElement(
        "a",
        { href: locale === undefined ? href : `/${locale}${href}`, ...rest },
        children,
      ),
  };
});

/**
 * Traductor de servidor.
 *
 * El detalle de promocion es un Server Component asincrono y resuelve su copy
 * con `getTranslations`, que fuera de una peticion de Next no tiene contexto
 * del que leer. Se sustituye por el traductor real de `next-intl` construido
 * sobre los MISMOS diccionarios que sirve la aplicacion: lo que se simula es de
 * donde sale el locale, nunca el texto.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("../../messages/en-US.json")).default;
  const es = (await import("../../messages/es-US.json")).default;

  return {
    setRequestLocale: () => undefined,
    getTranslations: () =>
      Promise.resolve(
        current.locale === "en"
          ? createTranslator({ locale: "en", messages: en })
          : createTranslator({ locale: "es", messages: es }),
      ),
  };
});

/**
 * Configuracion de servidor, con TODOS los flags en su valor seguro.
 *
 * Lo que se prueba aqui no depende de ningun flag, y dejar que la pagina
 * intentara leerlos la mandaria a la red.
 */
vi.mock("@/lib/flags-server", async () => {
  const { NO_FLAGS_LOADED } = await import("@/lib/flags");
  return { loadServerUiConfig: () => Promise.resolve({ flags: NO_FLAGS_LOADED, amoeMode: null }) };
});

/**
 * La capa de API sirve los fixtures, elegidos por `slug`.
 *
 * Se conserva el resto del modulo (`pickLocalized`, los enums del contrato):
 * sustituirlo entero convertiria el test en una simulacion de si mismo.
 */
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  const { activePromotionDetail, activePromotionWithoutRulesDetail } =
    await import("@/mocks/fixtures/promotions");

  const details = [activePromotionDetail, activePromotionWithoutRulesDetail];

  return {
    ...actual,
    fetchPromotion: (slug: string) => {
      const detail = details.find((candidate) => candidate.slug === slug);

      return Promise.resolve(
        detail === undefined
          ? {
              ok: false,
              error: { kind: "http", status: 404, code: null, requestId: null, details: null },
            }
          : { ok: true, data: detail },
      );
    },
  };
});

import PromotionDetailPage from "@/app/[locale]/promotions/[slug]/page";
import { AnnouncementBand } from "@/components/announcement-bar";
import type { Locale } from "@/i18n/locales";
import type * as ApiModule from "@/lib/api";
import {
  activePromotion,
  activePromotionDetail,
  activePromotionWithoutRules,
  activePromotionWithoutRulesDetail,
} from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

const LOCALES = ["en", "es"] as const;

function messagesFor(locale: Locale) {
  return locale === "en" ? enMessages : esMessages;
}

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * El universo de la promocion protagonista, tal como lo escribe la banda.
 *
 * Se busca la CIFRA y no la frase entera: la frase se puede reescribir sin que
 * el problema desaparezca, porque lo que no puede aparecer es el numero.
 */
const ENTRY_POOL_CAP = /10,000/;

describe("banda de anuncio sin Reglas Oficiales publicadas (DEC-044)", () => {
  it("no anuncia estado, ni plazo, ni universo, en los dos idiomas", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);

      const view = renderIn(
        locale,
        <AnnouncementBand
          promotion={activePromotionWithoutRules}
          // El universo llega DISPONIBLE a proposito, igual que en el fixture
          // adversarial del hero: lo que se retira solo se puede comprobar si el
          // dato para pintarlo estaba a mano.
          entryPool={activePromotionWithoutRulesDetail.entry_pool}
          locale={locale}
        />,
      );

      expect(screen.queryByText(ENTRY_POOL_CAP), `universo en ${locale}`).toBeNull();
      // `exact: false` busca la etiqueta DENTRO de la frase, que es como la
      // banda la escribe: "Abierta - cierra el ... - universo de ...".
      expect(
        screen.queryByText(messages.promotionStatus.ACTIVE, { exact: false }),
        `estado en ${locale}`,
      ).toBeNull();
      // El plazo: la banda lo escribe en formato medio, asi que se busca el ano.
      expect(screen.queryByText(/2026/), `plazo en ${locale}`).toBeNull();

      view.unmount();
    }
  });

  it("dice lo unico que hay que decir, una vez y sin rotacion", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);

      const view = renderIn(
        locale,
        <AnnouncementBand
          promotion={activePromotionWithoutRules}
          entryPool={activePromotionWithoutRulesDetail.entry_pool}
          locale={locale}
        />,
      );

      // La banda NO desaparece: enmudecerla dejaria el sitio sin ninguna senal
      // de por que el hero se ha quedado corto.
      const band = screen.getByRole("region", { name: messages.a11y.announcements });
      expect(band).toBeInTheDocument();

      expect(screen.getByText(messages.announcement.rulesPending)).toBeInTheDocument();
      expect(screen.queryByText(messages.announcement.officialRules)).toBeNull();

      /*
       * Y sin la clase de rotacion. No es estilo: `.lsw-announce-item` arranca
       * en `opacity: 0` y solo es legible porque hay una segunda frase cubriendo
       * el hueco. Una unica frase con esa clase estaria invisible la mitad del
       * tiempo, que es la forma mas silenciosa de perder el aviso.
       */
      expect(view.container.querySelectorAll(".lsw-announce-item")).toHaveLength(0);

      view.unmount();
    }
  });

  it("con la version de reglas declarada, la banda sigue anunciando la promocion", () => {
    const { container } = renderIn(
      "es",
      <AnnouncementBand
        promotion={activePromotion}
        entryPool={activePromotionDetail.entry_pool}
        locale="es"
      />,
    );

    expect(screen.getByText(ENTRY_POOL_CAP)).toBeInTheDocument();
    expect(
      screen.getByText(esMessages.promotionStatus.ACTIVE, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(esMessages.announcement.officialRules)).toBeInTheDocument();

    // Dos frases, y las dos rotan.
    expect(container.querySelectorAll(".lsw-announce-item")).toHaveLength(2);
  });
});

describe("detalle de promocion sin Reglas Oficiales publicadas (DEC-044)", () => {
  it("retira la cuenta atras y conserva el plazo escrito, en los dos idiomas", async () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      const view = await renderPage(locale, activePromotionWithoutRules.slug);

      // Ni el marcador, que es el elemento de urgencia de la pantalla.
      expect(
        screen.queryByText(messages.countdown.closesIn),
        `cuenta atras en ${locale}`,
      ).toBeNull();
      expect(
        screen.queryByText(messages.countdown.clockNote),
        `nota del reloj en ${locale}`,
      ).toBeNull();

      // El aviso que explica el hueco sigue estando, dicho una sola vez.
      expect(screen.getByText(messages.home.rulesNotPublished)).toBeInTheDocument();

      // Y el plazo ESCRITO se queda: es fecha, no urgencia.
      expect(screen.getByText(messages.home.closesLabel)).toBeInTheDocument();
      expect(screen.getByText(messages.home.opensLabel)).toBeInTheDocument();
      expect(screen.getByText(messages.home.timeZoneNote)).toBeInTheDocument();

      view.unmount();
    }
  });

  it("tampoco publica el universo de participaciones", async () => {
    /*
     * Hoy esta pagina no pinta `entry_pool` en ninguna rama, asi que esta red
     * es preventiva: el dia que se anada la linea del universo -es el sitio
     * natural para ella- tiene que nacer ya mirando la misma senal, y no
     * repetir el fallo que DEC-044 acaba de corregir en el hero.
     */
    const view = await renderPage("en", activePromotionWithoutRules.slug);

    expect(
      activePromotionWithoutRulesDetail.entry_pool,
      "el fixture declara universo",
    ).not.toBeNull();
    expect(screen.queryByText(ENTRY_POOL_CAP)).toBeNull();

    view.unmount();
  });

  it("con la version de reglas declarada, la cuenta atras sigue estando", async () => {
    const view = await renderPage("es", activePromotion.slug);

    expect(screen.getByText(esMessages.countdown.closesIn)).toBeInTheDocument();
    expect(screen.queryByText(esMessages.home.rulesNotPublished)).toBeNull();

    view.unmount();
  });
});

async function renderPage(locale: Locale, slug: string) {
  current.locale = locale;

  const ui = await PromotionDetailPage({ params: Promise.resolve({ locale, slug }) });

  return renderIn(locale, ui);
}
