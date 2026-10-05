import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz",
      set: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers({ host: "localhost:3000" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/*
 * `redirect` de Next LANZA, y es lo que corta la accion. El doble lo imita:
 * sin lanzar, la accion seguiria hacia la pasarela de tarjeta y la prueba
 * estaria comprobando un recorrido que en produccion no existe.
 */
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`EXTERNAL_REDIRECT:${target}`);
  },
}));

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/checkout",
    redirect: ({ href, locale }: { href: string; locale: string }) => {
      throw new Error(`REDIRECT:/${locale}${href}`);
    },
    getPathname: ({ href }: { href: string }) => href,
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("../../messages/en-US.json")).default;
  const es = (await import("../../messages/es-US.json")).default;

  return {
    setRequestLocale: () => undefined,
    getTranslations: (options: { locale: "en" | "es"; namespace: "admin.cashPayment" }) =>
      Promise.resolve(
        createTranslator({
          locale: options.locale,
          messages: options.locale === "en" ? en : es,
          namespace: options.namespace,
        }),
      ),
  };
});

import { CashPaymentPanel } from "@/components/admin/cash-payment-panel";
import { CheckoutForm } from "@/components/checkout-form";
import { LOCALES, type Locale } from "@/i18n/locales";
import { confirmCashPaymentAction } from "@/lib/admin/actions";
import { IDLE } from "@/lib/action-result";
import { adminOrderCashPaymentPath, API_PATHS, apiBaseUrl } from "@/lib/api";
import { startCheckoutAction } from "@/lib/checkout-actions";
import { cashPendingOrder } from "@/mocks/fixtures/account";
import { confirmedCashPayment, pendingCashPayment } from "@/mocks/fixtures/admin";
import { hostedRedirectSession } from "@/mocks/fixtures/checkout";
import { mockApiServer } from "@/mocks/node";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * PAGO EN EFECTIVO EN UN PUNTO DE VENTA FISICO (DEC-078), DESDE LA INTERFAZ.
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que el checkout ofrezca las DOS formas de pagar, visibles a la vez y en
 *    los dos idiomas, y que el boton diga lo que va a pasar.
 * 2. Que elegir efectivo cree el pedido por SU ruta -sin pasar por la pasarela-
 *    y lleve a la confirmacion del pedido, en el idioma de quien compra.
 * 3. Que el panel ofrezca "Confirmar pago en efectivo" solo cuando el backend
 *    dice que se puede y el actor tiene la capacidad, y que la accion mande el
 *    motivo que la capacidad exige.
 *
 * Ninguna de estas pruebas decide nada de negocio: lo que se cobra, lo que se
 * confirma y cuantas participaciones hay lo decide el backend.
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

const API = apiBaseUrl().replace(/\/+$/, "");

function checkoutForm(paymentMethod: string): FormData {
  const formData = new FormData();
  formData.set("locale", "es");
  formData.set("payment_method", paymentMethod);
  formData.set("full_name", "Cash Buyer");
  formData.set("line1", "1 Fixture St");
  formData.set("city", "Austin");
  formData.set("region", "TX");
  formData.set("postal_code", "73301");
  formData.set("country", "US");
  return formData;
}

/** Captura lo que llega a las dos rutas de checkout. */
function captureCheckout(): { readonly cash: unknown[]; readonly card: unknown[] } {
  const captured = { cash: [] as unknown[], card: [] as unknown[] };

  mockApiServer.use(
    http.post(`${API}${API_PATHS.checkoutCashOrder}`, async ({ request }) => {
      captured.cash.push(await request.json());
      return HttpResponse.json(cashPendingOrder, { status: 201 });
    }),
    http.post(`${API}${API_PATHS.checkoutSession}`, async ({ request }) => {
      captured.card.push(await request.json());
      return HttpResponse.json(hostedRedirectSession, { status: 201 });
    }),
  );

  return captured;
}

describe("checkout: dos formas de pagar", () => {
  it.each(LOCALES)(
    "ofrece tarjeta y efectivo a la vez en %s, con tarjeta por defecto",
    (locale) => {
      const { container } = renderIn(locale, <CheckoutForm locale={locale} />);
      const messages = locale === "en" ? enMessages : esMessages;

      const radios = container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="payment_method"]',
      );
      expect([...radios].map((radio) => radio.value)).toEqual(["CARD", "CASH"]);
      expect([...radios].find((radio) => radio.checked)?.value).toBe("CARD");

      expect(screen.getByText(messages.checkout.payment.heading)).toBeInTheDocument();
      expect(screen.getByText(messages.checkout.payment.card.title)).toBeInTheDocument();
      expect(screen.getByText(messages.checkout.payment.cash.title)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: messages.checkout.payCta })).toBeInTheDocument();
    },
  );

  it("con efectivo, el boton y la nota dicen que no se cobra nada ahora", () => {
    const { container } = renderIn("es", <CheckoutForm locale="es" />);

    const cash = container.querySelector<HTMLInputElement>('input[value="CASH"]');
    expect(cash).not.toBeNull();
    if (cash !== null) fireEvent.click(cash);

    expect(
      screen.getByRole("button", { name: esMessages.checkout.payment.cashCta }),
    ).toBeInTheDocument();
    expect(screen.getByText(esMessages.checkout.payment.cashNote)).toBeInTheDocument();
    // La nota de la pasarela ya no aplica: no hay proveedor de pago en caja.
    expect(screen.queryByText(esMessages.checkout.providerNote)).not.toBeInTheDocument();
  });
});

describe("checkout: la accion con efectivo", () => {
  it("crea el pedido por su ruta, sin pasarela, y lleva a la confirmacion en el idioma", async () => {
    const captured = captureCheckout();

    await expect(startCheckoutAction(IDLE, checkoutForm("CASH"))).rejects.toThrow(
      `REDIRECT:/es/orders/${cashPendingOrder.id}/confirmation`,
    );

    expect(captured.card).toHaveLength(0);
    expect(captured.cash).toHaveLength(1);
    // Solo la direccion: lo que se cobra sale del carrito de servidor.
    expect(captured.cash[0]).toEqual({
      shipping_address: {
        full_name: "Cash Buyer",
        line1: "1 Fixture St",
        line2: null,
        city: "Austin",
        region: "TX",
        postal_code: "73301",
        country: "US",
      },
    });
  });

  it("un valor manipulado no abre una tercera via: cae en la tarjeta", async () => {
    const captured = captureCheckout();

    await expect(startCheckoutAction(IDLE, checkoutForm("BARTER"))).rejects.toThrow(
      /EXTERNAL_REDIRECT/u,
    );

    expect(captured.cash).toHaveLength(0);
    expect(captured.card).toHaveLength(1);
  });

  it("un fallo del backend se devuelve como codigo, sin redirigir", async () => {
    mockApiServer.use(
      http.post(`${API}${API_PATHS.checkoutCashOrder}`, () =>
        HttpResponse.json({ error: { code: "CART_EMPTY", request_id: "req-1" } }, { status: 409 }),
      ),
    );

    const result = await startCheckoutAction(IDLE, checkoutForm("CASH"));
    expect(result.status).toBe("error");
    expect(result.code).toBe("CART_EMPTY");
  });
});

describe("panel: confirmar el pago en efectivo", () => {
  it("con el pedido pendiente y la capacidad, ofrece confirmar y dice el recorrido", async () => {
    const ui = await CashPaymentPanel({
      cash: pendingCashPayment,
      locale: "es",
      actorCanConfirm: true,
    });
    renderIn("es", ui);

    const copy = esMessages.admin.cashPayment;
    for (const stage of ["PENDING_CASH_PAYMENT", "PAID", "ENTRIES_GENERATED"] as const) {
      expect(screen.getAllByText(copy.stages[stage]).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: copy.confirmSubmit })).toBeInTheDocument();
    expect(screen.getByText(copy.entriesBody.AWAITING_PAYMENT)).toBeInTheDocument();
  });

  it("sin order.cash.confirm no hay boton: se dice que falta la capacidad", async () => {
    const ui = await CashPaymentPanel({
      cash: pendingCashPayment,
      locale: "es",
      actorCanConfirm: false,
    });
    renderIn("es", ui);

    const copy = esMessages.admin.cashPayment;
    expect(screen.queryByRole("button", { name: copy.confirmSubmit })).not.toBeInTheDocument();
    expect(screen.getByText(copy.noCapability)).toBeInTheDocument();
  });

  it("ya confirmado: quien lo cobro, sin boton de confirmar, y las participaciones del ledger", async () => {
    const ui = await CashPaymentPanel({
      cash: confirmedCashPayment,
      locale: "es",
      actorCanConfirm: true,
    });
    renderIn("es", ui);

    const copy = esMessages.admin.cashPayment;
    expect(screen.getByText("Promotions team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.confirmSubmit })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.retrySubmit })).not.toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("cobrado con las participaciones pendientes: ofrece reintentar, no confirmar", async () => {
    const ui = await CashPaymentPanel({
      cash: {
        ...confirmedCashPayment,
        stage: "PAID",
        entries: { ...confirmedCashPayment.entries, status: "PENDING", entries_granted: null },
        can_generate_entries: true,
      },
      locale: "es",
      actorCanConfirm: true,
    });
    renderIn("es", ui);

    const copy = esMessages.admin.cashPayment;
    expect(screen.getByRole("button", { name: copy.retrySubmit })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.confirmSubmit })).not.toBeInTheDocument();
  });
});

describe("panel: la accion de confirmar", () => {
  function confirmForm(entries: Readonly<Record<string, string>>): FormData {
    const formData = new FormData();
    formData.set("locale", "es");
    formData.set("order_id", cashPendingOrder.id);
    for (const [name, value] of Object.entries(entries)) formData.set(name, value);
    return formData;
  }

  it("manda el motivo -que la capacidad exige- y la nota", async () => {
    const bodies: unknown[] = [];
    mockApiServer.use(
      http.post(
        `${API}${adminOrderCashPaymentPath(cashPendingOrder.id)}/confirm`,
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(confirmedCashPayment);
        },
      ),
    );

    const result = await confirmCashPaymentAction(
      IDLE,
      confirmForm({ reason_key: "CASH_RECEIVED_AT_STORE", reason_note: "Recibo 0001" }),
    );

    expect(result.status).toBe("ok");
    expect(bodies).toEqual([{ reason_code: "CASH_RECEIVED_AT_STORE", notes: "Recibo 0001" }]);
  });

  it("sin motivo no llama al backend", async () => {
    const result = await confirmCashPaymentAction(IDLE, confirmForm({}));
    expect(result.code).toBe("FIELD_REQUIRED");
    expect(result.field).toBe("reason_key");
  });

  it("cobro confirmado y participaciones fallidas: lo dice con su propio codigo", async () => {
    mockApiServer.use(
      http.post(`${API}${adminOrderCashPaymentPath(cashPendingOrder.id)}/confirm`, () =>
        HttpResponse.json({
          ...confirmedCashPayment,
          stage: "PAID",
          entries_error_code: "ENTRIES_GENERATION_FAILED",
        }),
      ),
    );

    const result = await confirmCashPaymentAction(
      IDLE,
      confirmForm({ reason_key: "CASH_RECEIVED_AT_STORE" }),
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("CASH_ENTRIES_GENERATION_FAILED");
  });
});
