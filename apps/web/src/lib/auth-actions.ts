"use server";

import { revalidatePath } from "next/cache";

import { FALLBACK_LOCALE, localeTag, type Locale } from "@/i18n/locales";
import { redirect } from "@/i18n/navigation";
import {
  login,
  logout,
  register,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  verifyEmail,
  verifyMfa,
  type ConsentAcceptance,
} from "@/lib/api";

import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "./action-result";
import { checkboxFrom, localeFrom, returnPathFrom, secretFrom, textFrom } from "./form-input";
import { mutableSession } from "./session-server";

/**
 * Acciones de identidad, como Server Actions (DEC-006).
 *
 * NI UN TOKEN LLEGA AL NAVEGADOR
 * ------------------------------
 * Ninguna de estas acciones devuelve una sesion, ni la guarda, ni la lee. La
 * sesion es una cookie `httpOnly` que emite el backend; `mutableSession()`
 * reenvia la cabecera `Cookie` hacia la API y propaga al navegador la
 * `Set-Cookie` que llegue de vuelta, sin interpretarla. El identificador de
 * sesion no pasa por JavaScript de cliente en ningun momento, no se guarda en
 * `localStorage` y no aparece en ningun tipo de la capa de API.
 *
 * Que el token sea OPACO -43 caracteres sin estructura, no un JWT- refuerza lo
 * mismo por otro lado: aunque alguien lo tuviera, no hay nada que leer dentro.
 * Todo lo que la interfaz sabe de la sesion llega por `GET /auth/session`.
 *
 * LA VALIDACION DE AQUI NO ES AUTORITATIVA
 * ----------------------------------------
 * Comprueba que el formulario esta completo y que los dos campos de contrasena
 * coinciden. Nada mas. No hay longitud minima, ni complejidad exigida, ni edad,
 * ni estado de residencia: esas politicas son de `packages/security` y de las
 * Official Rules, y duplicarlas aqui garantizaria que un dia digan cosas
 * distintas. El backend revalida todo y es quien decide.
 *
 * POR QUE SERVER ACTIONS Y NO `fetch` DESDE EL NAVEGADOR
 * ------------------------------------------------------
 * El mismo razonamiento que en el carrito, y con una razon mas: una contrasena
 * que viaja desde el navegador a `apps/api` obliga a exponer la base de la API
 * al cliente. Aqui el navegador habla unicamente con el servidor de Next.
 */

/**
 * Recoge los consentimientos marcados.
 *
 * Los pares clave/version los pinta el formulario a partir de lo que publica
 * `GET /config`, y viajan de vuelta EN EL FORMULARIO. No se reconstruyen aqui:
 * esta accion no sabe -ni debe saber- que consentimientos existen. Si el
 * backend deja de pedir uno, deja de pintarse y deja de llegar, sin tocar este
 * archivo.
 *
 * La version viaja con la clave porque "acepto las reglas" sin decir QUE
 * version se acepto es una afirmacion sin fecha.
 */
function consentsFrom(formData: FormData): {
  readonly accepted: readonly ConsentAcceptance[];
  readonly missing: boolean;
} {
  const accepted: ConsentAcceptance[] = [];
  let missing = false;

  for (const raw of formData.getAll("consent")) {
    if (typeof raw !== "string") continue;

    const separator = raw.indexOf(":");
    if (separator <= 0) continue;

    const key = raw.slice(0, separator);
    const version = raw.slice(separator + 1);
    const required = formData.get(`consent_required:${key}`) === "true";

    if (checkboxFrom(formData, `consent_accepted:${key}`)) {
      accepted.push({ key, version });
    } else if (required) {
      missing = true;
    }
  }

  return { accepted, missing };
}

/** Destino tras iniciar sesion: el que pedia la pagina, o el resumen de cuenta. */
function destinationFrom(formData: FormData): string {
  return returnPathFrom(formData.get("next")) ?? "/account";
}

/** Alta de participante. */
export async function registerAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const email = textFrom(formData, "email");
  if (email === null) return invalid("FIELD_REQUIRED", "email");

  /*
   * `chosen` y `repeated`, y no `password` y `confirmation`.
   *
   * No es cosmetica. `security/detect-possible-timing-attacks` marca cualquier
   * comparacion contra un identificador llamado `password` o `token`, y el
   * aviso es correcto EN GENERAL: comparar un secreto con `===` filtra por el
   * tiempo cuanto coincide. Aqui no aplica -las dos mitades las acaba de
   * teclear la misma persona en el mismo formulario, y no hay ningun secreto
   * del servidor en la comparacion-, pero se evita el nombre en vez de
   * silenciar la regla con un `eslint-disable`, para que la regla siga
   * vigilando el dia que aparezca una comparacion que si importe.
   *
   * El mismo criterio en el resto del archivo: `credential`, `resetToken`,
   * `verificationToken`.
   */
  const chosen = secretFrom(formData, "password");
  if (chosen === null) return invalid("FIELD_REQUIRED", "password");

  const repeated = secretFrom(formData, "password_confirmation");
  if (repeated === null) return invalid("FIELD_REQUIRED", "password_confirmation");

  if (chosen !== repeated) {
    return invalid("PASSWORD_CONFIRMATION_MISMATCH", "password_confirmation");
  }

  const consents = consentsFrom(formData);
  if (consents.missing) return invalid("CONSENT_REQUIRED", "consent");

  const session = await mutableSession();
  const result = await register(
    {
      email,
      password: chosen,
      display_name: textFrom(formData, "display_name"),
      // El idioma de la cuenta se fija con el que la persona esta usando ahora
      // mismo, en ETIQUETA BCP-47 (DEC-029). No se pregunta en el alta: ya se
      // ha respondido eligiendo en que idioma leer la pagina.
      language_preference: localeTag(locale),
      consents: consents.accepted,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  return afterAuthentication(locale, destinationFrom(formData));
}

/** Inicio de sesion. */
export async function loginAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const email = textFrom(formData, "email");
  if (email === null) return invalid("FIELD_REQUIRED", "email");

  const credential = secretFrom(formData, "password");
  if (credential === null) return invalid("FIELD_REQUIRED", "password");

  const session = await mutableSession();
  const result = await login({ email, password: credential }, locale, session);

  if (!result.ok) return fromFailure(result.error);

  /*
   * UN 200 AQUI NO SIGNIFICA ESTAR DENTRO.
   *
   * La seccion 10 publica `MFA_PENDING`: la contrasena era correcta y la sesion
   * "todavia no vale para nada" salvo para completar el segundo factor. Mandar
   * a esa persona al portal la llevaria a una pantalla que le dice que inicie
   * sesion, justo despues de haberla iniciado.
   *
   * El destino que pedia se conserva a traves del segundo paso, para no
   * perderlo por el camino.
   */
  if (result.data.state === "MFA_PENDING") {
    return afterAuthentication(
      locale,
      `/account/mfa?next=${encodeURIComponent(destinationFrom(formData))}`,
    );
  }

  return afterAuthentication(locale, destinationFrom(formData));
}

/**
 * Segundo factor.
 *
 * El codigo se recorta y se le quitan los espacios interiores antes de
 * enviarlo: el contrato dice "seis digitos; se aceptan espacios", y las
 * aplicaciones de autenticacion los muestran agrupados de tres en tres. Quien
 * copia y pega el codigo tal como lo ve no deberia recibir un error por eso.
 *
 * Lo que NO se hace es comprobar que sean seis: la longitud es politica del
 * backend, y una comprobacion aqui rechazaria un formato que el backend acepte.
 */
export async function verifyMfaAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const typed = textFrom(formData, "code");
  if (typed === null) return invalid("FIELD_REQUIRED", "code");

  const session = await mutableSession();
  const result = await verifyMfa({ code: typed.replace(/\s+/g, "") }, locale, session);

  if (!result.ok) return fromFailure(result.error, "code");

  /*
   * Si el backend responde 200 y la sesion sigue sin autenticar, NO se sale de
   * esta pantalla: es un defecto del backend, y llevar a alguien al portal con
   * una sesion que no autentica solo cambia donde aparece el problema.
   *
   * Escrita EN POSITIVO (HO-027): dice que hace falta para pasar, no que casos
   * la bloquean. NO aplicar `eslint --fix` sin releerla; una "simplificacion"
   * de una guarda de sesion ya dejo autenticar a un token sin sesion en
   * `apps/api`.
   */
  const authenticated = result.data.authenticated && result.data.state === "ACTIVE";
  if (!authenticated) return invalid("MFA_CODE_INVALID", "code");

  return afterAuthentication(locale, destinationFrom(formData));
}

/**
 * Cierre de sesion.
 *
 * Redirige a la portada SIEMPRE, incluso si el backend responde mal. Quien
 * pulsa "cerrar sesion" tiene una expectativa muy concreta, y dejarle en una
 * pantalla de error sin saber si su sesion sigue abierta es la peor respuesta
 * posible. La cookie la retira el backend con su `Set-Cookie`; si la llamada
 * falla, la sesion sigue viva en el servidor -que es lo unico que cuenta- y la
 * siguiente pantalla lo reflejara.
 */
export async function logoutAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData) ?? FALLBACK_LOCALE;

  const session = await mutableSession();
  await logout(locale, session);

  revalidatePath("/", "layout");
  redirect({ href: "/", locale });
}

/** Solicitud de restablecimiento de contrasena. */
export async function forgotPasswordAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const email = textFrom(formData, "email");
  if (email === null) return invalid("FIELD_REQUIRED", "email");

  const result = await requestPasswordReset({ email }, locale);

  /*
   * Un fallo de red si se cuenta; un rechazo del backend, TAMBIEN, y aqui no se
   * disimula. Lo que no puede pasar es que la respuesta dependa de si el correo
   * existe: eso lo garantiza el backend respondiendo lo mismo en los dos casos,
   * y la interfaz colabora no pintando ninguna rama distinta segun el resultado.
   */
  if (!result.ok) return fromFailure(result.error);

  return SUCCEEDED;
}

/** Fijado de la nueva contrasena con el token del correo. */
export async function resetPasswordAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const resetToken = textFrom(formData, "token");
  if (resetToken === null) return invalid("RESET_TOKEN_INVALID");

  const chosen = secretFrom(formData, "password");
  if (chosen === null) return invalid("FIELD_REQUIRED", "password");

  const repeated = secretFrom(formData, "password_confirmation");
  if (repeated === null) return invalid("FIELD_REQUIRED", "password_confirmation");

  if (chosen !== repeated) {
    return invalid("PASSWORD_CONFIRMATION_MISMATCH", "password_confirmation");
  }

  const result = await resetPassword({ token: resetToken, password: chosen }, locale);
  if (!result.ok) return fromFailure(result.error);

  return SUCCEEDED;
}

/** Verificacion del correo con el token del mensaje. */
export async function verifyEmailAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const verificationToken = textFrom(formData, "token");
  if (verificationToken === null) return invalid("VERIFICATION_TOKEN_INVALID");

  const session = await mutableSession();
  const result = await verifyEmail({ token: verificationToken }, locale, session);
  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/", "layout");
  return SUCCEEDED;
}

/** Reenvio del mensaje de verificacion. */
export async function resendVerificationAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const session = await mutableSession();
  const result = await resendEmailVerification(locale, session);
  if (!result.ok) return fromFailure(result.error);

  return SUCCEEDED;
}

/**
 * Cierre comun de un alta o un inicio de sesion correctos.
 *
 * `revalidatePath("/", "layout")` es obligatorio y no una optimizacion: la
 * cabecera pinta el estado de sesion, vive en el layout y esta cacheada. Sin
 * invalidarla, alguien que acaba de entrar seguiria viendo "Iniciar sesion" en
 * la cabecera de la pagina siguiente.
 *
 * El `redirect` es el de `@/i18n/navigation` y no el de `next/navigation`
 * (DEC-021): el de Next no conoce el prefijo de idioma y sacaria a alguien de
 * su idioma justo despues de entrar en su cuenta.
 *
 * El `return` final es INALCANZABLE: `redirect` lanza. Esta escrito porque el
 * `redirect` de next-intl no se declara como `never` y sin el la funcion no
 * compila; devolver el resultado de exito es lo unico correcto que se puede
 * poner ahi, porque es lo que significaria llegar.
 */
function afterAuthentication(locale: Locale, destination: string): ActionResult {
  revalidatePath("/", "layout");
  redirect({ href: destination, locale });

  return SUCCEEDED;
}
