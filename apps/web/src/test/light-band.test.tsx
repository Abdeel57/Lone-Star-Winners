import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buttonVariants, cn } from "@lsw/ui";
import { render, screen, within } from "@testing-library/react";
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

import { MerchandiseBand } from "@/components/merchandise-band";
import { ProductCard } from "@/components/product-card";
import { SectionHeading } from "@/components/section-heading";
import type { Locale } from "@/i18n/locales";
import {
  catalog,
  catalogWithoutPromotion,
  eligibleProduct,
  ineligibleProduct,
  soldOutProduct,
  summaryOf,
} from "@/mocks/fixtures/catalog";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * BANDA CLARA DE MERCANCIA (DEC-039, ampliada por DEC-040).
 *
 * Lo que se prueba aqui NO es que la banda "quede bien": eso no lo comprueba
 * una maquina, y la referencia visual la aprobo el usuario con la captura
 * delante. Lo que se prueba es el unico fallo que esta composicion puede
 * producir y que nadie ve hasta que esta desplegado: **paleta oscura sobre
 * superficie clara**.
 *
 * Dos paletas conviven ahora en la misma pagina. `text-text` es blanco calido y
 * `text-light-text` es tinta casi negra; las dos leen igual de bien en su banda
 * y son ilegibles en la contraria. Ningun tipo lo impide -son cadenas de
 * clases- asi que la red es esta.
 *
 * El caso mas facil de colar es el oro: `--lsw-color-brand` da 9,4:1 sobre el
 * negro de pagina y 2,3:1 sobre el blanco calido de la banda. Es el mismo token
 * y la misma clase; solo cambia lo que tiene detras.
 *
 * La revision adversarial de DEC-039 encontro tres colados que esta red no
 * cubria y que ahora si cubre: el COLOR del anillo de foco de las acciones (que
 * solo reasignaba el offset), las insignias neutras -que se pintaban con la
 * paleta oscura entera dentro de una tarjeta blanca- y el supuesto, escrito
 * solo en un comentario, de que la tarjeta siempre vive dentro de la banda.
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

/**
 * Raiz de la insignia que CONTIENE ese texto.
 *
 * `Badge` envuelve sus hijos en un `span.truncate`, y el chip pone ademas el
 * texto largo en un `span.sr-only` dentro de el, asi que el nodo que devuelve
 * `getByText` esta a uno o dos niveles de la insignia. Se sube por el DOM hasta
 * el elemento que lleva las clases de color, que es lo que se quiere afirmar.
 */
function badgeRootOf(text: string): HTMLElement {
  const node = screen.getByText(text);
  const root = node.closest("span.inline-flex");
  expect(root, `no se encontro la insignia de "${text}"`).not.toBeNull();
  return root as HTMLElement;
}

/** Clases de TODOS los elementos de un arbol, para buscar colados de paleta. */
function allClassNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("[class]")].map((node) => node.className);
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
    // El de sistema (`--lsw-color-focus`, #f2d680) esta calibrado sobre negro y
    // sobre el blanco de la banda se queda en 1,35:1, por debajo del 3:1 que
    // WCAG 1.4.11 exige a un indicador de foco. El oro de tinta mide 5,58:1.
    const className = cardClassName();

    expect(className).toContain("has-[a:focus-visible]:ring-light-gold");
    expect(className).toContain("has-[a:focus-visible]:ring-offset-light-bg");
  });

  it("el enlace estirado lleva la clase con respaldo para navegadores sin `:has()`", () => {
    // El enlace renuncia a su contorno propio porque el anillo lo pinta la
    // tarjeta con `has-[a:focus-visible]`. Donde `:has()` no existe, esa regla
    // tampoco, y sin el respaldo de `.lsw-stretched-link` el foco se quedaria
    // sin ninguna senal visible.
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);

    const link = screen.getByRole("link");
    expect(link.className).toContain("lsw-stretched-link");
    expect(link.className).not.toMatch(/(^|\s)outline-none(\s|$)/);
  });

  it("el chip de elegibilidad lleva contorno de tinta sobre la foto clara", () => {
    // El relleno sigue siendo oro pleno -es la insignia protagonista- pero su
    // contorno pasa a oro de tinta: contra un fondo de estudio claro, un borde
    // dorado sobre relleno dorado no recorta nada.
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);

    const badge = badgeRootOf(enMessages.shop.eligibleChip);
    expect(badge.className).toContain("border-light-gold");
    expect(badge.className).toContain("bg-brand");
  });

  it("ningun chip pinta la paleta oscura dentro de la tarjeta blanca", () => {
    // Hallazgo F1: `tone="neutral"` sin `surface="light"` se resuelve a
    // `bg-surface-raised` (#18181c) con texto claro, es decir, un bloque casi
    // negro en la esquina superior de una foto de estudio claro. Y no era un
    // caso raro: entre promociones la elegibilidad es `null` en TODOS los
    // articulos, asi que lo llevaba la rejilla entera a la vez.
    const cases = [
      summaryOf(eligibleProduct),
      summaryOf(ineligibleProduct),
      summaryOf(soldOutProduct),
      { ...summaryOf(eligibleProduct), entry_eligibility: null },
    ];

    for (const product of cases) {
      const view = renderIn("en", <ProductCard product={product} locale="en" />);
      const offenders = allClassNames(view.container).filter((className) =>
        /(^|\s)(bg-surface-raised|bg-surface|text-text|text-text-muted|border-border-strong)(\s|$)/.test(
          className,
        ),
      );

      expect(offenders, `${product.slug}: clases de la paleta oscura`).toEqual([]);
      view.unmount();
    }
  });

  it("los tres estados de elegibilidad se ven cortos y se anuncian enteros", () => {
    // Hallazgos A4 y F2: la frase completa ("Forma parte de la promocion
    // vigente") necesita ~238px y la insignia dispone de ~142px en la rejilla de
    // dos columnas a 360px, asi que se truncaba a mitad de palabra. Lo VISIBLE
    // es ahora la etiqueta corta; la frase larga sigue existiendo y es la que
    // oye un lector de pantalla.
    const cases = [
      {
        product: summaryOf(eligibleProduct),
        short: esMessages.shop.eligibleChip,
        full: esMessages.shop.eligibleBadge,
      },
      {
        product: summaryOf(ineligibleProduct),
        short: esMessages.shop.notEligibleChip,
        full: esMessages.shop.notEligibleBadge,
      },
      {
        product: { ...summaryOf(eligibleProduct), entry_eligibility: null },
        short: esMessages.shop.eligibilityUnknownChip,
        full: esMessages.shop.eligibilityUnknown,
      },
    ] as const;

    for (const { product, short, full } of cases) {
      const view = renderIn("es", <ProductCard product={product} locale="es" />);

      expect(screen.getByText(short), short).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(full).className, full).toContain("sr-only");

      view.unmount();
    }
  });

  it("el chip sigue sin decir ninguna cifra", () => {
    // DEC-039 no relaja nada de DEC-023: la referencia pone aqui las entries que
    // otorga el articulo, y eso es lo unico de su tarjeta que no se copia.
    const { container } = renderIn(
      "es",
      <ProductCard product={summaryOf(eligibleProduct)} locale="es" />,
    );

    expect(screen.getByText(esMessages.shop.eligibleChip)).toBeInTheDocument();
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

  it("el nivel del titulo lo decide la pagina, no la tarjeta", () => {
    // Hallazgo A5: en la portada la franja destacada ya tiene su propio `h2`, y
    // unas tarjetas en `h2` serian sus HERMANAS en el esquema del documento.
    const view = renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    view.unmount();

    renderIn(
      "en",
      <ProductCard product={summaryOf(eligibleProduct)} locale="en" headingLevel="h3" />,
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
  });
});

describe("MerchandiseBand", () => {
  it("cada tarjeta tiene un ancestro con la banda clara", () => {
    // Hallazgo M7: `ProductCard` no tiene variante oscura y da por supuesto que
    // vive dentro de `.lsw-band-light`. Ese supuesto estaba escrito en un
    // comentario. Aqui se comprueba en el DOM.
    const { container } = renderIn(
      "en",
      <MerchandiseBand products={catalog} locale="en" headingLevel="h3" />,
    );

    const cards = container.querySelectorAll("li");
    expect(cards.length).toBe(catalog.length);

    for (const card of cards) {
      expect(card.closest(".lsw-band-light")).not.toBeNull();
    }
  });

  it("sin articulos la banda SIGUE pintandose, con el estado vacio dentro", () => {
    // Hallazgo M5: el esqueleto de `/shop` dibuja la banda desde el primer
    // fotograma. Si la pagina real solo la pintara cuando hay resultados, un
    // catalogo vacio produciria justo el salto -blanco de golpe a negro- que el
    // esqueleto existe para evitar.
    const { container } = renderIn(
      "en",
      <MerchandiseBand products={[]} locale="en" empty={<p>vacio</p>} />,
    );

    const band = container.querySelector(".lsw-band-light");
    expect(band).not.toBeNull();
    expect(within(band as HTMLElement).getByText("vacio")).toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("la accion de paginacion no aparece sin articulos", () => {
    const { container } = renderIn(
      "en",
      <MerchandiseBand products={[]} locale="en" footer={<p>ver mas</p>} />,
    );

    expect(container.textContent).not.toContain("ver mas");
  });

  it("entre promociones la rejilla entera sigue en paleta clara", () => {
    // El caso real de hoy: `entry_eligibility` es `null` en todos los articulos.
    const { container } = renderIn(
      "en",
      <MerchandiseBand products={catalogWithoutPromotion} locale="en" />,
    );

    const offenders = allClassNames(container).filter((className) =>
      /(^|\s)(bg-surface-raised|text-text)(\s|$)/.test(className),
    );

    expect(offenders).toEqual([]);
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

  it("la accion comparte linea con el titular tambien en movil", () => {
    // Hallazgo F7: con la accion en su propia linea por debajo de `sm`, el
    // enlace caia ENTRE el filete dorado y la entradilla, en mitad del
    // encabezado. La fila es ahora incondicional.
    const { container } = renderIn(
      "en",
      <SectionHeading
        title={enMessages.home.featured.title}
        lead={enMessages.home.featured.body}
        tone="light"
        action={<a href="/shop">{enMessages.home.featured.viewAllShort}</a>}
      />,
    );

    const row = screen.getByText(enMessages.home.featured.viewAllShort).parentElement
      ?.parentElement;
    expect(row?.className).toContain("flex-row");
    expect(row?.className).not.toContain("flex-col");
    expect(container.querySelector(".min-w-0")).not.toBeNull();
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
    }
  });

  it("el anillo de foco cambia de COLOR, no solo de offset", () => {
    // Hallazgo M2/A1, y el motivo de que este test exista en esta forma: la
    // version anterior solo afirmaba el offset, asi que certificaba como
    // correcta una variante cuyo anillo seguia siendo el oro de foco del
    // sistema (#f2d680), que sobre la banda mide 1,35:1 y sobre el relleno
    // blanco del boton 1,43:1. WCAG 1.4.11 pide 3:1. El oro de tinta mide
    // 5,58:1 y 5,92:1.
    for (const variant of ["ink", "inkGhost"] as const) {
      const className = cn(buttonVariants({ variant }));

      expect(className, variant).toContain("focus-visible:ring-light-gold");
      expect(className, variant).not.toContain("focus-visible:ring-focus");

      // Y el offset sobre el fondo de la banda: un halo negro alrededor de un
      // boton blanco se lee como un borde, no como foco.
      expect(className, variant).toContain("focus-visible:ring-offset-light-bg");
      expect(className, variant).not.toContain("focus-visible:ring-offset-bg");
    }
  });

  it("las variantes oscuras siguen intactas", () => {
    expect(cn(buttonVariants({ variant: "secondary" }))).toContain("text-brand");
    expect(cn(buttonVariants({ variant: "primary" }))).toContain("focus-visible:ring-focus");
    expect(cn(buttonVariants({ variant: "primary" }))).toContain("focus-visible:ring-offset-bg");
  });
});

/*
 * Las tres redes siguientes leen ARCHIVOS FUENTE.
 *
 * Es el mismo recurso que `no-hardcoded-copy.test.ts` y `server-render.test.ts`,
 * y por el mismo motivo: lo que hay que verificar no es el comportamiento de un
 * componente sino una propiedad EMERGENTE de como estan escritas las paginas y
 * la hoja de estilos, que ningun render puede observar.
 *
 * (Se usa `fileURLToPath(import.meta.url)` y no `new URL(".", import.meta.url)`
 * por el motivo documentado en `no-hardcoded-copy.test.ts`: Vite reescribe ese
 * segundo patron y dentro de Vitest no se evalua como esta escrito.)
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function readSource(...segments: string[]): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de import.meta.url, no de entrada de usuario
  return readFileSync(join(HERE, "..", ...segments), "utf8");
}

describe("la tarjeta solo se compone dentro de la banda (M7)", () => {
  it("`ProductCard` se renderiza en un unico archivo, y ese archivo pinta la banda", () => {
    const band = readSource("components", "merchandise-band.tsx");
    expect(band).toContain("<ProductCard");
    expect(band).toContain("lsw-band-light");

    // Las paginas componen la banda, no la tarjeta. Si alguna volviera a
    // renderizar `ProductCard` por su cuenta, podria hacerlo sobre fondo negro
    // y la tarjeta -que no tiene paleta oscura- se veria blanca sobre negro con
    // su propio texto en tinta.
    for (const page of [
      readSource("app", "[locale]", "page.tsx"),
      readSource("app", "[locale]", "shop", "page.tsx"),
    ]) {
      expect(page).not.toContain("<ProductCard");
      expect(page).toContain("MerchandiseBand");
    }
  });
});

describe("la hoja de estilos de las superficies claras", () => {
  const globals = readSource("app", "globals.css");

  it("reasigna `::selection`, que si no es texto casi blanco sobre oro palido", () => {
    // Hallazgo A2/F4: la regla global pinta la seleccion con `--lsw-color-text`
    // sobre un velo de oro al 30%. Sobre negro eso da 10,6:1; sobre blanco el
    // velo compone #efe3be y el texto seguia siendo casi blanco: 1,15:1, es
    // decir, seleccionar el nombre de un articulo lo hacia desaparecer.
    expect(globals).toMatch(/\.lsw-band-light\s+::selection/);
    expect(globals).toMatch(/\.lsw-panel-light\s+::selection/);
  });

  it("declara `color-scheme: light` para los controles nativos", () => {
    // Hallazgo A3: `:root` declara `color-scheme: dark`, asi que todo lo que
    // pinta el navegador -barras de desplazamiento, `<select>`, calendarios-
    // llegaria oscuro dentro de una superficie blanca.
    const recipe = globals.slice(globals.indexOf(".lsw-band-light,"));
    expect(recipe.slice(0, 400)).toContain("color-scheme: light");
  });

  it("devuelve el contorno de foco donde no hay `:has()`", () => {
    // Hallazgo A7.
    expect(globals).toContain("@supports not selector(:has(*))");
    expect(globals).toMatch(/\.lsw-stretched-link:focus-visible/);
  });
});

describe("el patron topografico tiene una sola definicion (M6)", () => {
  /** Los nueve `d` de una tinta, en orden. */
  function geometryOf(token: string): string[] {
    return [...decodeURIComponent(token).matchAll(/<path d='([^']+)'\/>/g)].map(
      (match) => match[1] ?? "",
    );
  }

  it("las tres tintas comparten geometria exacta", async () => {
    // Hallazgo M6: eran tres cadenas de ~1,5 KB escritas a mano en `tokens.css`,
    // con los mismos nueve `path` repetidos, y habia que editarlas a la vez.
    const { topoTokens } = await import("@lsw/design-system/tailwind-preset");
    const tokens = topoTokens();

    const gold = geometryOf(tokens["--lsw-pattern-topo"]);
    const ink = geometryOf(tokens["--lsw-pattern-topo-ink"]);
    const soft = geometryOf(tokens["--lsw-pattern-topo-ink-soft"]);

    expect(gold.length).toBe(9);
    expect(ink).toEqual(gold);
    expect(soft).toEqual(gold);

    // Y difieren solo en la tinta: color, opacidad y grosor del trazo.
    expect(tokens["--lsw-pattern-topo"]).toContain("c9a227");
    expect(tokens["--lsw-pattern-topo-ink"]).not.toContain("c9a227");
    expect(tokens["--lsw-pattern-topo-ink"]).not.toBe(tokens["--lsw-pattern-topo-ink-soft"]);
  });

  it("cada curva cierra a la misma altura a la que abre, o el mosaico costura", async () => {
    // Es la propiedad que hace que la repeticion horizontal no deje una linea
    // visible cada 640px, y la unica del patron que una maquina puede comprobar.
    const { topoTokens } = await import("@lsw/design-system/tailwind-preset");

    const curves = geometryOf(topoTokens()["--lsw-pattern-topo"]);
    expect(curves.length).toBe(9);

    for (const curve of curves) {
      const start = /^M0 (\d+)/.exec(curve);
      const end = /640 (\d+)$/.exec(curve);
      expect(start?.[1], curve).toBe(end?.[1]);
    }
  });

  it("`tokens.css` ya no declara ninguna de las tres a mano", () => {
    const tokens = readSource(
      "..",
      "..",
      "..",
      "packages",
      "design-system",
      "src",
      "styles",
      "tokens.css",
    );

    expect(tokens).not.toContain("--lsw-pattern-topo:");
    expect(tokens).not.toContain("--lsw-pattern-topo-ink:");
    expect(tokens).not.toContain("--lsw-pattern-topo-ink-soft:");
    // Y sigue apuntando a donde estan ahora, para que quien busque el token
    // aqui no concluya que ha desaparecido.
    expect(tokens).toContain("tailwind-preset.mjs");
  });
});
