import { buttonVariants, cn } from "@lsw/ui";
import { render, screen } from "@testing-library/react";
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

import { ProductCard } from "@/components/product-card";
import { SectionHeading } from "@/components/section-heading";
import type { Locale } from "@/i18n/locales";
import { eligibleProduct, summaryOf } from "@/mocks/fixtures/catalog";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * BANDA CLARA DE MERCANCIA (DEC-039).
 *
 * Lo que se prueba aqui NO es que la banda "quede bien": eso no lo comprueba
 * una maquina, y la referencia visual la aprobo el usuario con la captura
 * delante. Lo que se prueba es el unico fallo que esta composicion puede
 * producir y que nadie ve hasta que esta desplegado: **texto de la paleta
 * oscura sobre superficie clara**.
 *
 * Dos paletas conviven ahora en la misma pagina. `text-text` es blanco calido y
 * `text-light-text` es tinta casi negra; las dos leen igual de bien en su banda
 * y son ilegibles en la contraria. Ningun tipo lo impide -son cadenas de
 * clases- asi que la red es esta.
 *
 * El caso mas facil de colar es el oro: `--lsw-color-brand` da 9,4:1 sobre el
 * negro de pagina y 2,3:1 sobre el blanco calido de la banda. Es el mismo token
 * y la misma clase; solo cambia lo que tiene detras.
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

/** Clases de la tarjeta de producto, ya fusionadas por `cn`. */
function cardClassName(): string {
  const { container } = renderIn(
    "en",
    <ProductCard product={summaryOf(eligibleProduct)} locale="en" />,
  );

  return container.firstElementChild?.className ?? "";
}

describe("ProductCard sobre banda clara", () => {
  it("se pinta con la paleta clara y no con la del sistema oscuro", () => {
    const className = cardClassName();

    expect(className).toContain("bg-light-surface");
    expect(className).toContain("text-light-text");
    expect(className).toContain("border-light-border");

    // `cn` tiene que haber DESCARTADO las clases oscuras que trae `Card` por
    // defecto, no dejarlas conviviendo con las claras: si ambas llegan al DOM,
    // quien decide es el orden en el que Tailwind emitio el CSS, que no es un
    // contrato que nadie haya firmado.
    expect(className).not.toMatch(/(^|\s)bg-surface(\s|$)/);
    expect(className).not.toMatch(/(^|\s)text-text(\s|$)/);
    expect(className).not.toMatch(/(^|\s)border-border(\s|$)/);
  });

  it("la elevacion es la de banda clara y sustituye a `shadow-none`", () => {
    // `shadow-light-sm` no es un tamano de camiseta, asi que `tailwind-merge` no
    // lo reconoce como elevacion sin la extension declarada en `cn.ts`. Sin
    // ella, la tarjeta llega al DOM con `shadow-none shadow-light-sm`.
    const className = cardClassName();

    expect(className).toContain("shadow-light-sm");
    expect(className).not.toMatch(/(^|\s)shadow-none(\s|$)/);
  });

  it("el anillo de foco usa el oro de tinta, no el oro de foco del sistema", () => {
    // El de sistema (`--lsw-color-focus`) esta calibrado sobre negro y sobre el
    // blanco de la banda se queda en 1,8:1, por debajo del 3:1 que WCAG 2.4.11
    // exige a un indicador de foco.
    const className = cardClassName();

    expect(className).toContain("has-[a:focus-visible]:ring-light-gold");
    expect(className).toContain("has-[a:focus-visible]:ring-offset-light-bg");
  });

  it("el chip de elegibilidad lleva contorno de tinta sobre la foto clara", () => {
    // El relleno sigue siendo oro pleno -es la insignia protagonista- pero su
    // contorno pasa a oro de tinta: contra un fondo de estudio claro, un borde
    // dorado sobre relleno dorado no recorta nada.
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);

    const badge = screen.getByText(enMessages.shop.eligibleBadge);
    expect(badge.parentElement?.className).toContain("border-light-gold");
    expect(badge.parentElement?.className).toContain("bg-brand");
  });

  it("el chip sigue diciendo ELEGIBLE y ninguna cifra", () => {
    // DEC-039 no relaja nada de DEC-023: la referencia pone aqui las entries que
    // otorga el articulo, y eso es lo unico de su tarjeta que no se copia.
    const { container } = renderIn(
      "es",
      <ProductCard product={summaryOf(eligibleProduct)} locale="es" />,
    );

    expect(screen.getByText(esMessages.shop.eligibleBadge)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bparticipaciones\b/i);
    expect(container.textContent).not.toMatch(/\d+\s*[xX]\b/);
  });

  it("en la rejilla de dos columnas la tarjeta es imagen, nombre y precio", () => {
    // El resumen del articulo son seis lineas de texto bajo cada foto cuando la
    // tarjeta mide 165px: entierra justo lo que se esta comparando. Sigue en la
    // ficha del producto, que es donde se lee.
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);

    expect(screen.getByText("Heavyweight Cotton Tee")).toBeInTheDocument();
    expect(screen.getByText(/\$25\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Garment-dyed/)).not.toBeInTheDocument();
  });
});

describe("SectionHeading con tono", () => {
  it("sobre banda clara lleva oro de tinta, tinta y filete de tinta", () => {
    const { container } = renderIn(
      "en",
      <SectionHeading
        eyebrow={enMessages.home.featured.eyebrow}
        title={enMessages.home.featured.title}
        lead={enMessages.home.featured.body}
        tone="light"
      />,
    );

    expect(screen.getByText(enMessages.home.featured.eyebrow).className).toContain(
      "text-light-gold",
    );
    expect(screen.getByText(enMessages.home.featured.title).className).toContain("text-light-text");
    expect(screen.getByText(enMessages.home.featured.body).className).toContain(
      "text-light-text-muted",
    );
    expect(container.querySelector(".lsw-gold-rule-ink")).not.toBeNull();
    expect(container.querySelector(".lsw-gold-rule")).toBeNull();
  });

  it("por defecto sigue siendo el encabezado oscuro de siempre", () => {
    // La banda clara es una excepcion acotada a mercancia. Si el tono por
    // defecto cambiara, todas las secciones oscuras del sitio se irian con ella
    // sin que nadie tocara sus paginas.
    const { container } = renderIn(
      "en",
      <SectionHeading
        eyebrow={enMessages.home.featured.eyebrow}
        title={enMessages.home.featured.title}
      />,
    );

    expect(screen.getByText(enMessages.home.featured.title).className).toContain("text-text");
    expect(container.querySelector(".lsw-gold-rule")).not.toBeNull();
    expect(container.querySelector(".lsw-gold-rule-ink")).toBeNull();
  });
});

describe("acciones sobre banda clara", () => {
  it("`ink` e `inkGhost` llevan tinta y nunca el oro de marca como texto", () => {
    // `secondary` -contorno y texto en `--lsw-color-brand`- da 2,3:1 sobre el
    // fondo de la banda. Es la sustitucion que estas dos variantes existen para
    // forzar, y por eso se comprueba lo que NO llevan.
    for (const variant of ["ink", "inkGhost"] as const) {
      const className = cn(buttonVariants({ variant }));

      expect(className).toContain("text-light-text");
      expect(className).toContain("hover:text-light-gold");
      expect(className).not.toMatch(/(^|\s)text-brand(\s|$)/);
      // El offset del anillo de foco tiene que acabar sobre el fondo claro: un
      // halo negro alrededor de un boton blanco se lee como un borde.
      expect(className).toContain("focus-visible:ring-offset-light-bg");
      expect(className).not.toContain("focus-visible:ring-offset-bg");
    }
  });

  it("las variantes oscuras siguen intactas", () => {
    expect(cn(buttonVariants({ variant: "secondary" }))).toContain("text-brand");
    expect(cn(buttonVariants({ variant: "primary" }))).toContain("focus-visible:ring-offset-bg");
  });
});
