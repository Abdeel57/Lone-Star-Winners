import type { EntryMultiplier, MoneyMinor } from "@/lib/api/contract";

import { localeTag, type Locale } from "./locales";

/**
 * Formateo de dinero, participaciones e instantes.
 *
 * Estas funciones son la unica frontera donde un valor del contrato de API se
 * convierte en texto. Concentrarlo aqui es lo que impide que las reglas de
 * DEC-010 se filtren a los componentes.
 *
 * Reglas que estas funciones hacen cumplir
 * ----------------------------------------
 * - DEC-010: el dinero viaja como CADENA DE DIGITOS en unidad menor
 *   (`amount_minor`) mas `currency`. Nunca se convierte a `number`: un importe
 *   grande no sobrevive a `Number()` sin riesgo de perder precision, y ese es
 *   justo el fallo que el contrato quiere impedir. Aqui se manipula como texto
 *   -se inserta el separador decimal moviendo caracteres- y se entrega a `Intl`
 *   como cadena numerica, que ECMA-402 acepta con precision arbitraria.
 * - DEC-010: las participaciones son enteros y NO SE DIVIDEN JAMAS. Los
 *   multiplicadores son fracciones y aqui no se evaluan: se imprimen.
 * - DEC-011: un instante legalmente relevante se formatea contra la zona legal
 *   DECLARADA por la promocion (`promotion.legal_timezone`), nunca contra la
 *   del navegador. Por eso `timeZone` es un parametro obligatorio: no hay forma
 *   de olvidarse de pasarlo.
 *
 * NINGUNA de estas funciones calcula una cifra de participaciones. Ese numero
 * lo produce el backend sobre el carrito de servidor (DEC-023, requisito R13 de
 * `security`) y aqui solo se formatea.
 */

/** Un importe en unidad menor: digitos, con signo negativo opcional. */
const AMOUNT_MINOR_PATTERN = /^-?\d+$/;

/**
 * Comprueba que una cadena construida en tiempo de ejecucion es una literal
 * numerica que `Intl` acepta.
 *
 * TypeScript tipa `Intl.NumberFormat.format` como
 * `number | bigint | StringNumericLiteral`, y `StringNumericLiteral` es un tipo
 * de plantilla que ninguna cadena calculada satisface por si sola. Este
 * predicado hace la comprobacion DE VERDAD, en tiempo de ejecucion, en vez de
 * silenciar al compilador con una asercion.
 */
function isNumericLiteral(value: string): value is Intl.StringNumericLiteral {
  // Se parte y se comprueba cada mitad por separado, en vez de usar un patron
  // con un cuantificador dentro de otro (`(\.\d+)?`). Ese anidamiento es el
  // que dispara el retroceso catastrofico y el que `security/detect-unsafe-regex`
  // marca con razon: en este repositorio un aviso de ESLint sobre una expresion
  // regular ya ha sido tres veces un patron corrupto de verdad (HO-014).
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integer, fraction, ...rest] = unsigned.split(".");

  if (rest.length > 0) return false;
  if (integer === undefined || !DIGITS.test(integer)) return false;

  return fraction === undefined || DIGITS.test(fraction);
}

const DIGITS = /^\d+$/;

/**
 * Formatea un importe.
 *
 * Devuelve `null` si el importe no respeta DEC-010, para que la pantalla pueda
 * decidir que hacer en vez de escribir "NaN" delante de un participante.
 *
 * El separador decimal se inserta MOVIENDO CARACTERES, no dividiendo. No hay
 * ninguna operacion aritmetica en toda la funcion.
 */
export function formatMoney(money: MoneyMinor | null | undefined, locale: Locale): string | null {
  // Ausencia (la API no publica el importe) se trata como importe invalido: no
  // se pinta nada, y la pantalla decide. Nunca "NaN" ni "$0.00" inventado.
  if (money === null || money === undefined) return null;
  if (!AMOUNT_MINOR_PATTERN.test(money.amount_minor)) return null;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(localeTag(locale), {
      style: "currency",
      currency: money.currency,
    });
  } catch {
    // `currency` invalido: `Intl` lanza `RangeError`. Es un defecto del dato,
    // no de la pantalla, y hay que poder verlo sin romper el render.
    return null;
  }

  // `maximumFractionDigits` es opcional en el tipo de `resolvedOptions`. El
  // respaldo son 2 -la unidad menor habitual, los centavos-. `??` y no `||`:
  // `0` es un valor legitimo (JPY no tiene decimales).
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  const negative = money.amount_minor.startsWith("-");
  const digits = negative ? money.amount_minor.slice(1) : money.amount_minor;

  const padded = digits.padStart(fractionDigits + 1, "0");
  const whole = padded.slice(0, padded.length - fractionDigits);
  const fraction = fractionDigits === 0 ? "" : `.${padded.slice(padded.length - fractionDigits)}`;
  const decimal = `${negative ? "-" : ""}${whole}${fraction}`;

  if (!isNumericLiteral(decimal)) return null;

  return formatter.format(decimal);
}

/**
 * Formatea un numero de participaciones.
 *
 * Siempre entero, siempre con separador de miles del locale: "11,000". Un
 * participante tiene que poder leer su saldo de un vistazo y sin ambiguedad.
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

/**
 * Si un multiplicador amplifica de verdad.
 *
 * Es una COMPARACION, no una multiplicacion. Sirve para decidir si se anuncia
 * un periodo de multiplicador; ninguna cifra de participaciones sale de aqui.
 *
 * `denominator <= 0` se trata como "no amplifica": un denominador invalido es
 * un defecto del dato, y ante un dato defectuoso la interfaz calla en vez de
 * afirmar algo sobre las condiciones de participacion.
 */
export function multiplierAmplifies(multiplier: EntryMultiplier): boolean {
  return multiplier.denominator > 0 && multiplier.numerator > multiplier.denominator;
}

export interface ZonedInstantOptions {
  /**
   * Zona horaria IANA contra la que se evalua el instante. Obligatoria y sin
   * valor por defecto: DEC-011 prohibe caer en la zona del navegador.
   */
  readonly timeZone: string;
  /** Si se muestra tambien el nombre de la zona. Recomendado en plazos. */
  readonly showTimeZoneName?: boolean;
  /**
   * Longitud de la fecha. `long` es la de siempre y sigue siendo el valor por
   * defecto: es la que se usa en todo plazo que el participante pueda querer
   * apuntar.
   *
   * `medium` existe para UN sitio -la banda de anuncio, que es una linea de
   * texto en caja alta que tiene que caber en 360px- y no debe extenderse a
   * ningun plazo. Acorta el MES, nunca el ano: "30 dic 2026" sigue siendo una
   * fecha completa y sin ambiguedad, que es lo unico innegociable.
   *
   * Solo lo lee `formatZonedDate`; `formatZonedDateTime` mantiene su formato
   * largo porque ahi la hora y la zona son parte del dato.
   */
  readonly dateStyle?: "long" | "medium";
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
  const date = toDate(isoInstant);
  if (date === null) return null;

  // `timeStyle: "long"` incluye el nombre de la zona. No se usa la opcion
  // `timeZoneName` porque `Intl` lanza TypeError si se combina con
  // `dateStyle`/`timeStyle`.
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "long",
    timeStyle: options.showTimeZoneName === true ? "long" : "short",
    timeZone: options.timeZone,
  }).format(date);
}

/**
 * Convierte un valor del contrato en una fecha, o `null`.
 *
 * NO se hace `new Date(value)` a secas. `new Date(null)` devuelve la epoca -1
 * de enero de 1970- y es una fecha PERFECTAMENTE VALIDA para `Date`, asi que
 * `Number.isNaN` no la detecta. Ese camino existe de verdad: `apps/api` ya
 * devuelve `starts_at` y `ends_at` nulables aunque el contrato los declare
 * obligatorios, y sin esta comprobacion la portada anunciaria que la promocion
 * cierra el 1 de enero de 1970.
 *
 * El tipo dice `string` y aqui se comprueba igual: el tipo describe lo
 * acordado, no lo que llega por el cable.
 */
function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formatea una fraccion (0..1) como porcentaje.
 *
 * Se usa UNICAMENTE para el equivalente accesible de la barra de progreso de la
 * promocion. No formatea ninguna cifra de participaciones ni de dinero: esas
 * tienen sus propias funciones y sus propias reglas (DEC-010).
 *
 * Sin decimales a proposito. "El 47,3 % del periodo" sugiere una precision que
 * el dato no tiene ninguna necesidad de exhibir, y el plazo exacto ya esta
 * escrito al lado como fecha absoluta en la zona legal de la promocion.
 */
export function formatPercent(fraction: number, locale: Locale): string {
  if (!Number.isFinite(fraction)) return "";

  return new Intl.NumberFormat(localeTag(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(fraction);
}

/** Igual que `formatZonedDateTime` pero sin la hora. */
export function formatZonedDate(
  isoInstant: string,
  locale: Locale,
  options: ZonedInstantOptions,
): string | null {
  const date = toDate(isoInstant);
  if (date === null) return null;

  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: options.dateStyle ?? "long",
    timeZone: options.timeZone,
  }).format(date);
}
