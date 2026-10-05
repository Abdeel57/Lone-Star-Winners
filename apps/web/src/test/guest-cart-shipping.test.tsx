import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ toString: () => "", set: () => undefined }),
  headers: () => Promise.resolve(new Headers({ host: "localhost:3000" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`EXTERNAL_REDIRECT:${target}`);
  },
}));

vi.mock("@/i18n/navigation", () => ({
  redirect: ({ href, locale }: { href: string; locale: string }) => {
    throw new Error(`REDIRECT:/${locale}${href}`);
  },
}));

import { CartTotals } from "@/components/cart-totals";
import { IDLE } from "@/lib/action-result";
import { setShippingRateAction } from "@/lib/admin/shipping-actions";
import { API_PATHS, apiBaseUrl } from "@/lib/api";
import { addToCartAction } from "@/lib/cart-actions";
import { cartWithQuote, emptyCartWithQuote } from "@/mocks/fixtures/cart";
import { mockApiServer } from "@/mocks/node";

import esMessages from "../../messages/es-US.json";

/**
 * CARRITO SIN CUENTA Y ENVIO, DESDE LA INTERFAZ (DEC-079).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que el resumen ensena subtotal, envio y total TAL COMO LLEGAN, en los tres
 *    estados del envio, y que nunca suma por su cuenta.
 * 2. Que el envio de solo paquetes dice "No aplica", no "$0.00" (sonaria a
 *    envio gratis, y no lo es).
 * 3. Que la accion de anadir tiene la firma de `useActionState` -es lo que deja
 *    enviar el formulario antes de hidratar- y funciona sin sesion.
 * 4. Que el panel no deja poner el envio a cero y manda centavos a la API.
 */

const API = apiBaseUrl();

function renderTotals(cart: Parameters<typeof CartTotals>[0]["cart"]) {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages} timeZone="America/Chicago">
      <CartTotals cart={cart} locale="es" />
    </NextIntlClientProvider>,
  );
}

describe("resumen del carrito", () => {
  it("con envio cobrado: subtotal, envio y el total que publica el backend", () => {
    renderTotals(cartWithQuote);

    expect(screen.getByText("$68.00")).toBeInTheDocument();
    expect(screen.getByText("$7.99")).toBeInTheDocument();
    expect(screen.getByText("$75.99")).toBeInTheDocument();
    expect(screen.getByText("El envío no genera participaciones.")).toBeInTheDocument();
  });

  it("no suma: si el backend dice otro total, se ensena el del backend", () => {
    renderTotals({ ...cartWithQuote, total: { amount_minor: "1234", currency: "USD" } });
    expect(screen.getByText("$12.34")).toBeInTheDocument();
  });

  it("solo paquetes: el envio dice 'No aplica', no $0.00", () => {
    renderTotals({
      ...cartWithQuote,
      shipping: { status: "NOT_REQUIRED", amount: null },
      total: { amount_minor: "6800", currency: "USD" },
    });

    expect(screen.getByText("No aplica")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("sin tarifa puesta: 'Por confirmar' y sin total", () => {
    renderTotals({
      ...cartWithQuote,
      shipping: { status: "NOT_CONFIGURED", amount: null },
      total: null,
    });

    expect(screen.getByText("Por confirmar")).toBeInTheDocument();
    expect(screen.queryByText("$75.99")).toBeNull();
  });
});

describe("anadir al carrito", () => {
  it("tiene la firma de useActionState (estado previo, formData) y funciona sin sesion", async () => {
    mockApiServer.use(
      http.post(`${API}${API_PATHS.cartItems}`, ({ request }) =>
        // Sin cookie: es un visitante sin cuenta, y la API lo acepta (DEC-079).
        request.headers.get("cookie") === null
          ? HttpResponse.json(cartWithQuote)
          : HttpResponse.json(emptyCartWithQuote),
      ),
    );

    const form = new FormData();
    form.set("locale", "es");
    form.set("variant_id", cartWithQuote.lines[0]?.variant_id ?? "");
    form.set("quantity", "1");

    const result = await addToCartAction({ ok: false, code: null, requestId: null }, form);
    expect(result).toEqual({ ok: true, code: null, requestId: null });
  });
});

describe("tarifa de envio en el panel", () => {
  function shippingForm(amount: string): FormData {
    const form = new FormData();
    form.set("locale", "es");
    form.set("currency", "USD");
    form.set("amount", amount);
    return form;
  }

  it("cero no se acepta, y se dice junto al campo", async () => {
    const result = await setShippingRateAction(IDLE, shippingForm("0.00"));
    expect(result).toMatchObject({ status: "error", code: "SHIPPING_RATE_ZERO", field: "amount" });
  });

  it("un importe mal escrito es PRICE_INVALID", async () => {
    const result = await setShippingRateAction(IDLE, shippingForm("7,99"));
    expect(result).toMatchObject({ status: "error", code: "PRICE_INVALID", field: "amount" });
  });

  it("manda centavos enteros a la API", async () => {
    let sent: unknown = null;
    mockApiServer.use(
      http.put(`${API}${API_PATHS.adminShippingRate}`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ current: null, history: [] });
      }),
    );

    const result = await setShippingRateAction(IDLE, shippingForm("7.99"));

    expect(result.status).toBe("ok");
    expect(sent).toEqual({ amount_minor: 799, currency: "USD" });
  });
});
