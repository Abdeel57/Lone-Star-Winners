/**
 * DEC-103: el PDF del comprobante.
 *
 * Se comprueba el ARCHIVO, no solo que la funcion no falle: que la tabla de
 * referencias apunta a cada objeto (un lector estricto rechaza un PDF con
 * desplazamientos falsos), que estan los datos que pide el cliente, que no hay
 * nada sensible, y que un pedido con miles de numeros se reparte en paginas sin
 * perder ni repetir ninguno.
 */

import { describe, expect, it } from "vitest";

import type { OrderReceipt } from "../src/services/order-receipt.js";
import {
  entriesLabel,
  formatUsd,
  renderReceiptPdf,
  toWinAnsi,
} from "../src/services/receipt-pdf.js";

const ORDER_ID = "2420074f-563e-4595-9fc8-e58db006f8b0";

function receipt(overrides: Partial<OrderReceipt> = {}, numbers = 3): OrderReceipt {
  const list = Array.from({ length: numbers }, (_, index) => ({
    number: String(10_000_000 + index * 7919).padStart(8, "0"),
    active: true,
  }));
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
      entries_granted: numbers,
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
          sweepstakes_eligible: true,
          refunded_quantity: 0,
          product_kind: "ENTRY_PACKAGE",
        },
      ],
      subtotal: { amount_minor: "5000", currency: "USD" },
      shipping_total: { amount_minor: "799", currency: "USD" },
      tax_total: null,
      shipping_address: null,
      fulfillment_method: "PICKUP",
      fulfillment: {
        state: "UNFULFILLED",
        delivered_at: null,
        carrier: null,
        tracking_number: null,
      },
      entry_calculation: null,
    },
    payment_status: "PAID",
    paid_at: "2026-11-10T20:00:00.000Z",
    customer_name: "Jane Doe",
    refunded_total: { amount_minor: "0", currency: "USD" },
    entry_numbers: {
      digits: 8,
      active_count: numbers,
      void_count: 0,
      offset: 0,
      next_offset: null,
      numbers: list,
    },
    ...overrides,
  };
}

function render(value: OrderReceipt): string {
  return renderReceiptPdf({
    receipt: value,
    verifierUrl: "https://lonestarwinners.com/en/account/entries",
    websiteUrl: "lonestarwinners.com",
    contactEmail: "info@LoneStarWinners.com",
    timeZone: "America/Denver",
  }).toString("latin1");
}

/** Comprueba la estructura: cabecera, xref coherente con cada objeto y EOF. */
function assertWellFormed(pdf: string): number {
  expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
  expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);

  const startxref = /startxref\n(\d+)\n%%EOF/u.exec(pdf);
  expect(startxref).not.toBeNull();
  const xrefAt = Number(startxref?.[1]);
  expect(pdf.slice(xrefAt, xrefAt + 5)).toBe("xref\n");

  const header = /xref\n0 (\d+)\n/u.exec(pdf.slice(xrefAt));
  const size = Number(header?.[1]);
  const entries = pdf
    .slice(xrefAt)
    .split("\n")
    .filter((line) => line.endsWith(" 00000 n "));
  expect(entries).toHaveLength(size - 1);
  entries.forEach((line, index) => {
    const offset = Number(line.slice(0, 10));
    expect(pdf.slice(offset).startsWith(`${String(index + 1)} 0 obj\n`)).toBe(true);
  });

  // Cada stream declara su longitud real.
  for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/gu)) {
    const start = (match.index ?? 0) + match[0].length;
    expect(pdf.slice(start + Number(match[1]), start + Number(match[1]) + 10)).toBe("\nendstream");
  }
  return Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/u.exec(pdf)?.[1]);
}

describe("PDF del comprobante (DEC-103)", () => {
  it("es un PDF bien formado, tamano carta, con las fuentes estandar", () => {
    const pdf = render(receipt());

    expect(assertWellFormed(pdf)).toBe(1);
    expect(pdf).toContain("/MediaBox [0 0 612 792]");
    expect(pdf).toContain("/BaseFont /Helvetica ");
    expect(pdf).not.toContain("/FontFile"); // nada incrustado
  });

  it("lleva lo que pide el cliente: cabecera, datos del pedido, verificador, contacto y pie", () => {
    const pdf = render(receipt());

    for (const text of [
      "(LONE STAR WINNERS LLC)",
      "(PAYMENT RECEIPT)",
      "(Payment Successful)",
      "(Order Number)",
      "(LSW-00001234)",
      "(Payment Date)",
      "(November 10, 2026 at 1:00 PM MST)",
      "(Customer Name)",
      "(Jane Doe)",
      "(Silverado Entry Package × 2)",
      "($57.99 USD)",
      "(Payment Status)",
      "(Paid)",
      "(Payment Method)",
      "(Card)",
      "(Number of Entries)",
      "(https://lonestarwinners.com/en/account/entries)",
      "info@LoneStarWinners.com",
    ]) {
      expect(pdf, text).toContain(text);
    }
    expect(pdf).toContain(
      "This receipt confirms your purchase. Sweepstakes entries are subject to the",
    );
    expect(pdf).toContain("(Page 1 of 1)");
  });

  it("no lleva datos de pago sensibles ni identificadores de Stripe", () => {
    const pdf = render(receipt());
    expect(pdf).not.toMatch(/pi_|cs_test|cs_live|ch_|card number|cvv|•••• \d{4}/iu);
  });

  it("cada numero de participacion aparece una vez", () => {
    const value = receipt({}, 25);
    const pdf = render(value);
    for (const row of value.entry_numbers?.numbers ?? []) {
      expect(pdf.split(`(${row.number})`).length - 1, row.number).toBe(1);
    }
  });

  it("5,000 participaciones: varias paginas, ninguno perdido ni repetido, pie en todas", () => {
    const value = receipt({}, 5000);
    const pdf = render(value);
    const pages = assertWellFormed(pdf);

    expect(pages).toBeGreaterThan(3);
    const printed = [...pdf.matchAll(/\/F3 [\d.]+ Tf 1 0 0 1 [\d.]+ [\d.]+ Tm \((\d+)\) Tj/gu)].map(
      (match) => match[1],
    );
    expect(printed).toHaveLength(5000);
    expect(new Set(printed).size).toBe(5000);
    expect(pdf).toContain(`(Page ${String(pages)} of ${String(pages)})`);
    expect(pdf.split("This receipt confirms your purchase.").length - 1).toBe(pages);
  });

  it("devuelto: dice el estado real, el importe devuelto, y los numeros anulados aparte", () => {
    const base = receipt({}, 4);
    const pdf = render({
      ...base,
      payment_status: "REFUNDED",
      refunded_total: { amount_minor: "5799", currency: "USD" },
      order: { ...base.order, status: "REFUNDED", entry_state: "REVERSED", entries_granted: 0 },
      entry_numbers: {
        digits: 8,
        active_count: 0,
        void_count: 4,
        offset: 0,
        next_offset: null,
        numbers: (base.entry_numbers?.numbers ?? []).map((row) => ({ ...row, active: false })),
      },
    });

    expect(pdf).not.toContain("(Payment Successful)");
    expect(pdf).toContain("(Payment status: Refunded)");
    expect(pdf).toContain("(Amount Refunded)");
    expect(pdf).toContain("(Entry Numbers \\(0\\))");
    expect(pdf).toContain("(No active entry numbers remain for this order.)");
    expect(pdf).toContain("Voided Entry Numbers \\(4\\)");
  });

  it("sin numeros visibles (flag apagado) no inventa ninguno", () => {
    const pdf = render(receipt({ entry_numbers: null }));
    expect(pdf).not.toContain("Entry Numbers (");
    expect(pdf).toContain("(Number of Entries)");
  });

  it("un nombre con emoji o parentesis no rompe el archivo", () => {
    const pdf = render(receipt({ customer_name: "José (JJ) \u{1F600} Peña" }));
    assertWellFormed(pdf);
    expect(pdf).toContain("(José \\(JJ\\) ? Peña)");
  });

  it("efectivo dice Cash", () => {
    const base = receipt();
    expect(render({ ...base, order: { ...base.order, payment_method: "CASH" } })).toContain(
      "(Cash)",
    );
  });
});

describe("formato", () => {
  it("dolares desde la cadena de centavos, sin pasar por float", () => {
    expect(formatUsd("5799")).toBe("$57.99");
    expect(formatUsd("5")).toBe("$0.05");
    expect(formatUsd("123456789012")).toBe("$1,234,567,890.12");
    expect(formatUsd("-2500")).toBe("-$25.00");
  });

  it("participaciones: cifra solo cuando el ledger la tiene", () => {
    const base = receipt();
    expect(entriesLabel(base)).toBe("3");
    expect(
      entriesLabel({
        ...base,
        order: { ...base.order, entry_state: "PENDING_QUALIFICATION", entries_granted: null },
      }),
    ).toBe("Pending");
    expect(
      entriesLabel({
        ...base,
        order: { ...base.order, entry_state: "NOT_APPLICABLE", entries_granted: null },
      }),
    ).toBe("None for this order");
  });

  it("WinAnsi: espanol intacto, comillas tipograficas mapeadas, el resto a ?", () => {
    expect(toWinAnsi("Niño — “ok” ☃")).toBe("Niño \u0097 \u0093ok\u0094 ?");
  });
});
