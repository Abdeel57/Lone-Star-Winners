import { localeTag, type Locale } from "./locales";

/**
 * Formateo de dinero, participaciones e instantes.
 *
 * Estas funciones son la unica frontera donde un entero del contrato de API se
 * convierte en texto. Concentrarlo aqui es lo que impide que la aritmetica de
 * DEC-010 se filtre a los componentes.
 *
 * Reglas que estas funciones hacen cumplir
 * ----------------------------------------
 * - DEC-010: el dinero viaja como entero en unidad menor (`amount_minor`) mas
 *   `currency`. La UI NUNCA opera con ese numero: solo lo divide, y solo para
 *   pintarlo. Las participaciones son enteros y no se dividen jamas.
 * - DEC-011: un instante legalmente relevante se formatea contra la zona legal
 *   DECLARADA por la promocion (`promotion.legal_timezone`), nunca contra la
 *   del navegador. Por eso `timeZone` es un parametro obligatorio: no hay forma
 *   de olvidarse de pasarlo.
 */

/** Dinero tal como lo define el contrato: entero en unidad menor (DEC-010). */
export interface MoneyMinor {
  readonly amount_minor: number;
  readonly currency: string;
}

/**
 * Formatea un importe.
 *
 * La division por la potencia de diez es el UNICO punto donde este importe deja
 * de ser un entero, y ocurre a un paso de escribirlo en pantalla. No se usa
 * ningun resultado de esta funcion para calcular nada.
 */
export function formatMoney(money: MoneyMinor, locale: Locale): string {
  const formatter = new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: money.currency,
  });

  // `maximumFractionDigits` es opcional en el tipo de `resolvedOptions`. El
  // respaldo son 2 -la unidad menor habitual, los centavos- porque devolver un
  // divisor `NaN` convertiria un importe en "NaN" delante del participante.
  // `??` y no `||`: `0` es un valor legitimo (JPY no tiene decimales).
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10 ** fractionDigits;

  return formatter.format(money.amount_minor / divisor);
}

/**
 * Formatea un numero de participaciones.
 *
 * Siempre entero, siempre con separador de miles del locale: "11,000" en
 * ingles y "11,000" en espanol de EE. UU. Un participante tiene que poder leer
 * su saldo de un vistazo y sin ambiguedad.
 */
export function formatEntryCount(entries: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), {
    maximumFractionDigits: 0,
  }).format(Math.trunc(entries));
}

/** Formatea un entero cualquiera (unidades, cantidades). */
export function formatInteger(value: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 0 }).format(
    Math.trunc(value),
  );
}

export interface ZonedInstantOptions {
  /**
   * Zona horaria IANA contra la que se evalua el instante. Obligatoria y sin
   * valor por defecto: DEC-011 prohibe caer en la zona del navegador.
   */
  readonly timeZone: string;
  /** Si se muestra tambien el nombre de la zona. Recomendado en plazos. */
  readonly showTimeZoneName?: boolean;
}

/**
 * Formatea un instante ISO-8601 (UTC) en la zona legal indicada.
 *
 * Devuelve `null` si la fecha no es valida, para que la pantalla pueda decidir
 * que hacer en vez de pintar "Invalid Date".
 */
export function formatZonedDateTime(
  isoInstant: string,
  locale: Locale,
  options: ZonedInstantOptions,
): string | null {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return null;

  // `timeStyle: "long"` incluye el nombre de la zona. No se usa la opcion
  // `timeZoneName` porque `Intl` lanza TypeError si se combina con
  // `dateStyle`/`timeStyle`.
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "long",
    timeStyle: options.showTimeZoneName === true ? "long" : "short",
    timeZone: options.timeZone,
  }).format(date);
}

/** Igual que `formatZonedDateTime` pero sin la hora. */
export function formatZonedDate(
  isoInstant: string,
  locale: Locale,
  options: ZonedInstantOptions,
): string | null {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "long",
    timeZone: options.timeZone,
  }).format(date);
}
