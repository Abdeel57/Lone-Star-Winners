import { describe, expect, it } from "vitest";

import {
  calendarDateIn,
  csvCell,
  DAILY_CUT_TIME_ZONE,
  dailyCutCsv,
  isCalendarDate,
  shiftDate,
} from "@/lib/admin/daily-cut";
import type { AdminDailyCutLine } from "@/lib/api";

/**
 * Corte de caja del panel (DEC-085): que dia se pide y como sale el CSV.
 * Las cifras las calcula el backend y aqui no se prueba ninguna.
 */

const LINE: AdminDailyCutLine = {
  order_id: "0f8f5c9e-2b3a-4c1d-9e8f-7a6b5c4d3e2f",
  order_number: "LSW-00000042",
  paid_at: "2026-10-08T18:30:00.000Z",
  payment_method: "CASH",
  order_status: "CONFIRMED",
  customer_name: "Ada Lovelace",
  customer_email: "a***@example.test",
  fulfillment_method: "DELIVERY",
  shipping_address: {
    full_name: "Ada Lovelace",
    line1: "1 Fixture St",
    line2: null,
    city: "Albuquerque",
    region: "NM",
    postal_code: "87101",
    country: "US",
  },
  fulfillment: { state: "UNFULFILLED", delivered_at: null, carrier: null, tracking_number: null },
  sku: "CAP-STD",
  product_name: { "en-US": "Cap", "es-US": "Gorra" },
  quantity: 2,
  refunded_quantity: 0,
};

const LABELS = {
  headers: ["Pedido", "Cliente"],
  paymentMethod: () => "Efectivo",
  fulfillment: () => "Pendiente de envío",
  address: () => "1 Fixture St, Albuquerque, NM 87101, US",
  productName: () => "Gorra",
  paidAt: () => "8 de octubre de 2026, 12:30 p.m.",
};

describe("el dia del corte, en hora de Nuevo Mexico", () => {
  it("a las 11:30 p. m. del 8 en Nuevo Mexico, ya es dia 9 en UTC, pero el corte es del 8", () => {
    const lateEvening = new Date("2026-10-09T05:30:00.000Z");
    expect(DAILY_CUT_TIME_ZONE).toBe("America/Denver");
    expect(calendarDateIn(lateEvening, DAILY_CUT_TIME_ZONE)).toBe("2026-10-08");
  });

  it("las flechas cruzan meses, y una fecha imposible no se pide", () => {
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-10-08")).toBe(true);
  });
});

describe("CSV del corte", () => {
  it("una celda que empieza como formula se abre como texto", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@cliente")).toBe("'@cliente");
    expect(csvCell("Gorra")).toBe("Gorra");
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });

  it("comas y comillas van entre comillas", () => {
    expect(csvCell("1 Fixture St, Albuquerque")).toBe('"1 Fixture St, Albuquerque"');
  });

  it("lleva BOM para Excel, cabecera y una fila por linea, con CRLF", () => {
    const csv = dailyCutCsv([LINE], LABELS);
    expect(csv.startsWith("﻿")).toBe(true);

    const rows = csv.slice(1).split("\r\n");
    expect(rows[0]).toBe("Pedido,Cliente");
    expect(rows[1]).toBe(
      'LSW-00000042,"8 de octubre de 2026, 12:30 p.m.",Efectivo,Ada Lovelace,a***@example.test,"1 Fixture St, Albuquerque, NM 87101, US",CAP-STD,Gorra,2,0,Pendiente de envío,,',
    );
    expect(rows[2]).toBe("");
  });
});
