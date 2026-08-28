/**
 * Conversiones de entrada del panel de catalogo y promociones.
 *
 * DOS CONVERSIONES, LAS DOS SIN COMA FLOTANTE
 * -------------------------------------------
 * 1. Un precio tecleado como "25.00" tiene que llegar a la API como `2500`,
 *    entero en la unidad menor de su moneda (DEC-010). Se hace MOVIENDO
 *    CARACTERES, nunca multiplicando: `25.10 * 100` en coma flotante binaria
 *    no es 2510, y un error de redondeo en un precio se multiplica por cada
 *    pedido. Cuantos decimales tiene la moneda lo dice `Intl`, que es el mismo
 *    sitio que consulta `formatMoney`; no hay un `2` escrito a mano.
 *
 * 2. Una fecha tecleada como "2026-09-01T00:00" en el panel es una HORA DE
 *    PARED en la zona legal de la promocion (DEC-011), no en la del navegador
 *    ni en la del servidor. La API exige UTC, asi que hay que resolver que
 *    instante corresponde a esa hora de pared en esa zona. No existe una
 *    funcion nativa para eso; se resuelve con `Intl` por aproximacion en dos
 *    pasos, que es el metodo estandar, y se COMPRUEBA el resultado: una hora
 *    que no existe -las 02:30 del dia que el reloj salta a las 03:00- devuelve
 *    `null` en vez de una hora inventada.
 *
 * NADA DE ESTO ES ARITMETICA DE PARTICIPACIONES. Son precios y fechas, y viven
 * en el servidor: las acciones las llaman, los componentes no.
 */

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

/**
 * Decimales de una moneda segun `Intl`, o `null` si la moneda no es valida.
 *
 * `??` frente a `resolvedOptions().maximumFractionDigits`, que es opcional en el
 * tipo: el respaldo son 2 -centavos-, y `0` es un valor legitimo (JPY).
 */
export function fractionDigitsFor(currency: string): number | null {
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    return formatter.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return null;
  }
}

/**
 * "25.00" -> 2500. `null` si el texto no es un precio valido para esa moneda.
 *
 * Se aceptan MENOS decimales de los que la moneda admite ("25", "25.5") y se
 * rellenan con ceros a la derecha; se rechazan MAS ("25.999"), porque no hay
 * forma honesta de tirar el ultimo digito de un precio.
 */
export function priceToMinorUnits(text: string, currency: string): number | null {
  const digits = fractionDigitsFor(currency);
  if (digits === null) return null;

  // Se corta a mano en vez de con una expresion regular: dos grupos de digitos
  // separados por un punto no necesitan mas, y asi no hay nada que pueda
  // retroceder.
  const [whole = "", fraction = "", ...rest] = text.trim().split(".");
  if (rest.length > 0) return null;
  if (!/^\d+$/u.test(whole)) return null;
  if (fraction.length > 0 && !/^\d+$/u.test(fraction)) return null;
  if (fraction.length > digits) return null;

  const minor = `${whole}${fraction.padEnd(digits, "0")}`.replace(/^0+(?=\d)/u, "");
  const value = Number.parseInt(minor, 10);

  return Number.isSafeInteger(value) ? value : null;
}

/**
 * "2500" -> "25.00", para rellenar el campo de precio al editar.
 *
 * Es la inversa de `priceToMinorUnits` y, como ella, solo mueve caracteres.
 */
export function minorUnitsToPriceText(amountMinor: string, currency: string): string {
  const digits = fractionDigitsFor(currency);
  if (digits === null || !/^\d+$/u.test(amountMinor)) return amountMinor;
  if (digits === 0) return amountMinor;

  const padded = amountMinor.padStart(digits + 1, "0");
  const whole = padded.slice(0, padded.length - digits);
  const fraction = padded.slice(padded.length - digits);

  return `${whole}.${fraction}`;
}

/** `true` si `Intl` conoce la zona. Es el mismo catalogo que usa el formateador. */
export function isIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** La hora de pared que un instante tiene en una zona. */
function wallPartsInZone(instantMs: number, timeZone: string): WallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instantMs));

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // `hourCycle: "h23"` evita el "24" que algunos motores devuelven a medianoche.
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** Una hora de pared leida como si fuera UTC. Es la vara de medir, no un instante. */
function asUtcMs(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/**
 * Hora de pared en una zona -> instante ISO en UTC. `null` si la hora no existe
 * en esa zona (hueco de horario de verano) o el texto no tiene forma de fecha.
 */
export function zonedWallTimeToIso(wall: string, timeZone: string): string | null {
  const match = WALL_TIME.exec(wall.trim());
  if (match === null || !isIanaTimeZone(timeZone)) return null;

  const target: WallParts = {
    year: Number.parseInt(match[1] ?? "0", 10),
    month: Number.parseInt(match[2] ?? "0", 10),
    day: Number.parseInt(match[3] ?? "0", 10),
    hour: Number.parseInt(match[4] ?? "0", 10),
    minute: Number.parseInt(match[5] ?? "0", 10),
  };
  const wanted = asUtcMs(target);
  if (Number.isNaN(wanted)) return null;

  /*
   * Aproximacion en dos pasos: se parte de "la misma hora en UTC", se mide
   * cuanto se desvia la hora de pared que eso da en la zona, y se corrige. La
   * segunda vuelta absorbe el caso en que la correccion cruza un cambio de
   * horario. Despues se COMPRUEBA: si la hora de pared resultante no es la
   * pedida, esa hora no existe en esa zona.
   */
  let guess = wanted;
  for (let round = 0; round < 2; round += 1) {
    guess -= asUtcMs(wallPartsInZone(guess, timeZone)) - wanted;
  }

  if (asUtcMs(wallPartsInZone(guess, timeZone)) !== wanted) return null;

  return new Date(guess).toISOString();
}

/**
 * Instante ISO -> hora de pared en una zona, con la forma que acepta un
 * `<input type="datetime-local">`. Para rellenar el formulario al editar.
 */
export function isoToZonedWallTime(iso: string, timeZone: string): string | null {
  const instant = Date.parse(iso);
  if (Number.isNaN(instant) || !isIanaTimeZone(timeZone)) return null;

  const parts = wallPartsInZone(instant, timeZone);
  const two = (value: number): string => String(value).padStart(2, "0");

  return `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}

/**
 * Zonas que se ofrecen al crear una promocion.
 *
 * Son las de Estados Unidos continental mas Alaska y Hawai. NO hay valor por
 * defecto (DEC-011): la zona legal es una decision, y el formulario obliga a
 * tomarla. La lista no restringe nada -`isIanaTimeZone` acepta cualquier zona
 * que el motor conozca-; solo evita teclear.
 */
export const OFFERED_TIME_ZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];
