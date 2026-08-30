import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
    redirect: () => undefined,
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

// Las Server Actions no se pueden importar en un entorno de test de jsdom: son
// funciones marcadas `"use server"` que Next transforma en tiempo de build. Se
// sustituyen por funciones vacias porque lo que se prueba aqui es lo que la
// pantalla PINTA, no lo que la accion HACE.
vi.mock("@/lib/cart-actions", () => ({
  addToCartAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
  updateCartItemAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
  removeCartItemAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
  updateCartItemFormAction: () => Promise.resolve(undefined),
  removeCartItemFormAction: () => Promise.resolve(undefined),
}));

import { CartLineRow } from "@/components/cart-line-row";
import { CartSummaryMeta } from "@/components/cart-summary-meta";
import { EntryQuotePanel } from "@/components/entry-quote-panel";
import { ProductCard } from "@/components/product-card";
import { ShopFilters } from "@/components/shop-filters";
import type { Locale } from "@/i18n/locales";
import { isProductSoldOut, productAvailabilityStatus } from "@/lib/product-availability";
import {
  baseQuote,
  cappedQuote,
  cartWithAvailabilityStates,
  cartWithoutQuote,
  cartWithQuote,
  cartWithTwoVariantsOfSameProduct,
  eligibleCartLine,
  emptyCartWithQuote,
  ineligibleCartLine,
  lowStockCartLine,
  multipliedQuote,
  outOfStockCartLine,
} from "@/mocks/fixtures/cart";
import {
  caps,
  catalog,
  catalogWithoutPromotion,
  eligibleProduct,
  entryPackages,
  ineligibleProduct,
  productDetails,
  soldOutProduct,
  summaryOf,
  tumblers,
} from "@/mocks/fixtures/catalog";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Storefront y carrito (FE-M3).
 *
 * LA RED MAS IMPORTANTE DE ESTE FICHERO
 * -------------------------------------
 * No es que las tarjetas se pinten: es que el storefront NO diga cuantas
 * participaciones da un articulo. `docs/API_CONTRACT.md` prohibe que el
 * catalogo declare esa cifra (la formula pertenece a la version de reglas,
 * DEC-012) y el requisito R13 de `security` prohibe calcularla en el cliente.
 *
 * Un test que solo comprobara que la tarjeta se ve no detectaria a nadie
 * anadiendo un "gana ~125 participaciones" calculado a partir del precio, que
 * es exactamente el cambio bienintencionado que hay que impedir.
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

describe("ProductCard", () => {
  it("no muestra ninguna cifra de participaciones", () => {
    // El catalogo no declara entries y la tarjeta no las calcula. Si alguien
    // anadiera una estimacion a partir del precio, esto la detecta.
    const { container } = renderIn(
      "en",
      <ProductCard product={summaryOf(eligibleProduct)} locale="en" />,
    );

    expect(container.textContent).not.toMatch(/\bentries\b/i);
    expect(container.textContent).not.toMatch(/\bparticipaciones\b/i);
  });

  it("dice que el articulo forma parte de la promocion, no cuanto otorga", () => {
    renderIn("es", <ProductCard product={summaryOf(eligibleProduct)} locale="es" />);
    expect(screen.getByText(esMessages.shop.eligibleBadge)).toBeInTheDocument();
  });

  it("un articulo no elegible se marca sin sugerir que sea peor", () => {
    renderIn("en", <ProductCard product={summaryOf(ineligibleProduct)} locale="en" />);
    expect(screen.getByText(enMessages.shop.notEligibleBadge)).toBeInTheDocument();
  });

  it("sin promocion contra la que evaluar NO dice 'no elegible'", () => {
    // Tercer estado, y el que se colapsa por descuido. Entre promociones el
    // articulo no esta excluido: es que no hay nada de lo que excluirlo.
    const product = catalogWithoutPromotion[0];
    expect(product).toBeDefined();
    if (product === undefined) return;

    renderIn("en", <ProductCard product={product} locale="en" />);

    expect(screen.getByText(enMessages.shop.eligibilityUnknown)).toBeInTheDocument();
    expect(screen.queryByText(enMessages.shop.notEligibleBadge)).not.toBeInTheDocument();
  });

  it("un articulo agotado lo dice, en los dos idiomas", () => {
    for (const locale of ["en", "es"] as const) {
      const view = renderIn(
        "en",
        <ProductCard product={summaryOf(soldOutProduct)} locale={locale} />,
      );
      const messages = locale === "en" ? enMessages : esMessages;
      view.unmount();

      renderIn(locale, <ProductCard product={summaryOf(soldOutProduct)} locale={locale} />);
      expect(screen.getByText(messages.availability.OUT_OF_STOCK), locale).toBeInTheDocument();
    }
  });

  it("el precio se lee del contrato y no se recalcula", () => {
    renderIn("en", <ProductCard product={summaryOf(eligibleProduct)} locale="en" />);
    // 2500 en unidad menor son 25,00 dolares. Que aparezca "25.00" y no "2500"
    // ni "2,500" es lo que verifica que DEC-010 se respeta hasta la pantalla.
    expect(screen.getByText(/\$25\.00/)).toBeInTheDocument();
  });
});

describe("ShopFilters (§13.4, DEC-052 y DEC-053)", () => {
  it("es un formulario GET: el filtro acaba en la URL y funciona sin JavaScript", () => {
    const { container } = renderIn(
      "en",
      <ShopFilters
        action="/en/shop"
        categories={[caps, tumblers]}
        selectedCategory={null}
        selectedKind={null}
        locale="en"
      />,
    );

    const form = container.querySelector("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/en/shop");
  });

  it("el nombre de la categoria llega del backend y NO del diccionario", () => {
    /*
     * Es el cambio de DEC-053: las categorias las crea el panel, asi que su
     * nombre no puede vivir en `messages/*.json` -obligaria a un despliegue por
     * cada alta-. Llega localizado y se pinta con `pickLocalized`, sin traducir.
     */
    renderIn(
      "es",
      <ShopFilters
        action="/es/shop"
        categories={[caps, entryPackages]}
        selectedCategory={null}
        selectedKind={null}
        locale="es"
      />,
    );

    expect(
      screen.getByRole("option", { name: caps.name["es-US"] }),
      "la categoria se pinta en espanol",
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: entryPackages.name["es-US"] })).toBeInTheDocument();
  });

  it("sin categorias no se pinta un filtro vacio, y las secciones se quedan", () => {
    /*
     * El desplegable desaparece -no hay nada que elegir- pero las tres
     * secciones por TIPO siguen: parten el catalogo en superficies que se leen
     * distinto, y eso no depende de que existan categorias.
     */
    renderIn(
      "en",
      <ShopFilters
        action="/en/shop"
        categories={[]}
        selectedCategory={null}
        selectedKind={null}
        locale="en"
      />,
    );

    expect(document.querySelector("form")).toBeNull();
    expect(
      screen.getByRole("link", { name: enMessages.shop.kindEntryPackages }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: enMessages.shop.kindMerchandise })).toBeInTheDocument();
  });

  it("la seccion elegida se anuncia con `aria-current`, no solo con color", () => {
    renderIn(
      "en",
      <ShopFilters
        action="/en/shop"
        categories={[]}
        selectedCategory={null}
        selectedKind="ENTRY_PACKAGE"
        locale="en"
      />,
    );

    const current = screen.getByRole("link", { name: enMessages.shop.kindEntryPackages });
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("cambiar de seccion conserva la categoria elegida", () => {
    // Un filtro que se pierde al cambiar de pestana obliga a volver a
    // elegirlo, y quien mira gorras sigue mirando gorras.
    renderIn(
      "en",
      <ShopFilters
        action="/en/shop"
        categories={[caps]}
        selectedCategory="caps"
        selectedKind={null}
        locale="en"
      />,
    );

    const link = screen.getByRole("link", { name: enMessages.shop.kindMerchandise });
    expect(link.getAttribute("href")).toContain("category=caps");
  });
});

describe("CartLineRow", () => {
  const line = eligibleCartLine;
  const ineligibleLine = ineligibleCartLine;

  it("pinta el subtotal de linea que manda el servidor, sin multiplicar", () => {
    renderIn("en", <CartLineRow line={line} locale="en" ineligibleReasonKey={null} />);

    // 2 x 25,00 = 50,00, pero la cifra viene del backend. Si la interfaz
    // multiplicara, un descuento del servidor no se reflejaria.
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$25\.00/)).toBeInTheDocument();
  });

  it("ensena el SKU, que es lo unico que distingue dos variantes", () => {
    // El contrato publica UN nombre por linea, el del producto. Dos tallas del
    // mismo articulo llegan con el mismo `name`: sin el SKU en pantalla, quien
    // mira su carrito no puede saber cual es cual.
    const first = cartWithTwoVariantsOfSameProduct.lines[0];
    const second = cartWithTwoVariantsOfSameProduct.lines[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    expect(first.name).toEqual(second.name);
    expect(first.sku).not.toEqual(second.sku);

    const view = renderIn(
      "en",
      <CartLineRow line={first} locale="en" ineligibleReasonKey={null} />,
    );
    expect(screen.getByText(first.sku)).toBeInTheDocument();
    view.unmount();

    renderIn("en", <CartLineRow line={second} locale="en" ineligibleReasonKey={null} />);
    expect(screen.getByText(second.sku)).toBeInTheDocument();
  });

  it("dice QUE linea no cuenta, no que el carrito entero falle", () => {
    renderIn(
      "es",
      <CartLineRow line={ineligibleLine} locale="es" ineligibleReasonKey="PRODUCT_NOT_ELIGIBLE" />,
    );

    expect(screen.getByText(esMessages.ineligibility.PRODUCT_NOT_ELIGIBLE)).toBeInTheDocument();
  });

  it("un motivo desconocido cae al texto generico y nunca sale en crudo", () => {
    renderIn(
      "en",
      <CartLineRow line={line} locale="en" ineligibleReasonKey="MOTIVO_QUE_NO_EXISTE" />,
    );

    expect(screen.getByText(enMessages.ineligibility.fallback)).toBeInTheDocument();
    expect(screen.queryByText(/MOTIVO_QUE_NO_EXISTE/)).not.toBeInTheDocument();
  });

  it("no pinta imagen mientras `image_url` sea siempre `null`", () => {
    // El campo YA existe en la respuesta (HO-017) y sigue sin pintarse: el
    // contrato dice que hoy vale `null` siempre porque no hay tabla de medios.
    // Un marco permanentemente vacio en cada linea de cada carrito no es un
    // hueco a la espera de una foto, es el aspecto definitivo del carrito.
    expect(line.image_url).toBeNull();

    const { container } = renderIn(
      "en",
      <CartLineRow line={line} locale="en" ineligibleReasonKey={null} />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("cada linea dice su disponibilidad, en los dos idiomas", () => {
    // Los tres estados, con el diccionario COMPARTIDO: el catalogo y el carrito
    // publican el mismo enum calculado con el mismo predicado, y dos copys para
    // el mismo dato acabarian diciendo cosas distintas.
    const cases = [
      {
        line,
        en: enMessages.availability.IN_STOCK,
        es: esMessages.availability.IN_STOCK,
      },
      {
        line: lowStockCartLine,
        en: enMessages.availability.LOW_STOCK,
        es: esMessages.availability.LOW_STOCK,
      },
      {
        line: outOfStockCartLine,
        en: enMessages.availability.OUT_OF_STOCK,
        es: esMessages.availability.OUT_OF_STOCK,
      },
    ] as const;

    for (const locale of ["en", "es"] as const) {
      for (const expected of cases) {
        const view = renderIn(
          locale,
          <CartLineRow line={expected.line} locale={locale} ineligibleReasonKey={null} />,
        );

        expect(screen.getByText(locale === "en" ? expected.en : expected.es)).toBeInTheDocument();
        view.unmount();
      }
    }
  });

  it("`OUT_OF_STOCK` explica que es LA CANTIDAD, y no dice 'agotado'", () => {
    // La insignia sola se leeria como "se acabo". El contrato dice otra cosa:
    // esta cantidad no se puede servir hoy, que puede ser "quedan tres y
    // pediste cinco". De ahi la frase que acompana a la insignia.
    renderIn(
      "es",
      <CartLineRow line={outOfStockCartLine} locale="es" ineligibleReasonKey={null} />,
    );

    expect(screen.getByText(esMessages.cart.outOfStockNote)).toBeInTheDocument();
  });

  it("el copy compartido de `OUT_OF_STOCK` no afirma que el articulo se acabo", () => {
    // El mismo texto se ensena en el catalogo -donde se pregunta por UNA unidad
    // y si no cabe es que no queda nada- y en el carrito, donde puede significar
    // "quedan tres y pediste cinco". "Agotado" seria falso en el segundo caso,
    // asi que no puede estar en el texto compartido.
    expect(enMessages.availability.OUT_OF_STOCK).not.toMatch(/sold ?out/i);
    expect(esMessages.availability.OUT_OF_STOCK).not.toMatch(/agotad/i);
  });

  it("ningun texto de disponibilidad promete un numero de unidades", () => {
    // La cantidad exacta de existencias NO viaja en ninguna de las dos
    // superficies (HO-017 pidio expresamente que no se publicara). Un copy como
    // "quedan 3" seria una cifra inventada, y esta red es lo que impide que
    // alguien la escriba creyendo que el dato esta ahi.
    for (const messages of [enMessages, esMessages]) {
      for (const text of Object.values(messages.availability)) {
        expect(text).not.toMatch(/\d/);
      }

      expect(messages.cart.outOfStockNote).not.toMatch(/\d/);
    }
  });

  it("`OUT_OF_STOCK` NO bloquea la linea: se puede cambiar y quitar igual", () => {
    // La elegibilidad de la mercancia no entregable es una pregunta legal
    // abierta (`docs/LEGAL_PENDING.md`). Una fila que se desactivara sola
    // estaria respondiendola.
    const { container } = renderIn(
      "en",
      <CartLineRow line={outOfStockCartLine} locale="en" ineligibleReasonKey={null} />,
    );

    expect(container.querySelectorAll("form")).toHaveLength(2);
    for (const control of container.querySelectorAll("button, input")) {
      expect(control.hasAttribute("disabled")).toBe(false);
    }
  });

  it("quitar y cambiar cantidad son dos formularios distintos", () => {
    const { container } = renderIn(
      "en",
      <CartLineRow line={line} locale="en" ineligibleReasonKey={null} />,
    );

    // Un solo formulario con dos botones de envio obligaria a distinguirlos por
    // el `name` del boton, que es lo que deja de funcionar al enviar con Enter.
    expect(container.querySelectorAll("form")).toHaveLength(2);
  });

  it("manda al backend el `id` de la linea, que es la identidad del contrato", () => {
    const { container } = renderIn(
      "en",
      <CartLineRow line={line} locale="en" ineligibleReasonKey={null} />,
    );

    const hidden = container.querySelectorAll('input[name="line_id"]');
    expect(hidden).toHaveLength(2);
    for (const input of hidden) {
      expect(input.getAttribute("value")).toBe(line.id);
    }
  });
});

describe("CartSummaryMeta", () => {
  /** Prefijo del mensaje de fecha, sin el argumento ICU. */
  function updatedLabel(messages: typeof enMessages | typeof esMessages): string {
    const [prefix] = messages.cart.updatedAt.split("{when}");
    return (prefix ?? "").trim();
  }

  it("pinta las UNIDADES que publica el servidor, en los dos idiomas", () => {
    // Tres unidades en dos lineas: la cifra no es `lines.length` y no se cuenta
    // aqui. Llega de `item_count`.
    expect(cartWithQuote.item_count).toBe(3);
    expect(cartWithQuote.lines).toHaveLength(2);

    const view = renderIn(
      "en",
      <CartSummaryMeta
        itemCount={cartWithQuote.item_count}
        updatedAt={cartWithQuote.updated_at}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(screen.getByText("3 items")).toBeInTheDocument();
    view.unmount();

    renderIn(
      "es",
      <CartSummaryMeta
        itemCount={cartWithQuote.item_count}
        updatedAt={cartWithQuote.updated_at}
        locale="es"
        timeZone="UTC"
      />,
    );
    expect(screen.getByText("3 artículos")).toBeInTheDocument();
  });

  it("una sola unidad se dice en singular en los dos idiomas", () => {
    // "1 items" es el defecto que aparece en cuanto alguien concatena una `s`.
    // El plural lo resuelve el diccionario, no el componente.
    const view = renderIn(
      "en",
      <CartSummaryMeta itemCount={1} updatedAt={null} locale="en" timeZone="UTC" />,
    );
    expect(screen.getByText("1 item")).toBeInTheDocument();
    view.unmount();

    renderIn("es", <CartSummaryMeta itemCount={1} updatedAt={null} locale="es" timeZone="UTC" />);
    expect(screen.getByText("1 artículo")).toBeInTheDocument();
  });

  it("`updated_at` a `null` es AUSENCIA, no el 1 de enero de 1970", () => {
    // `new Date(null)` devuelve la epoca, que es una fecha valida para `Date` y
    // que `Number.isNaN` no detecta. Sin esta red, un carrito sin fila anunciaria
    // que se actualizo hace medio siglo.
    const { container } = renderIn(
      "en",
      <CartSummaryMeta itemCount={2} updatedAt={null} locale="en" timeZone="UTC" />,
    );

    expect(container.textContent).not.toContain("1970");
    expect(container.textContent).not.toContain(updatedLabel(enMessages));
    expect(container.textContent).toContain("2 items");
  });

  it("el carrito vacio del contrato -cero unidades, sin fecha- se pinta sin inventar nada", () => {
    expect(emptyCartWithQuote.item_count).toBe(0);
    expect(emptyCartWithQuote.updated_at).toBeNull();

    const { container } = renderIn(
      "es",
      <CartSummaryMeta
        itemCount={emptyCartWithQuote.item_count}
        updatedAt={emptyCartWithQuote.updated_at}
        locale="es"
        timeZone="UTC"
      />,
    );

    expect(container.textContent).toContain("0");
    expect(container.textContent).not.toContain("1970");
    expect(container.textContent).not.toContain(updatedLabel(esMessages));
  });

  it("la fecha se formatea en la zona que se le pasa, no en la del proceso", () => {
    // DEC-011: un instante se formatea contra una zona DECLARADA. En un
    // componente de servidor, caer en la zona por defecto seria caer en la del
    // servidor, que no es la de nadie.
    const view = renderIn(
      "en",
      <CartSummaryMeta
        itemCount={3}
        updatedAt={cartWithQuote.updated_at}
        locale="en"
        timeZone="UTC"
      />,
    );
    const inUtc = view.container.textContent ?? "";
    expect(inUtc).toContain(updatedLabel(enMessages));
    expect(inUtc).not.toContain("1970");
    view.unmount();

    const other = renderIn(
      "en",
      <CartSummaryMeta
        itemCount={3}
        updatedAt={cartWithQuote.updated_at}
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(other.container.textContent).not.toEqual(inUtc);
  });

  it("no compara la cotizacion con el carrito ni avisa de cotizacion caducada", () => {
    // El aviso NO vuelve (razonado en el propio componente): la cotizacion viaja
    // en la misma respuesta que el carrito, asi que no hay carrera que avisar.
    // Este fixture tiene los dos instantes y son distintos; aun asi, nada se
    // anuncia.
    expect(cartWithAvailabilityStates.updated_at).not.toEqual(
      cartWithAvailabilityStates.entry_quote?.evaluated_at,
    );

    const { container } = renderIn(
      "en",
      <CartSummaryMeta
        itemCount={cartWithAvailabilityStates.item_count}
        updatedAt={cartWithAvailabilityStates.updated_at}
        locale="en"
        timeZone="UTC"
      />,
    );

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("EntryQuotePanel", () => {
  it("muestra la cifra final tal como llega del backend", () => {
    renderIn("en", <EntryQuotePanel quote={baseQuote} locale="en" timeZone="UTC" />);

    expect(screen.getByText(/250 entries/)).toBeInTheDocument();
  });

  it("cuando no hay tope no enseña dos cifras iguales", () => {
    renderIn("en", <EntryQuotePanel quote={baseQuote} locale="en" timeZone="UTC" />);

    expect(screen.queryByText(/Before limits/)).not.toBeInTheDocument();
  });

  it("cuando un tope reduce la cifra, explica por que", () => {
    // Enseñar 100 cuando el participante esperaba 500, sin decir nada, es la
    // forma mas rapida de generar una reclamacion.
    const { container } = renderIn(
      "en",
      <EntryQuotePanel quote={cappedQuote} locale="en" timeZone="UTC" />,
    );

    // La cifra final aparece en el resumen Y dentro de la explicacion del tope:
    // se comprueban las dos apariciones a proposito, porque enseñar una sin la
    // otra es justo el caso que este test existe para impedir.
    expect(screen.getAllByText(/100 entries/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Before limits: 500 entries/)).toBeInTheDocument();
    // Se busca por SUBCADENA sobre el texto renderizado, no construyendo una
    // expresion regular a partir de una traduccion: un texto con parentesis o
    // acentos compilaria a un patron distinto del que se cree estar buscando.
    expect(container.textContent).toContain(enMessages.entryCap.PER_ORDER);
  });

  it("lista los multiplicadores aplicados como fraccion, sin dividir", () => {
    renderIn("es", <EntryQuotePanel quote={multipliedQuote} locale="es" timeZone="UTC" />);

    expect(screen.getByText("2×")).toBeInTheDocument();
  });

  it("sin promocion abierta lo dice, en vez de enseñar un cero sin contexto", () => {
    renderIn(
      "es",
      <EntryQuotePanel quote={cartWithoutQuote.entry_quote} locale="es" timeZone="UTC" />,
    );

    expect(screen.getByText(esMessages.cart.quote.unavailable.title)).toBeInTheDocument();
  });

  it("siempre acompana la cifra del aviso de que la rigen las Reglas Oficiales", () => {
    // Es la frase que impide que la cifra se lea como una promesa firme.
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <EntryQuotePanel quote={baseQuote} locale={locale} timeZone="UTC" />,
      );

      expect(screen.getByText(messages.cart.quote.disclaimer), locale).toBeInTheDocument();
      view.unmount();
    }
  });

  it("publica la procedencia de la cifra", () => {
    // Version de reglas y de motor. Sin eso, soporte no puede reconstruir de
    // donde salio un numero concreto.
    const { container } = renderIn(
      "en",
      <EntryQuotePanel quote={baseQuote} locale="en" timeZone="UTC" />,
    );

    expect(container.textContent).toContain(baseQuote.rules_version_id);
    expect(container.textContent).toContain(String(baseQuote.engine_version));
  });
});

describe("disponibilidad derivada del producto", () => {
  function variantWith(id: string, status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK") {
    const [first] = eligibleProduct.variants;
    if (first === undefined) throw new Error("el fixture necesita al menos una variante");

    return { ...first, id, availability: { status } };
  }

  it("sin variantes no hay estado que ensenar, y eso no es 'agotado'", () => {
    // `null` y no `OUT_OF_STOCK`: no hay nada que agotar. Colapsarlos diria que
    // el articulo se acabo cuando lo que pasa es que no tiene opciones.
    expect(productAvailabilityStatus([])).toBeNull();
  });

  it("se toma el MEJOR estado, no el peor", () => {
    // Un articulo con cuatro tallas de las que una se agoto sigue siendo un
    // articulo que se puede pedir. Marcarlo por su peor talla mandaria a otra
    // tienda a quien tiene la suya disponible.
    expect(
      productAvailabilityStatus([variantWith("a", "OUT_OF_STOCK"), variantWith("b", "IN_STOCK")]),
    ).toBe("IN_STOCK");

    expect(
      productAvailabilityStatus([variantWith("a", "OUT_OF_STOCK"), variantWith("b", "LOW_STOCK")]),
    ).toBe("LOW_STOCK");
  });

  it("solo con TODAS las variantes sin existencias el articulo esta agotado", () => {
    expect(
      productAvailabilityStatus([
        variantWith("a", "OUT_OF_STOCK"),
        variantWith("b", "OUT_OF_STOCK"),
      ]),
    ).toBe("OUT_OF_STOCK");

    expect(
      isProductSoldOut([variantWith("a", "OUT_OF_STOCK"), variantWith("b", "LOW_STOCK")]),
    ).toBe(false);
  });

  it("la tarjeta no marca agotado un articulo al que solo le falta una talla", () => {
    // El fixture elegible tiene una talla agotada entre cuatro. Antes de esto,
    // la tarjeta leia un campo agregado que la API no publica.
    const product = summaryOf(eligibleProduct);
    expect(product.variants.some((v) => v.availability.status === "OUT_OF_STOCK")).toBe(true);

    renderIn("en", <ProductCard product={product} locale="en" />);

    expect(screen.queryByText(enMessages.availability.OUT_OF_STOCK)).not.toBeInTheDocument();
  });
});

describe("fixtures del hito", () => {
  it("el catalogo cubre los casos dificiles del enunciado", () => {
    // Sin estos fixtures, los estados de arriba no se podrian probar y el
    // primero que los veria seria un participante.
    expect(catalog.some((product) => product.entry_eligibility?.is_eligible === true)).toBe(true);
    expect(catalog.some((product) => product.entry_eligibility?.is_eligible === false)).toBe(true);
    // El articulo agotado se reconoce por sus VARIANTES: la API no publica
    // ningun estado agregado del producto y el fixture ya no lo inventa.
    expect(catalog.some((product) => isProductSoldOut(product.variants))).toBe(true);
    expect(catalog.some((product) => !isProductSoldOut(product.variants))).toBe(true);
    expect(catalogWithoutPromotion.every((product) => product.entry_eligibility === null)).toBe(
      true,
    );
  });

  it("el carrito vacio existe como fixture, con la forma del contrato", () => {
    expect(emptyCartWithQuote.lines).toHaveLength(0);
    // `null`, no cero: sin lineas no hay moneda que declarar. La diferencia es
    // del contrato y es la que impide que la pantalla imprima "0,00 USD" en un
    // carrito donde no hay ningun importe.
    expect(emptyCartWithQuote.currency).toBeNull();
    expect(emptyCartWithQuote.subtotal).toBeNull();
    expect(emptyCartWithQuote.entry_quote?.eligible_subtotal).toBeNull();
  });

  it("hay un articulo con los tres estados de existencias a la vez", () => {
    // Es lo normal en una tienda con tallas, y es lo que impide que la
    // agregacion del producto se escriba como "la primera variante que haya".
    const states = eligibleProduct.variants.map((variant) => variant.availability.status);

    expect(new Set(states)).toEqual(new Set(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]));
    // Y aun asi el articulo se puede pedir: queda alguna talla.
    expect(isProductSoldOut(eligibleProduct.variants)).toBe(false);
    expect(isProductSoldOut(soldOutProduct.variants)).toBe(true);
  });

  it("ningun producto del mock publica `stock_quantity` ni `is_purchasable`", () => {
    // El catalogo es ANONIMO y publicaba el inventario exacto en crudo mientras
    // el carrito, que va con sesion, deliberadamente no lo hacia. Hoy no lo
    // publica ninguna de las dos superficies, y `is_purchasable` sigue pendiente
    // de decision (HO-017): un fixture que los trajera dejaria los tests en
    // verde mientras la pantalla consume campos que la respuesta no manda.
    for (const product of productDetails) {
      expect(product).not.toHaveProperty("stock_quantity");
      expect(product).not.toHaveProperty("availability");

      for (const variant of product.variants) {
        expect(variant).not.toHaveProperty("stock_quantity");
        expect(variant).not.toHaveProperty("quantity_available");
        expect(variant).not.toHaveProperty("is_purchasable");
        // Objeto, no cadena, y con un solo campo.
        expect(Object.keys(variant.availability)).toEqual(["status"]);
      }
    }
  });

  it("el resumen del catalogo trae las variantes, como la ficha", () => {
    // La API devuelve la MISMA forma en el listado y en la ficha. Sin variantes
    // en el resumen, la tarjeta no puede saber si queda algo que pedir.
    for (const product of catalog) {
      expect(product.variants.length).toBeGreaterThan(0);
    }
  });

  it("ninguna cifra de los fixtures se calcula: son datos fijos", () => {
    // Si estos fixtures calcularan la cotizacion, existiria en el repositorio
    // una segunda implementacion del motor viviendo en el frontend, y los tests
    // comprobarian que esa copia coincide consigo misma.
    expect(cappedQuote.final_entries).toBe(100);
    expect(cappedQuote.entries_before_caps).toBe(500);
  });
});
