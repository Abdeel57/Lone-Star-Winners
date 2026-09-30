/**
 * Numeros de celular (DEC-060).
 *
 * SOLO NUMEROS DE EE. UU. (+1)
 *
 *   La promocion es estadounidense y el SMS de verificacion se cobra por
 *   mensaje: aceptar cualquier pais abriria la puerta al "SMS pumping", que
 *   consiste precisamente en pedir codigos a numeros de tarificacion especial
 *   de otros paises. Si algun dia hace falta otro pais, se amplia aqui a
 *   proposito, no por accidente.
 *
 * Se acepta lo que la gente escribe de verdad -`(512) 555-0100`,
 * `512.555.0100`, `+1 512 555 0100`, `15125550100`- y se devuelve siempre la
 * forma E.164 `+15125550100`, que es la que guarda la base de datos y la que
 * entiende Twilio.
 */

/**
 * Normaliza a E.164 (+1XXXXXXXXXX) o devuelve `null` si no es un numero de
 * EE. UU. plausible.
 *
 * Plausible segun el plan de numeracion (NANP): ni el codigo de area ni la
 * central empiezan por 0 o 1. No comprueba que el numero exista: eso lo sabe
 * el operador, y lo dira Twilio al intentar enviar.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;

  // Solo digitos y los separadores habituales. Una letra no es un telefono.
  if (!/^\+?[\d\s().-]+$/u.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/gu, "");
  if (trimmed.startsWith("+")) {
    if (!digits.startsWith("1")) return null;
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  if (!/^[2-9]\d{2}[2-9]\d{6}$/u.test(digits)) return null;

  return `+1${digits}`;
}

/** `+15125550100` -> `+1******0100`. Para logs. */
export function maskPhone(e164: string): string {
  return e164.length <= 6 ? "***" : `${e164.slice(0, 2)}******${e164.slice(-4)}`;
}
