import type { AdminDailyCutLine } from "@/lib/api";

/**
 * Corte de caja diario (DEC-085), del lado de la web.
 *
 * La ventana del dia y todas las cifras las calcula el backend. Aqui solo se
 * decide que dia pedir y se convierte lo recibido a CSV para descargarlo.
 */

/**
 * Hora del punto de venta: Nuevo Mexico, con su horario de verano. Es la MISMA
 * zona que usa la API para el corte (`DAILY_CUT_TIME_ZONE` en
 * `apps/api/src/services/daily-cut.ts`); si una cambiara, el selector de fecha
 * pediria un dia y la API devolveria otro.
 */
export const DAILY_CUT_TIME_ZONE = "America/Denver";

/** Fecha de calendario `YYYY-MM-DD` de `instant` en `timeZone`. */
export function calendarDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** `true` si `value` es una fecha de calendario real con forma `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** El dia anterior o siguiente, para las flechas del selector. */
export function shiftDate(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Celda CSV, con defensa contra inyeccion de formulas: una hoja de calculo
 * ejecuta lo que empiece por `=`, `+`, `-`, `@`, tabulador o retorno. Un nombre
 * de cliente asi se abre como texto, no como formula.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded;
}

export interface DailyCutCsvLabels {
  readonly headers: readonly string[];
  readonly paymentMethod: (method: AdminDailyCutLine["payment_method"]) => string;
  readonly fulfillment: (line: AdminDailyCutLine) => string;
  readonly address: (line: AdminDailyCutLine) => string;
  readonly productName: (line: AdminDailyCutLine) => string;
  readonly paidAt: (line: AdminDailyCutLine) => string;
}

/**
 * El apartado de mercancia del corte, una fila por linea. Con BOM UTF-8 para
 * que Excel abra bien los acentos, y CRLF, que es lo que espera.
 */
export function dailyCutCsv(
  lines: readonly AdminDailyCutLine[],
  labels: DailyCutCsvLabels,
): string {
  const rows = lines.map((line) =>
    [
      line.order_number,
      labels.paidAt(line),
      labels.paymentMethod(line.payment_method),
      line.customer_name,
      line.customer_email,
      labels.address(line),
      line.sku,
      labels.productName(line),
      line.quantity,
      line.refunded_quantity,
      labels.fulfillment(line),
      line.fulfillment.carrier,
      line.fulfillment.tracking_number,
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${[labels.headers.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
}
