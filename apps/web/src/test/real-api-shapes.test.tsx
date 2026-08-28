/**
 * El escaparate contra la forma REAL de la API, no contra las fixtures.
 *
 * POR QUE EXISTE
 *   El primer e2e contra `apps/api` de verdad (2026-08-27) tumbo `/es`,
 *   `/es/shop`, `/es/products/[slug]` y `/es/promotions/[slug]` con
 *   `TypeError: Cannot read properties of undefined (reading 'declared_value'
 *   | 'amount_minor' | 'name')`. Las fixtures del mock llevaban `prize`,
 *   `media`, `entry_pool`, `price_from`, `summary`, `category_key`,
 *   `image_url`, `entry_eligibility` y `variant.name`; la API no publica
 *   NINGUNO de ellos (HO-019, HO-039). Todos los tests pasaban porque todos
 *   leian fixtures.
 *
 *   Aqui se construyen objetos con EXACTAMENTE las claves que la API publica
 *   (`apps/api/openapi/openapi.json`) y se pintan los componentes que antes
 *   morian. Si alguien vuelve a leer una clave provisional sin tolerar su
 *   ausencia, esto lo detecta antes que el e2e.
 */

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    usePathname: () => "/",
    redirect: () => undefined,
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});

vi.mock("@/lib/cart-actions", () => ({
  addToCartAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
  updateCartItemAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
  removeCartItemAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
  updateCartItemFormAction: () => Promise.resolve(undefined),
  removeCartItemFormAction: () => Promise.resolve(undefined),
}));

import { PrizeBand } from "@/components/prize-band";
import { ProductCard } from "@/components/product-card";
import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { ProductSummary, PromotionDetail } from "@/lib/api/contract";
import { priceFrom } from "@/lib/product-price";
import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

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

/** `GET /products` y `GET /products/{slug}`: ni una clave mas de las publicadas. */
const realProduct: ProductSummary = {
  id: "9c1f0e2a-1b2c-4d3e-8f90-123456789abc",
  slug: "camiseta-real",
  name: { "en-US": "Real API Tee", "es-US": "Camiseta API real" },
  sku: "LSW-TEE",
  currency: "USD",
  variants: [
    {
      id: "v-m",
      sku: "LSW-TEE-M",
      price: { amount_minor: "2500", currency: "USD" },
      availability: { status: "IN_STOCK" },
    },
    {
      id: "v-xl",
      sku: "LSW-TEE-XL",
      price: { amount_minor: "1999", currency: "USD" },
      availability: { status: "LOW_STOCK" },
    },
  ],
};

/** `GET /promotions/{slug}`: sin `prize`, `media`, `entry_pool` ni `entry_offer`. */
const realPromotion: PromotionDetail = {
  id: "5d2e7b1c-9f8a-4c6d-b0e1-abcdef012345",
  slug: "promocion-real",
  status: "ACTIVE",
  title: { "en-US": "Real API Promotion", "es-US": "Promocion API real" },
  summary: { "en-US": "Summary", "es-US": "Resumen" },
  legal_timezone: "America/Chicago",
  starts_at: "2026-03-01T05:00:00.000Z",
  ends_at: "2026-12-01T05:00:00.000Z",
  rules_version_id: "r-1",
  prize_value: { amount_minor: "6500000", currency: "USD" },
};

describe("escaparate contra la forma real de la API", () => {
  it("la tarjeta de producto se pinta sin summary, categoria, imagen, price_from ni elegibilidad", () => {
    const { container } = renderIn("es", <ProductCard product={realProduct} locale="es" />);
    expect(screen.getByText("Camiseta API real")).toBeInTheDocument();
    // Precio derivado de la variante mas barata, no inventado ni ausente.
    expect(container.textContent).toContain("$19.99");
    expect(container.textContent).not.toMatch(/undefined|NaN/u);
  });

  it("priceFrom deriva el minimo de las variantes y respeta price_from cuando llega", () => {
    expect(priceFrom(realProduct)).toEqual({ amount_minor: "1999", currency: "USD" });
    expect(
      priceFrom({ ...realProduct, price_from: { amount_minor: "100", currency: "USD" } }),
    ).toEqual({ amount_minor: "100", currency: "USD" });
    expect(priceFrom({ ...realProduct, variants: [] })).toBeNull();
    // Monedas mezcladas no se comparan.
    expect(
      priceFrom({
        ...realProduct,
        variants: [
          { ...realProduct.variants[0]!, price: { amount_minor: "1", currency: "USD" } },
          { ...realProduct.variants[1]!, price: { amount_minor: "1", currency: "MXN" } },
        ],
      }),
    ).toBeNull();
  });

  it("formatMoney tolera la ausencia del importe", () => {
    expect(formatMoney(undefined, "es")).toBeNull();
    expect(formatMoney(null, "en")).toBeNull();
  });

  it("la banda del premio no se pinta cuando la API no publica el premio, y no revienta", () => {
    const { container } = renderIn("en", <PrizeBand promotion={realPromotion} locale="en" />);
    expect(container.textContent).not.toMatch(/undefined|NaN/u);
    expect(container.querySelector(".lsw-prize-band")).toBeNull();
  });
});
