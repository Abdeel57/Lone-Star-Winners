"use server";

import { revalidatePath } from "next/cache";

import { FALLBACK_LOCALE, localeTag, type Locale } from "@/i18n/locales";
import { redirect } from "@/i18n/navigation";
import {
  logout,
  registerWithSignInCode,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  resetPasswordWithSms,
  startPhoneVerification,
  startSignInCode,
  verifyEmail,
  verifyMfa,
  verifySignInCode,
} from "@/lib/api";

import {
  fromCredentialFailure,
  fromFailure,
  invalid,
  SUCCEEDED,
  type ActionResult,
} from "./action-result";
import {
  agreementFrom,
  botCheckTokenFrom,
  localeFrom,
  returnPathFrom,
  secretFrom,
  textFrom,
} from "./form-input";
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
 * LA TIENDA ENTRA CON CODIGO (DEC-089)
 * ------------------------------------
 * Un participante entra o se da de alta con un codigo que le llega al correo o
 * al celular: `sendSignInCodeAction`, `verifySignInCodeAction` y
 * `completeSignupAction`. Ya no hay formulario de contrasena en la tienda. Las
 * acciones de contrasena que quedan son las de restablecerla, que usa el
 * personal; el panel inicia sesion con sus propias acciones
 * (`lib/admin/actions.ts`).
 *
 * POR QUE SERVER ACTIONS Y NO `fetch` DESDE EL NAVEGADOR
 * ------------------------------------------------------
 * El mismo razonamiento que en el carrito, y con una razon mas: una contrasena
 * que viaja desde el navegador a `apps/api` obliga a exponer la base de la API
 * al cliente. Aqui el navegador habla unicamente con el servidor de Next.
 */

/** Destino tras iniciar sesion: el que pedia la pagina, o el resumen de cuenta. */
function destinationFrom(formData: FormData): string {
  return returnPathFrom(formData.get("next")) ?? "/account";
}

/**
 * Paso 1 del acceso sin contrasena (DEC-089): enviar el codigo.
 *
 * Un solo campo, correo o celular; la arroba la mira la API, que es la unica
 * que decide que es un correo o un numero valido. El contacto vuelve al
 * formulario por el estado del cliente, no por esta accion: el resultado no
 * lleva datos (ver `ActionResult`).
 */
export async function sendSignInCodeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const contact = textFrom(formData, "contact");
  if (contact === null) return invalid("FIELD_REQUIRED", "contact");

  const token = botCheckTokenFrom(formData);
  const result = await startSignInCode(
    { contact, ...(token === undefined ? {} : { bot_check_token: token }) },
    locale,
  );

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    const field = code === "CONTACT_INVALID" || code === "PHONE_INVALID" ? "contact" : null;
    return fromFailure(result.error, field);
  }

  return SUCCEEDED;
}

/**
 * Paso 2 (DEC-089): comprobar el codigo.
 *
 * Si el contacto ya tenia cuenta, la sesion llega en la `Set-Cookie` y se sale
 * de la pantalla. Si no la tenia, la API deja una cookie `httpOnly` de alta
 * -que esta accion propaga sin leer- y el resultado `ok` le dice al formulario
 * que pase a pedir nombre y estado.
 *
 * Escrita EN POSITIVO (HO-027): dice que hace falta para entrar.
 */
export async function verifySignInCodeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const contact = textFrom(formData, "contact");
  if (contact === null) return invalid("FIELD_REQUIRED", "contact");

  const typed = textFrom(formData, "code");
  if (typed === null) return invalid("FIELD_REQUIRED", "code");

  const session = await mutableSession();
  const result = await verifySignInCode(
    { contact, code: typed.replace(/\s+/g, "") },
    locale,
    session,
  );

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    return fromFailure(result.error, code === "SIGN_IN_CODE_INVALID" ? "code" : null);
  }

  const { status, session: opened } = result.data;
  const signedIn =
    status === "SIGNED_IN" && opened !== null && opened.authenticated && opened.state === "ACTIVE";
  if (signedIn) return afterAuthentication(locale, destinationFrom(formData));

  if (status === "PROFILE_REQUIRED") return SUCCEEDED;

  return invalid("MALFORMED_RESPONSE");
}

/**
 * Paso 3, solo la primera vez (DEC-089): nombre, estado y la casilla de los
 * documentos. El contacto ya esta demostrado y viaja en la cookie de alta.
 */
export async function completeSignupAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const displayName = textFrom(formData, "display_name");
  if (displayName === null) return invalid("FIELD_REQUIRED", "display_name");

  // DEC-067: se pide y se manda; si con el se participa lo decide el backend.
  const residenceState = textFrom(formData, "residence_state");
  if (residenceState === null) return invalid("FIELD_REQUIRED", "residence_state");

  const agreement = agreementFrom(formData);
  if (agreement.missing) return invalid("CONSENT_REQUIRED", "consent");

  const session = await mutableSession();
  const result = await registerWithSignInCode(
    {
      display_name: displayName,
      residence_state: residenceState,
      consents: agreement.accepted,
      // El idioma de la cuenta es el que la persona esta usando ahora mismo, en
      // ETIQUETA BCP-47 (DEC-029). No se pregunta: ya se ha respondido eligiendo
      // en que idioma leer la pagina.
      language_preference: localeTag(locale),
    },
    locale,
    session,
  );

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    return fromFailure(result.error, code === "CONSENT_REQUIRED" ? "consent" : null);
  }

  return afterAuthentication(locale, destinationFrom(formData));
}

/**
 * Enviar un codigo por SMS (DEC-060). Primer paso del alta con celular y de la
 * recuperacion de contrasena de una cuenta con celular.
 *
 * El celular vuelve al formulario por el estado del cliente, no por esta
 * accion: el resultado no lleva datos (ver `ActionResult`).
 */
export async function sendPhoneCodeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const phone = textFrom(formData, "phone");
  if (phone === null) return invalid("FIELD_REQUIRED", "phone");

  const purpose =
    textFrom(formData, "purpose") === "PASSWORD_RESET" ? "PASSWORD_RESET" : "REGISTER";
  const token = botCheckTokenFrom(formData);

  const result = await startPhoneVerification(
    { phone, purpose, ...(token === undefined ? {} : { bot_check_token: token }) },
    locale,
  );

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    const field = code === "PHONE_INVALID" || code === "PHONE_ALREADY_REGISTERED" ? "phone" : null;
    return fromFailure(result.error, field);
  }

  return SUCCEEDED;
}

/** Fijar la contrasena con el codigo SMS (DEC-060). */
export async function resetPasswordSmsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const phone = textFrom(formData, "phone");
  if (phone === null) return invalid("FIELD_REQUIRED", "phone");

  const typed = textFrom(formData, "sms_code");
  if (typed === null) return invalid("FIELD_REQUIRED", "sms_code");

  const chosen = secretFrom(formData, "password");
  if (chosen === null) return invalid("FIELD_REQUIRED", "password");

  const repeated = secretFrom(formData, "password_confirmation");
  if (repeated === null) return invalid("FIELD_REQUIRED", "password_confirmation");

  if (chosen !== repeated) {
    return invalid("PASSWORD_CONFIRMATION_MISMATCH", "password_confirmation");
  }

  const result = await resetPasswordWithSms(
    { phone, code: typed.replace(/\s+/g, ""), password: chosen },
    locale,
  );

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    return fromFailure(
      result.error,
      code === "SMS_CODE_INVALID" ? "sms_code" : code === "WEAK_PASSWORD" ? "password" : null,
    );
  }

  return SUCCEEDED;
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

  if (!result.ok) return fromCredentialFailure(result.error, "MFA_CODE_INVALID", "code");

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
