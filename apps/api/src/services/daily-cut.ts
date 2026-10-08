/**
 * Corte de caja diario (DEC-085).
 *
 * El dia va de 12:00 a. m. a 11:59 p. m. en la hora del punto de venta, que el
 * cliente fijo en la de NUEVO MEXICO (`America/Denver`, con su horario de
 * verano). No es la zona legal de la promocion (`America/Chicago`): el corte
 * cuadra la caja de una tienda, no el periodo de un sorteo.
 *
 * Aqui solo se calcula la VENTANA y se da forma a la respuesta. Que cuenta
 * como cobrado -`paid_at` dentro de la ventana- lo decide la consulta de
 * `DrizzleAdminReadRepository.dailyCut`.
 */

export const DAILY_CUT_TIME_ZONE = "America/Denver";

/** Desfase de `timeZone` respecto de UTC en `instant`, en milisegundos. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");

  const wallAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallAsUtc - instant.getTime();
}

/**
 * Instante en que empieza el dia `date` (`YYYY-MM-DD`) en `timeZone`.
 *
 * Dos pasadas: la primera estima con el desfase de la medianoche UTC; la
 * segunda corrige si entre medias hubo cambio de horario.
 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, day);

  let guess = midnightAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    guess = midnightAsUtc - offsetAt(new Date(guess), timeZone);
  }
  return new Date(guess);
}

/** El dia siguiente a `date`, tambien `YYYY-MM-DD`. Aritmetica de calendario, sin zona. */
export function nextDate(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** `true` si `date` es una fecha de calendario real (no `2026-02-30`). */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** `[from, to)` del dia `date` en la zona del corte. */
export function dailyCutWindow(date: string): { readonly from: Date; readonly to: Date } {
  return {
    from: startOfLocalDay(date, DAILY_CUT_TIME_ZONE),
    to: startOfLocalDay(nextDate(date), DAILY_CUT_TIME_ZONE),
  };
}
