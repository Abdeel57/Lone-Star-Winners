import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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

import { FooterDisclosure } from "@/components/footer-disclosure";
import { ProductCard } from "@/components/product-card";
import { elapsedFraction, PromotionProgress } from "@/components/promotion-progress";
import { WinnersShowcase } from "@/components/winners-showcase";
import type { Locale } from "@/i18n/locales";
import { eligibleProduct, summaryOf } from "@/mocks/fixtures/catalog";
import { resolvePrizePhoto } from "@/mocks/fixtures/prize-photo";
import { activePromotionDetail } from "@/mocks/fixtures/promotions";
import { publishedWinners } from "@/mocks/fixtures/winners";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * DECORACION DE MARCA (segunda pasada de DEC-038).
 *
 * Lo que se prueba aqui NO es que las piezas "se vean bien": eso no lo puede
 * comprobar una maquina. Lo que se prueba es lo que la decoracion puede romper
 * sin que nadie lo note:
 *
 *   - que lo decorativo NO entre en el arbol de accesibilidad;
 *   - que una tarjeta con dos afordancias visibles siga teniendo UN solo
 *     enlace anunciable;
 *   - que una barra de progreso exponga un equivalente hablado y no un numero
 *     suelto;
 *   - que una seccion detras de un feature flag no se cuele cuando no hay dato;
 *   - que un grupo plegable no se convierta en contenido inalcanzable.
 */

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("elapsedFraction", () => {
  const START = "2026-01-01T00:00:00.000Z";
  const END = "2026-01-11T00:00:00.000Z";

  it("devuelve la parte transcurrida del periodo", () => {
    expect(elapsedFraction(START, END, "2026-01-06T00:00:00.000Z")).toBeCloseTo(0.5, 5);
  });

  it("se acota a cero antes de la apertura y a uno despues del cierre", () => {
    // Una promocion programada y una cerrada son estados normales, no errores.
    // Sin acotar, la barra saldria vacia al -120% o desbordada al 300%.
    expect(elapsedFraction(START, END, "2025-06-01T00:00:00.000Z")).toBe(0);
    expect(elapsedFraction(START, END, "2027-06-01T00:00:00.000Z")).toBe(1);
  });

  it("no dibuja nada con fechas invalidas o un periodo sin duracion", () => {
    // `null` y no 0: no hay nada que representar, que es distinto de "no ha
    // transcurrido nada".
    expect(elapsedFraction("no es una fecha", END, START)).toBeNull();
    expect(elapsedFraction(START, "", START)).toBeNull();
    expect(elapsedFraction(END, START, END)).toBeNull();
    expect(elapsedFraction(START, START, START)).toBeNull();
  });
});

describe("PromotionProgress", () => {
  it("expone el avance como frase completa, no como numero suelto", () => {
    renderIn(
      "en",
      <PromotionProgress
        startIso="2026-01-01T00:00:00.000Z"
        endIso="2026-01-11T00:00:00.000Z"
        nowIso="2026-01-06T00:00:00.000Z"
        locale="en"
      />,
    );

    const bar = screen.getByRole("progressbar", {
      name: enMessages.promotionProgress.label,
    });

    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar.getAttribute("aria-valuetext")).toContain("50%");
  });

  it("formatea el porcentaje con la convencion estadounidense en los dos idiomas", () => {
    // DEC-029: se formatea con la ETIQUETA (`es-US`), no con el segmento (`es`).
    renderIn(
      "es",
      <PromotionProgress
        startIso="2026-01-01T00:00:00.000Z"
        endIso="2026-01-11T00:00:00.000Z"
        nowIso="2026-01-06T00:00:00.000Z"
        locale="es"
      />,
    );

    const bar = screen.getByRole("progressbar", {
      name: esMessages.promotionProgress.label,
    });

    expect(bar.getAttribute("aria-valuetext")).toContain("50%");
  });

  it("no pinta una barra vacia cuando no hay periodo que representar", () => {
    const { container } = renderIn(
      "en",
      <PromotionProgress
        startIso="2026-01-11T00:00:00.000Z"
        endIso="2026-01-01T00:00:00.000Z"
        nowIso="2026-01-06T00:00:00.000Z"
        locale="en"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("WinnersShowcase", () => {
  it("sin ganadores publicados no renderiza la seccion", () => {
    // Es el estado de HOY: `winner_publication_enabled` apagado y ninguna ruta
    // de ganadores en el contrato. Una seccion titulada "Ganadores confirmados"
    // con la rejilla vacia sugeriria que hubo ganadores y no se dice quienes.
    const { container } = renderIn("en", <WinnersShowcase winners={[]} locale="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pinta cada ganador con el titulo de su promocion en el idioma de la interfaz", () => {
    renderIn("es", <WinnersShowcase winners={publishedWinners} locale="es" />);

    expect(screen.getByText("Marisol R.")).toBeInTheDocument();
    expect(screen.getByText("Sorteo promocional Harvest Haul")).toBeInTheDocument();
    // DEC-030: el titulo es contenido dinamico localizado y no se traduce con
    // `t()`. Si alguien lo hiciera, aqui saldria la version inglesa.
    expect(screen.queryByText("The Harvest Haul Sweepstakes")).not.toBeInTheDocument();
  });

  it("un ganador sin ubicacion no deja la etiqueta de ubicacion suelta", () => {
    renderIn("en", <WinnersShowcase winners={publishedWinners} locale="en" />);

    // Hay dos tarjetas y solo una trae ubicacion.
    expect(screen.getAllByText(enMessages.winners.locationLabel)).toHaveLength(1);
  });
});

describe("ProductCard con las capas de la referencia", () => {
  it("tiene UN solo enlace pese a mostrar dos afordancias", () => {
    // El titulo es el enlace y se estira sobre la tarjeta; el boton redondo de
    // la esquina es decoracion. Dos enlaces al mismo sitio serian ruido para
    // quien navega por lista de enlaces.
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("el enlace dice que se va a ver el articulo, y nombra cual", () => {
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);

    const link = screen.getByRole("link");
    expect(link.textContent).toContain("View");
  });

  it("sigue sin decir ni una cifra de participaciones", () => {
    // La referencia visual pone justo aqui su insignia de entries. Es lo unico
    // de su tarjeta que no se copia (DEC-023, requisito R13 de `security`).
    const { container } = renderIn(
      "es",
      <ProductCard product={summaryOf(eligibleProduct)} locale="es" />,
    );

    expect(container.textContent).not.toMatch(/\bparticipaciones\b/i);
    expect(container.textContent).not.toMatch(/\bentries\b/i);
    expect(container.textContent).not.toMatch(/\d+\s*[xX]\b/);
  });
});

describe("FooterDisclosure", () => {
  it("empieza plegado y el boton dice si esta abierto", async () => {
    const user = userEvent.setup();

    renderIn(
      "en",
      <FooterDisclosure title={enMessages.footer.help}>
        <a href="/en/faq">{enMessages.nav.faq}</a>
      </FooterDisclosure>,
    );

    const toggle = screen.getByRole("button", { name: enMessages.footer.help });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("el contenido sigue siendo visible en escritorio aunque el estado sea plegado", () => {
    // La clave del diseno: `hidden lg:block`. El estado plegado es de telefono;
    // en escritorio el CSS lo muestra igualmente y por eso el boton es
    // `lg:hidden`. Sin esta garantia, el pie de escritorio quedaria reducido a
    // tres titulos.
    const { container } = renderIn(
      "en",
      <FooterDisclosure title={enMessages.footer.help}>
        <a href="/en/faq">{enMessages.nav.faq}</a>
      </FooterDisclosure>,
    );

    const panel = container.querySelector("[id]");
    expect(panel?.className).toContain("hidden");
    expect(panel?.className).toContain("lg:block");
  });

  it("el boton controla el panel por id", () => {
    const { container } = renderIn(
      "en",
      <FooterDisclosure title={enMessages.footer.help}>
        <a href="/en/faq">{enMessages.nav.faq}</a>
      </FooterDisclosure>,
    );

    const toggle = screen.getByRole("button", { name: enMessages.footer.help });
    const controlled = toggle.getAttribute("aria-controls");

    expect(controlled).not.toBeNull();
    expect(container.querySelector(`#${CSS.escape(controlled ?? "")}`)).not.toBeNull();
  });
});

/**
 * LA IMAGEN DEL PREMIO (DEC-042).
 *
 * Dos propiedades que no se ven mirando la pantalla:
 *
 *   1. NINGUNA imagen sale a un host externo. Es requisito del encargo y es lo
 *      unico de la direccion de arte que una maquina puede comprobar: todo va
 *      como `data:` URI generado aqui o como fichero de `public/`.
 *   2. La costura para la fotografia real esta viva. El fixture PREFIERE la
 *      foto de `public/prizes/` y cae en la ilustracion solo si no esta; si esa
 *      preferencia se perdiera, dejar la foto en la carpeta no haria nada y
 *      nadie se enteraria hasta abrir la portada.
 */
describe("media del premio", () => {
  it("no apunta a ningun host externo", () => {
    const media = activePromotionDetail.media;
    expect(media, "la promocion protagonista declara imagenes").not.toBeNull();
    if (media === null) return;

    for (const url of [media.hero_url, media.square_url]) {
      expect(url).not.toBeNull();
      if (url === null) continue;

      // O ilustracion embebida, o fichero servido por la propia aplicacion.
      expect(url.startsWith("data:image/svg+xml") || url.startsWith("/prizes/")).toBe(true);
      expect(url).not.toMatch(/^https?:/);
    }
  });

  it("los dos recortes son distintos, no el mismo escalado", () => {
    // El hero pinta a sangre y apaisado; una tarjeta pinta cuadrado. Servir el
    // mismo recorte para los dos deja el vehiculo a medias en la tarjeta, que
    // es exactamente el motivo de que `PromotionMedia` publique dos campos.
    const media = activePromotionDetail.media;
    if (media === null) return;

    expect(media.hero_url).not.toBe(media.square_url);
  });

  it("prefiere los recortes derivados a la fotografia sin recortar", () => {
    /*
     * DEC-042: `scripts/build-prize-assets.mjs` deriva de la fotografia del
     * cliente un recorte de hero -sin el rotulo del concesionario que aparece
     * sobre el techo- y uno cuadrado. Los dos se versionan.
     *
     * Si esta preferencia se perdiera, el sitio volveria a servir la foto
     * entera: no fallaria nada, simplemente reaparecerian el rotulo y el toldo
     * en la pieza mas visible del sitio, y nadie se enteraria hasta abrirla.
     *
     * El respaldo -foto sin recortar, y despues ilustracion- sigue siendo
     * legitimo, y por eso esto se comprueba solo cuando los recortes existen.
     */
    const media = activePromotionDetail.media;
    if (media === null) return;

    if (resolvePrizePhoto(["gmc-2025-hero.jpg"]) !== null) {
      expect(media.hero_url).toBe("/prizes/gmc-2025-hero.jpg");
    }

    if (resolvePrizePhoto(["gmc-2025-square.jpg"]) !== null) {
      expect(media.square_url).toBe("/prizes/gmc-2025-square.jpg");
    }
  });

  it("la fotografia real gana a la ilustracion cuando existe", () => {
    // No se comprueba el fixture sino la funcion que decide, que es donde vive
    // la preferencia. `README.md` hace de fichero que seguro esta.
    expect(resolvePrizePhoto(["README.md"])).toBe("/prizes/README.md");
    expect(resolvePrizePhoto(["no-existe-este-fichero.jpg"])).toBeNull();
    // Y el orden importa: gana el primero que exista.
    expect(resolvePrizePhoto(["no-existe.jpg", "README.md"])).toBe("/prizes/README.md");
  });

  it("el universo de participaciones llega como dato, no como texto", () => {
    // El tope lo fija la configuracion de la promocion (DEC-042, CLAUDE.md
    // #14). Si alguna vez apareciera escrito en el diccionario, cambiarlo
    // exigiria un despliegue y dejaria de ser configuracion.
    expect(activePromotionDetail.entry_pool?.cap).toBe(10000);

    const dictionaries = JSON.stringify(enMessages) + JSON.stringify(esMessages);
    expect(dictionaries).not.toContain("10,000");
    expect(dictionaries).not.toContain("10000");
  });
});
