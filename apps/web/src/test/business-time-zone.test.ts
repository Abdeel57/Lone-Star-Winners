import { describe, expect, it } from "vitest";

import { formatZonedDate, formatZonedDateTime } from "@/i18n/formatters";
import { DAILY_CUT_TIME_ZONE } from "@/lib/admin/daily-cut";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";

/**
 * HORA OPERATIVA DEL NEGOCIO (DEC-095).
 *
 * El caso que lo motivo: una venta de las 7 de la tarde en Nuevo Mexico se
 * pintaba como "manana a la 1 de la madrugada" porque los pedidos se
 * formateaban en UTC, mientras el corte de caja -que si iba en hora local-
 * la contaba en el dia correcto. Lo que protege este fichero: que la zona sea
 * una sola, la del mostrador, y que la misma venta caiga en el mismo dia en
 * la ficha del pedido y en el corte.
 */
describe("zona horaria operativa", () => {
  it("es Nuevo Mexico, y el corte de caja usa exactamente la misma", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Denver");
    expect(DAILY_CUT_TIME_ZONE).toBe(BUSINESS_TIME_ZONE);
  });

  it("una venta de las 7 de la tarde se queda en su dia, no en el siguiente", () => {
    // 2026-10-22 19:00 en Nuevo Mexico (horario de verano, UTC-6) = 01:00Z del 23.
    const instant = "2026-10-23T01:00:00.000Z";

    expect(formatZonedDate(instant, "en", { timeZone: BUSINESS_TIME_ZONE })).toContain("22");
    expect(formatZonedDate(instant, "en", { timeZone: "UTC" })).toContain("23");

    const local = formatZonedDateTime(instant, "en", { timeZone: BUSINESS_TIME_ZONE }) ?? "";
    expect(local).toMatch(/7:00/u);
    expect(local).toMatch(/PM/iu);
  });

  it("tras el cambio de horario sigue siendo la hora local, con UTC-7", () => {
    // 2026-11-05 19:00 en Nuevo Mexico (horario de invierno, UTC-7) = 02:00Z del 6.
    const instant = "2026-11-06T02:00:00.000Z";

    expect(formatZonedDate(instant, "es", { timeZone: BUSINESS_TIME_ZONE })).toContain("5");
    expect(formatZonedDateTime(instant, "es", { timeZone: BUSINESS_TIME_ZONE }) ?? "").toMatch(
      /7:00/u,
    );
  });
});
