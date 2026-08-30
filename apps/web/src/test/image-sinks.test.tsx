import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// `Link` de next-intl necesita el router del App Router, que no existe en
// jsdom. El doble reproduce su contrato documentado.
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

import { OrderLineList } from "@/components/order-line-list";
import { PromotionHero } from "@/components/promotion-hero";
import type { Locale } from "@/i18n/locales";
import type { OrderLine } from "@/lib/api";
import { prizeTruckWideImage } from "@/mocks/fixtures/media";
import { activePromotion, activePromotionDetail } from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";

/**
 * SUMIDEROS DE IMAGEN (HO-041, hallazgo S-11).
 *
 * QUE PROTEGE ESTE FICHERO, Y POR QUE NO BASTA CON PROBAR EL VALIDADOR
 * -------------------------------------------------------------------
 * `isSafeImageUrl` ya tiene sus propias pruebas en `entry-offer.test.ts`, y
 * pasaban en verde mientras DOS componentes construian su `src` sin llamarlo:
 * `order-line-list` y `promotion-hero`. Es exactamente el fallo que un test del
 * validador no puede ver, porque el validador nunca fue el problema.
 *
 * Asi que lo que se prueba aqui es el SUMIDERO: se renderiza el componente con
 * una URL hostil en el campo del contrato y se comprueba que no acaba en ningun
 * atributo `src` de la pagina. Un componente que dejara de filtrar volveria a
 * pintarla, sin que nada mas fallara.
 *
 * DE DONDE SALEN ESTAS URLS
 * -------------------------
 * `product.image_url`, `order_line.image_url` y `promotion.media.hero_url` los
 * escribe quien administra el catalogo y las promociones en el panel. No es
 * entrada de un visitante, y por eso esto es MEDIA y no critica; pero es un
 * campo de texto que acaba en un atributo `src`, y las dos consecuencias son
 * reales: `http:` degrada la pagina a contenido mixto y manda el `Referer` de
 * todos los visitantes a un tercero, y `data:` incrusta un documento ajeno
 * dentro de la pagina. La API tambien los valida al escribir; la duplicidad es
 * deliberada y esta razonada en `@/lib/media-url`.
 *
 * `javascript:` en un `src` de imagen NO ejecuta nada en ningun navegador
 * actual. Se comprueba igual porque es el esquema que delata un filtro
 * ausente: si aparece pintado, el filtro no esta, y el siguiente sumidero
 * -uno que si ejecute- lo heredara.
 */

/**
 * Las URLs que ningun sumidero puede pintar.
 *
 * Las dos primeras son las que pide HO-041 explicitamente. Las dos ultimas
 * cubren los dos disfraces que ya vigila el validador y que aqui hay que
 * comprobar de nuevo, porque lo que se mide es otra cosa: que el componente lo
 * llame. `prizeTruckWideImage` es el `data:` URI REAL que hasta S-11 servia el
 * fixture como respaldo del hero -no un literal inventado-, que es lo que hace
 * que este caso describa el fallo que existio.
 */
const REJECTED_URLS: readonly (readonly [string, string])[] = [
  ["http:", "http://cdn.evil.example/gmc.jpg"],
  ["javascript:", "javascript:alert(1)"],
  ["data:", prizeTruckWideImage],
  ["esquema relativo", "//cdn.evil.example/gmc.jpg"],
];

/** Ruta del propio sitio: el caso que SI se pinta. */
const ACCEPTED_URL = "/products/tee-red.jpg";

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * Todos los `src` de la pagina, decodificados.
 *
 * Se decodifican porque `next/image` no pinta la ruta original sino la del
 * optimizador (`/_next/image?url=...`), que la lleva codificada dentro. Sin
 * decodificar, una URL prohibida que llegara envuelta pasaria desapercibida.
 */
function renderedSources(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("img")].map((image) =>
    decodeURIComponent(image.getAttribute("src") ?? ""),
  );
}

/**
 * La URL no esta en el marcado NI EN CRUDO NI CODIFICADA.
 *
 * Las dos formas, porque los dos sumideros escriben distinto: `order-line-list`
 * usa un `<img>` y pintaria la cadena tal cual, mientras que `promotion-hero`
 * usa `next/image` y la meteria percent-codificada dentro de la URL del
 * optimizador. Comprobar solo una de las dos dejaria medio hallazgo sin red.
 *
 * Se compara sobre el HTML SIN decodificar: el marcado del hero lleva
 * porcentajes sueltos en las clases de utilidad (`object-[38%_35%]`) y
 * `decodeURIComponent` sobre la cadena entera lanzaria `URIError`.
 */
function expectAbsentFrom(container: HTMLElement, url: string): void {
  expect(container.innerHTML).not.toContain(url);
  expect(container.innerHTML).not.toContain(encodeURIComponent(url));
}

function orderLine(imageUrl: string): OrderLine {
  return {
    line_id: "oli_0000000000000099",
    sku: "TEE-S",
    product_slug: "camiseta-lone-star",
    product_name: { "en-US": "Lone Star tee", "es-US": "Camiseta Lone Star" },
    variant_name: { "en-US": "Small", "es-US": "Pequeña" },
    image_url: imageUrl,
    quantity: 1,
    unit_price: { amount_minor: "2500", currency: "USD" },
    line_total: { amount_minor: "2500", currency: "USD" },
  };
}

describe("lineas de pedido: `order_line.image_url`", () => {
  it("pinta una ruta del propio sitio", () => {
    const { container } = renderIn(
      "en",
      <OrderLineList lines={[orderLine(ACCEPTED_URL)]} locale="en" />,
    );

    // La mitad positiva del par. Sin ella, un componente que dejara de pintar
    // cualquier imagen pasaria todos los casos hostiles de abajo.
    expect(renderedSources(container)).toContain(ACCEPTED_URL);
  });

  it.each(REJECTED_URLS)("descarta %s", (_name, url) => {
    const { container } = renderIn("en", <OrderLineList lines={[orderLine(url)]} locale="en" />);

    // Ni pintada ni envuelta: la linea se queda sin miniatura, que es lo que ya
    // hace un pedido cuyo producto nunca tuvo foto.
    expect(renderedSources(container)).toEqual([]);
    expectAbsentFrom(container, url);
  });
});

describe("hero de la promocion: `media.hero_url`", () => {
  /**
   * Instante de referencia fijo: la cuenta atras necesita el del render de
   * servidor y un test no puede depender de cuando se ejecute.
   */
  const NOW = "2026-08-25T12:00:00.000Z";

  function renderHero(heroUrl: string) {
    const media = activePromotionDetail.media;
    expect(media, "la promocion protagonista declara imagenes").toBeDefined();

    return renderIn(
      "en",
      <PromotionHero
        promotion={activePromotion}
        detail={{
          ...activePromotionDetail,
          media: { alt: null, square_url: null, ...media, hero_url: heroUrl },
        }}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
        multipliersEnabled={false}
      />,
    );
  }

  it("pinta una ruta del propio sitio", () => {
    const { container } = renderHero(ACCEPTED_URL);

    // `toContain` sobre la cadena y no igualdad: `next/image` envuelve la ruta
    // dentro de la URL del optimizador, y comparar la cadena entera ataria el
    // test a como Next la construye.
    expect(renderedSources(container).join(" ")).toContain(ACCEPTED_URL);
  });

  it.each(REJECTED_URLS)("descarta %s", (_name, url) => {
    const { container } = renderHero(url);

    // Sin imagen que pintar, el hero cae en la marca de agua, que es un fondo
    // de un `div` decorativo: no hay ningun `img` en la seccion.
    expect(renderedSources(container)).toEqual([]);
    expectAbsentFrom(container, url);
  });
});
