import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/orders/x/confirmation",
    useRouter: () => ({ refresh }),
    redirect: () => undefined,
    getPathname: ({ href }: { href: string }) => href,
    Link: ({
      href,
      locale,
      children,
      scroll: _scroll,
      ...rest
    }: {
      href: string;
      locale?: string;
      scroll?: boolean;
      children: ReactNode;
    }) =>
      createElement(
        "a",
        { href: locale === undefined ? href : `/${locale}${href}`, ...rest },
        children,
      ),
  };
});

import { PaymentReceipt } from "@/components/payment-receipt";
import type { Locale } from "@/i18n/locales";
import type { OrderReceipt } from "@/lib/api";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * DEC-103: la pantalla del comprobante.
 *
 * Lo que se vigila es que NO prometa mas de lo que dice el backend:
 *
 *   1. "Payment Successful!" solo con `payment_status: PAID`. Un pedido
 *      devuelto dice lo que le paso, y sus numeros anulados se ven anulados.
 *   2. Con participaciones pendientes no se pinta ninguna cifra, y la pagina
 *      vuelve a preguntar al backend sola (de forma limitada).
 *   3. Los numeros llegan por tramos: se pinta el tramo, no miles a la vez.
 *   4. Los botones van a donde deben: el PDF bajo el origen del sitio, el
 *      verificador existente y el inicio.
 */

const ORDER_ID = "2420074f-563e-4595-9fc8-e58db006f8b0";
const PATH = `/orders/${ORDER_ID}/confirmation`;

function numbers(count: number, active: boolean, start = 0) {
  return Array.from({ length: count }, (_, index) => ({
    number: String(31_000_000 + start + index).padStart(8, "0"),
    active,
  }));
}

function paidReceipt(overrides: Partial<OrderReceipt> = {}): OrderReceipt {
  return {
    order: {
      id: ORDER_ID,
      order_number: "LSW-00001234",
      status: "PAID",
      placed_at: "2026-11-10T19:58:00.000Z",
      total: { amount_minor: "5799", currency: "USD" },
      item_count: 2,
      promotion_id: "47cf9bd5-e22a-482e-93f6-bdf926751884",
      entry_state: "GRANTED",
      entries_granted: 50,
      payment_method: "CARD",
      items: [
        {
          line_id: "11111111-1111-4111-8111-111111111111",
          sku: "PKG-50",
          product_slug: "paquete-50",
          product_name: { "en-US": "Silverado Entry Package", "es-US": "Paquete Silverado" },
          quantity: 2,
          unit_price: { amount_minor: "2500", currency: "USD" },
          line_total: { amount_minor: "5000", currency: "USD" },
          product_kind: "ENTRY_PACKAGE",
        },
      ],
      subtotal: { amount_minor: "5000", currency: "USD" },
      shipping_total: null,
      tax_total: null,
      shipping_address: null,
      fulfillment_method: "PICKUP",
      entry_calculation: null,
    },
    payment_status: "PAID",
    paid_at: "2026-11-10T20:00:00.000Z",
    customer_name: "Jane Doe",
    refunded_total: { amount_minor: "0", currency: "USD" },
    entry_numbers: {
      digits: 8,
      active_count: 50,
      void_count: 0,
      offset: 0,
      next_offset: null,
      numbers: numbers(50, true),
    },
    ...overrides,
  };
}

function renderIn(locale: Locale, receipt: OrderReceipt) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="UTC"
    >
      <PaymentReceipt receipt={receipt} locale={locale} numbersPath={PATH} />
    </NextIntlClientProvider>,
  );
}

describe("comprobante de pago (DEC-103)", () => {
  it("pagado: el encabezado que pidio el cliente, en ingles", () => {
    renderIn("en", paidReceipt());

    expect(
      screen.getByRole("heading", { level: 1, name: "✅ Payment Successful!" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Thank you for your purchase!")).toBeInTheDocument();
    expect(
      screen.getByText("Your payment has been confirmed and your order is complete."),
    ).toBeInTheDocument();
  });

  it("los datos del pedido salen del comprobante servido", () => {
    renderIn("en", paidReceipt());

    const details = screen.getByRole("heading", { name: "Receipt" }).closest("div");
    expect(details).not.toBeNull();
    const scope = within(document.body);
    for (const [label, value] of [
      ["Order Number", "LSW-00001234"],
      ["Customer Name", "Jane Doe"],
      ["Amount Paid (USD)", "$57.99"],
      ["Payment Status", "Paid"],
      ["Payment Method", "Card"],
      ["Number of Entries", "50"],
    ] as const) {
      const term = scope.getByText(label);
      expect(term.nextElementSibling?.textContent, label).toContain(value);
    }
    expect(scope.getByText("Silverado Entry Package × 2")).toBeInTheDocument();
    // Fecha de pago en la hora del negocio (Nuevo Mexico), con su zona.
    expect(scope.getByText("Payment Date").nextElementSibling?.textContent).toMatch(
      /November 10, 2026.*1:00\s?PM MST/u,
    );
  });

  it("los tres botones: PDF bajo el origen del sitio, verificador e inicio", () => {
    renderIn("en", paidReceipt());

    const download = screen.getByRole("link", { name: "Download Receipt" });
    expect(download).toHaveAttribute("href", `/receipts/${ORDER_ID}.pdf`);
    expect(download).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "Verify My Entries" })).toHaveAttribute(
      "href",
      "/account/entries",
    );
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
  });

  it("pinta cada numero de este pedido una vez", () => {
    const receipt = paidReceipt();
    renderIn("en", receipt);

    for (const entry of receipt.entry_numbers?.numbers ?? []) {
      expect(screen.getByText(entry.number)).toBeInTheDocument();
    }
    expect(screen.getByText("50 active entry numbers")).toBeInTheDocument();
  });

  it("miles de numeros: solo el tramo servido, con enlaces al siguiente", () => {
    renderIn(
      "en",
      paidReceipt({
        order: { ...paidReceipt().order, entries_granted: 2500 },
        entry_numbers: {
          digits: 8,
          active_count: 2500,
          void_count: 0,
          offset: 100,
          next_offset: 200,
          numbers: numbers(100, true, 100),
        },
      }),
    );

    expect(
      screen.getAllByRole("listitem").filter((item) => /^\d{8}$/u.test(item.textContent ?? "")),
    ).toHaveLength(100);
    expect(screen.getByText("Showing 101–200 of 2,500")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      `${PATH}?numbers=200`,
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      `${PATH}?numbers=0`,
    );
  });

  it("devuelto: NO dice pago correcto, y los anulados se ven anulados", () => {
    const base = paidReceipt();
    renderIn("en", {
      ...base,
      payment_status: "REFUNDED",
      refunded_total: { amount_minor: "5799", currency: "USD" },
      order: { ...base.order, status: "REFUNDED", entry_state: "REVERSED", entries_granted: 0 },
      entry_numbers: {
        digits: 8,
        active_count: 0,
        void_count: 3,
        offset: 0,
        next_offset: null,
        numbers: numbers(3, false),
      },
    });

    expect(screen.queryByText("✅ Payment Successful!")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "This order was refunded" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Amount Refunded").nextElementSibling?.textContent).toContain("$57.99");
    expect(screen.getByText("Payment Status").nextElementSibling?.textContent).toBe("Refunded");
    expect(screen.getByText("Number of Entries").nextElementSibling?.textContent).toBe("0");
    expect(screen.getAllByText("(Void)")).toHaveLength(3);
    expect(screen.getByText("0 active entry numbers")).toBeInTheDocument();
  });

  it("participaciones pendientes: ninguna cifra, y se vuelve a preguntar", () => {
    vi.useFakeTimers();
    try {
      const base = paidReceipt();
      renderIn("en", {
        ...base,
        order: { ...base.order, entry_state: "PENDING_QUALIFICATION", entries_granted: null },
        entry_numbers: null,
      });

      expect(screen.getByText("Your entries are being processed")).toBeInTheDocument();
      expect(screen.getByText("Number of Entries").nextElementSibling?.textContent).toBe("Pending");
      vi.advanceTimersByTime(3_100);
      expect(refresh).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin participaciones por una causa valida: lo dice, sin inventar numeros", () => {
    const base = paidReceipt();
    renderIn("en", {
      ...base,
      order: { ...base.order, entry_state: "NOT_APPLICABLE", entries_granted: null },
      entry_numbers: null,
    });

    expect(
      screen.getByText("This order does not include sweepstakes entries."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/active entry number/u)).toBeNull();
  });

  it("efectivo cobrado: Payment Method dice Cash", () => {
    const base = paidReceipt();
    renderIn("en", { ...base, order: { ...base.order, payment_method: "CASH" } });
    expect(screen.getByText("Payment Method").nextElementSibling?.textContent).toBe("Cash");
  });

  it("en espanol tambien, con el mismo PDF", () => {
    renderIn("es", paidReceipt());
    expect(
      screen.getByRole("heading", { level: 1, name: "✅ ¡Pago realizado!" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Descargar comprobante" })).toHaveAttribute(
      "href",
      `/receipts/${ORDER_ID}.pdf`,
    );
  });

  it("botones a todo el ancho en movil y en fila desde sm", () => {
    renderIn("en", paidReceipt());
    const download = screen.getByRole("link", { name: "Download Receipt" });
    expect(download.className).toContain("w-full");
    expect(download.className).toContain("sm:w-auto");
    expect(download.parentElement?.className).toContain("flex-col");
    expect(download.parentElement?.className).toContain("sm:flex-row");
  });
});
