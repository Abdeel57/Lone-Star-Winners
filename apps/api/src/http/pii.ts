/**
 * Enmascarado de datos personales, en la FRONTERA HTTP.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AQUI Y NO EN LA CONSULTA, Y POR QUE NO EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 *
 * En el navegador, nunca. Un correo que viaja entero y se tapa al pintarlo esta
 * en el HTML, en la pestana de red y en cualquier copia de la respuesta: taparlo
 * es un adorno, no un control. El dato que no se puede ver NO SE ENVIA.
 *
 * En la consulta, tampoco. La ruta que si esta autorizada a ver el dato completo
 * necesitaria una segunda consulta identica salvo en un campo, y dos consultas
 * que deben devolver lo mismo salvo un campo terminan divergiendo. Se consulta
 * una vez y se decide aqui, donde se sabe que capacidad declara la ruta.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE MODULO NO DECIDE
 * ---------------------------------------------------------------------------
 *
 * No decide QUIEN ve que. Eso lo decide el registro de rutas, declarando
 * `pii.view.masked` o `pii.view.full` (DEC-015, DEC-027), y lo comprueba el
 * autorizador antes del handler. Aqui solo se transforma un texto.
 *
 * ---------------------------------------------------------------------------
 * QUE FORMA TIENE EL ENMASCARADO
 * ---------------------------------------------------------------------------
 *
 * El catalogo describe `pii.view.masked` como "ver datos personales
 * enmascarados (ultimos digitos, dominio de correo)". De ahi salen las dos
 * reglas:
 *
 *   correo ... se conserva el DOMINIO entero y la primera letra de la parte
 *              local. El dominio es lo que permite reconocer un correo
 *              corporativo o desechable en una revision de fraude sin
 *              identificar a la persona.
 *   telefono . se conservan los DOS ULTIMOS digitos, que es lo que permite
 *              cotejar con lo que alguien dice por telefono sin publicarlo.
 *
 * La longitud original NO se conserva: un numero fijo de asteriscos evita
 * publicar cuantos caracteres tiene la parte oculta, que en un correo corto es
 * casi el dato entero.
 */

/** Lo que se pinta cuando el valor existe pero no puede publicarse entero. */
const HIDDEN = "***";

/**
 * Enmascara un correo conservando el dominio.
 *
 * `null` entra y `null` sale: que no haya correo -una cuenta anonimizada- y que
 * el correo este oculto son dos afirmaciones distintas, y fundirlas haria que la
 * pantalla no pudiera distinguirlas.
 *
 * Un texto sin `@` se enmascara ENTERO. No es un correo valido, asi que no se
 * puede suponer donde acaba la parte que identifica a la persona.
 */
export function maskEmail(email: string | null): string | null {
  if (email === null) {
    return null;
  }

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return HIDDEN;
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const initial = local.slice(0, 1);

  return `${initial}${HIDDEN}@${domain}`;
}

/**
 * Enmascara un telefono conservando los dos ultimos digitos.
 *
 * Se cuentan DIGITOS, no caracteres: `+1 (555) 010-1234` y `+15550101234` son
 * el mismo numero y deben enmascararse igual. Con menos de tres digitos no se
 * conserva ninguno: en un numero muy corto, dos digitos son casi el numero.
 */
export function maskPhone(phone: string | null): string | null {
  if (phone === null) {
    return null;
  }

  const digits = phone.replace(/\D/gu, "");
  if (digits.length < 3) {
    return HIDDEN;
  }

  return `${HIDDEN}${digits.slice(-2)}`;
}
