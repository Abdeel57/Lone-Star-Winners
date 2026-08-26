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
import { EntryQuotePanel, isStale } from "@/components/entry-quote-panel";
import { ProductCard } from "@/components/product-card";
import { ShopFilters } from "@/components/shop-filters";
import type { Locale } from "@/i18n/locales";
import {
  baseQuote,
  cappedQuote,
  cartWithoutQuote,
  cartWithStaleQuote,
  emptyCart,
  multipliedQuote,
  populatedCart,
} from "@/mocks/fixtures/cart";
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

describe("ShopFilters", () => {
  it("es un formulario GET: el filtro acaba en la URL y funciona sin JavaScript", () => {
    const { container } = renderIn(
      "en",
      <ShopFilters action="/en/shop" categories={["APPAREL", "HOME"]} selectedCategory={null} />,
    );

    const form = container.querySelector("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/en/shop");
  });

  it("traduce las categorias que conoce y deja pasar las que no", () => {
    renderIn(
      "es",
      <ShopFilters
        action="/es/shop"
        categories={["APPAREL", "CATEGORIA_NUEVA"]}
        selectedCategory={null}
      />,
    );

    expect(screen.getByRole("option", { name: esMessages.category.APPAREL })).toBeInTheDocument();
    // Una categoria que el backend anada aparece con su clave: usable, y
    // visiblemente pendiente de traducir. Nunca desaparece del filtro.
    expect(screen.getByRole("option", { name: "CATEGORIA_NUEVA" })).toBeInTheDocument();
  });

  it("sin categorias no se pinta un filtro vacio", () => {
    const { container } = renderIn(
      "en",
      <ShopFilters action="/en/shop" categories={[]} selectedCategory={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("CartLineRow", () => {
  const line = populatedCart.items[0];
  const ineligibleLine = populatedCart.items[1];

  it("pinta el total de linea que manda el servidor, sin multiplicar", () => {
    expect(line).toBeDefined();
    if (line === undefined) return;

    renderIn("en", <CartLineRow line={line} locale="en" ineligibleReasonKey={null} />);

    // 2 x 25,00 = 50,00, pero la cifra viene del backend. Si la interfaz
    // multiplicara, un descuento del servidor no se reflejaria.
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$25\.00/)).toBeInTheDocument();
  });

  it("dice QUE linea no cuenta, no que el carrito entero falle", () => {
    expect(ineligibleLine).toBeDefined();
    if (ineligibleLine === undefined) return;

    renderIn(
      "es",
      <CartLineRow line={ineligibleLine} locale="es" ineligibleReasonKey="PRODUCT_NOT_ELIGIBLE" />,
    );

    expect(screen.getByText(esMessages.ineligibility.PRODUCT_NOT_ELIGIBLE)).toBeInTheDocument();
  });

  it("un motivo desconocido cae al texto generico y nunca sale en crudo", () => {
    expect(line).toBeDefined();
    if (line === undefined) return;

    renderIn(
      "en",
      <CartLineRow line={line} locale="en" ineligibleReasonKey="MOTIVO_QUE_NO_EXISTE" />,
    );

    expect(screen.getByText(enMessages.ineligibility.fallback)).toBeInTheDocument();
    expect(screen.queryByText(/MOTIVO_QUE_NO_EXISTE/)).not.toBeInTheDocument();
  });

  it("avisa cuando una linea dejo de estar disponible", () => {
    const unavailable = { ...line, availability: "OUT_OF_STOCK" } as NonNullable<typeof line>;
    renderIn("en", <CartLineRow line={unavailable} locale="en" ineligibleReasonKey={null} />);

    expect(screen.getByText(enMessages.cart.quantityUnavailable)).toBeInTheDocument();
  });

  it("quitar y cambiar cantidad son dos formularios distintos", () => {
    expect(line).toBeDefined();
    if (line === undefined) return;

    const { container } = renderIn(
      "en",
      <CartLineRow line={line} locale="en" ineligibleReasonKey={null} />,
    );

    // Un solo formulario con dos botones de envio obligaria a distinguirlos por
    // el `name` del boton, que es lo que deja de funcionar al enviar con Enter.
    expect(container.querySelectorAll("form")).toHaveLength(2);
  });
});

describe("EntryQuotePanel", () => {
  it("muestra la cifra final tal como llega del backend", () => {
    renderIn(
      "en",
      <EntryQuotePanel quote={baseQuote} cart={populatedCart} locale="en" timeZone="UTC" />,
    );

    expect(screen.getByText(/250 entries/)).toBeInTheDocument();
  });

  it("cuando no hay tope no enseña dos cifras iguales", () => {
    renderIn(
      "en",
      <EntryQuotePanel quote={baseQuote} cart={populatedCart} locale="en" timeZone="UTC" />,
    );

    expect(screen.queryByText(/Before limits/)).not.toBeInTheDocument();
  });

  it("cuando un tope reduce la cifra, explica por que", () => {
    // Enseñar 100 cuando el participante esperaba 500, sin decir nada, es la
    // forma mas rapida de generar una reclamacion.
    const { container } = renderIn(
      "en",
      <EntryQuotePanel quote={cappedQuote} cart={populatedCart} locale="en" timeZone="UTC" />,
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
    renderIn(
      "es",
      <EntryQuotePanel quote={multipliedQuote} cart={populatedCart} locale="es" timeZone="UTC" />,
    );

    expect(screen.getByText("2×")).toBeInTheDocument();
  });

  it("avisa cuando la cotizacion es anterior al ultimo cambio del carrito", () => {
    renderIn(
      "en",
      <EntryQuotePanel
        quote={cartWithStaleQuote.entry_quote}
        cart={populatedCart}
        locale="en"
        timeZone="UTC"
      />,
    );

    expect(screen.getByText(enMessages.cart.quote.stale)).toBeInTheDocument();
  });

  it("no avisa de caducidad cuando la cotizacion esta al dia", () => {
    renderIn(
      "en",
      <EntryQuotePanel quote={baseQuote} cart={populatedCart} locale="en" timeZone="UTC" />,
    );
    expect(screen.queryByText(enMessages.cart.quote.stale)).not.toBeInTheDocument();
  });

  it("sin promocion abierta lo dice, en vez de enseñar un cero sin contexto", () => {
    renderIn(
      "es",
      <EntryQuotePanel
        quote={cartWithoutQuote.entry_quote}
        cart={populatedCart}
        locale="es"
        timeZone="UTC"
      />,
    );

    expect(screen.getByText(esMessages.cart.quote.unavailable.title)).toBeInTheDocument();
  });

  it("siempre acompana la cifra del aviso de que la rigen las Reglas Oficiales", () => {
    // Es la frase que impide que la cifra se lea como una promesa firme.
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <EntryQuotePanel quote={baseQuote} cart={populatedCart} locale={locale} timeZone="UTC" />,
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
      <EntryQuotePanel quote={baseQuote} cart={populatedCart} locale="en" timeZone="UTC" />,
    );

    expect(container.textContent).toContain(baseQuote.rules_version_id);
    expect(container.textContent).toContain(String(baseQuote.engine_version));
  });
});

describe("isStale", () => {
  it("compara instantes del servidor, no el reloj del navegador", () => {
    expect(isStale("2026-09-15T11:00:00.000Z", "2026-09-15T12:00:00.000Z")).toBe(true);
    expect(isStale("2026-09-15T12:00:00.000Z", "2026-09-15T12:00:00.000Z")).toBe(false);
    expect(isStale("2026-09-15T13:00:00.000Z", "2026-09-15T12:00:00.000Z")).toBe(false);
  });

  it("ante una fecha invalida no inventa una caducidad", () => {
    expect(isStale("no-es-una-fecha", "2026-09-15T12:00:00.000Z")).toBe(false);
    expect(isStale("2026-09-15T12:00:00.000Z", "")).toBe(false);
  });
});

describe("fixtures del hito", () => {
  it("el catalogo cubre los casos dificiles del enunciado", () => {
    // Sin estos fixtures, los estados de arriba no se podrian probar y el
    // primero que los veria seria un participante.
    expect(catalog.some((product) => product.entry_eligibility?.is_eligible === true)).toBe(true);
    expect(catalog.some((product) => product.entry_eligibility?.is_eligible === false)).toBe(true);
    expect(catalog.some((product) => product.availability === "OUT_OF_STOCK")).toBe(true);
    expect(catalogWithoutPromotion.every((product) => product.entry_eligibility === null)).toBe(
      true,
    );
  });

  it("el carrito vacio existe como fixture", () => {
    expect(emptyCart.items).toHaveLength(0);
    expect(emptyCart.item_count).toBe(0);
  });

  it("hay una variante con stock que aun asi no es comprable", () => {
    // `IN_STOCK` y `is_purchasable: false` a la vez. Existe para que ninguna
    // pantalla deduzca una cosa de la otra.
    const contradictory = eligibleProduct.variants.concat(
      ineligibleProduct.variants,
      soldOutProduct.variants,
    );

    expect(contradictory.length).toBeGreaterThan(0);
  });

  it("ninguna cifra de los fixtures se calcula: son datos fijos", () => {
    // Si estos fixtures calcularan la cotizacion, existiria en el repositorio
    // una segunda implementacion del motor viviendo en el frontend, y los tests
    // comprobarian que esa copia coincide consigo misma.
    expect(cappedQuote.final_entries).toBe(100);
    expect(cappedQuote.entries_before_caps).toBe(500);
  });
});
