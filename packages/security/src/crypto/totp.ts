/**
 * Segundo factor TOTP, RFC 6238 (DEC-006, DEC-045).
 *
 * EL RELOJ LLEGA COMO PARAMETRO
 *   Igual que en `session.ts`. `otpauth` puede leer el reloj por su cuenta, y
 *   aqui no se le deja: un TOTP se define por ventanas de tiempo, y una
 *   funcion que no admite un instante externo solo se puede probar "ahora", no
 *   en el borde de una ventana, que es donde estan los fallos.
 *
 * UN CODIGO SOLO VALE UNA VEZ
 *   `verifyTotp` devuelve el contador de la ventana que acepto, y el llamante
 *   DEBE persistirlo en `identity_mfa_factors.last_used_counter` y pasarlo la
 *   proxima vez como `lastUsedCounter`. Sin eso, un codigo interceptado sirve
 *   durante toda su ventana y ademas durante la tolerancia: hasta minuto y
 *   medio para reutilizar un codigo visto por encima del hombro.
 *
 *   Esta responsabilidad esta partida a proposito. Este modulo no habla con la
 *   base de datos, asi que no puede garantizar el consumo por si solo; lo que
 *   si hace es devolver el dato imprescindible y rechazar todo contador que no
 *   sea estrictamente mayor que el ultimo consumido.
 */

import { Secret, TOTP } from "otpauth";

/** Parametros del estandar. Los que asumen Google Authenticator y similares. */
export const TOTP_PARAMETERS = Object.freeze({
  algorithm: "SHA1" as const,
  digits: 6,
  periodSeconds: 30,
});

/**
 * Ventanas de tolerancia a cada lado. Una ventana (30 s) cubre el desfase de
 * reloj razonable de un telefono. Subirlo amplia la superficie de reutilizacion
 * de un codigo; bajarlo a cero rechaza a gente con el reloj ligeramente
 * desajustado.
 */
export const TOTP_WINDOW = 1;

/** 20 bytes es lo que recomienda el RFC 4226 para SHA-1. */
export const TOTP_SECRET_BYTES = 20;

export interface TotpVerification {
  readonly valid: boolean;
  /**
   * Contador de la ventana aceptada. `null` si no valido. Hay que persistirlo:
   * es lo que impide reutilizar el mismo codigo.
   */
  readonly counter: number | null;
}

function buildTotp(secretBase32: string, label: string, issuer: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: TOTP_PARAMETERS.algorithm,
    digits: TOTP_PARAMETERS.digits,
    period: TOTP_PARAMETERS.periodSeconds,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Secreto nuevo en base32, que es el formato que leen los autenticadores. */
export function generateTotpSecret(): string {
  return new Secret({ size: TOTP_SECRET_BYTES }).base32;
}

/**
 * URI `otpauth://` para el codigo QR de inscripcion.
 *
 * Contiene el secreto en claro: es correcto -el autenticador lo necesita- pero
 * significa que esta cadena no debe registrarse en un log ni guardarse. Se
 * genera, se muestra una vez y se descarta.
 */
export function totpProvisioningUri(secretBase32: string, label: string, issuer: string): string {
  return buildTotp(secretBase32, label, issuer).toString();
}

/**
 * Verifica un codigo contra un instante dado.
 *
 * @param nowMillis  Milisegundos desde epoch UTC. Nunca se lee el reloj aqui.
 * @param lastUsedCounter  Ultimo contador ya consumido, o `null` si es la
 *   primera vez. Un codigo de esa ventana o anterior se rechaza aunque sea
 *   matematicamente correcto.
 */
export function verifyTotp(options: {
  readonly code: string;
  readonly secretBase32: string;
  readonly nowMillis: number;
  readonly lastUsedCounter: number | null;
}): TotpVerification {
  const normalized = options.code.replace(/\s/gu, "");

  // Se comprueba la forma antes de derivar nada: un codigo con letras no puede
  // ser valido y no merece trabajo criptografico.
  if (!/^\d{6}$/u.test(normalized)) {
    return { valid: false, counter: null };
  }

  const totp = buildTotp(options.secretBase32, "verification", "lsw");

  const delta = totp.validate({
    token: normalized,
    timestamp: options.nowMillis,
    window: TOTP_WINDOW,
  });

  if (delta === null) {
    return { valid: false, counter: null };
  }

  const currentCounter = Math.floor(options.nowMillis / 1_000 / TOTP_PARAMETERS.periodSeconds);
  const acceptedCounter = currentCounter + delta;

  // El corazon de la proteccion contra reutilizacion: una ventana ya consumida
  // no se vuelve a aceptar, aunque el codigo sea correcto.
  if (options.lastUsedCounter !== null && acceptedCounter <= options.lastUsedCounter) {
    return { valid: false, counter: null };
  }

  return { valid: true, counter: acceptedCounter };
}
