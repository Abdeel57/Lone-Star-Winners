"use server";

import { revalidatePath } from "next/cache";

import { LOCALE_TAGS } from "@/i18n/locales";
import { startMyPhoneVerification, updateMe, verifyMyPhone } from "@/lib/api";

import { fromFailure, SUCCEEDED, invalid, type ActionResult } from "./action-result";
import { botCheckTokenFrom, localeFrom, textFrom } from "./form-input";
import { mutableSession } from "./session-server";

/**
 * Acciones del perfil del participante.
 *
 * Solo lo que alguien puede cambiar de si mismo. El correo NO esta aqui:
 * cambiarlo es un flujo con verificacion propia y pertenece al diseno de
 * identidad (DEC-006), no a un `PATCH` de perfil. Tampoco esta el idioma
 * legalmente controlante de nada: `language_preference` decide en que idioma se
 * atiende a una persona, no que version de un documento gobierna.
 */

/**
 * Etiqueta de idioma, validada contra las que la interfaz soporta.
 *
 * Se comprueba contra `LOCALE_TAGS` y no se acepta cualquier cadena: guardar
 * una preferencia de idioma que la interfaz no sabe servir deja a alguien con
 * una cuenta que pide un idioma inexistente, y el fallo aparece mucho despues y
 * muy lejos de aqui. El backend revalida igualmente.
 */
function languageTagFrom(formData: FormData): string | null {
  const raw = formData.get("language_preference");
  if (typeof raw !== "string") return null;

  return (LOCALE_TAGS as readonly string[]).includes(raw) ? raw : null;
}

/** Actualiza el perfil. */
export async function updateProfileAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const language = languageTagFrom(formData);
  if (language === null) return invalid("VALIDATION_FAILED", "language_preference");

  const session = await mutableSession();
  const result = await updateMe(
    {
      // Un nombre vacio se manda como `null` y no como cadena vacia: son dos
      // cosas distintas -"no tengo nombre para mostrar" y "mi nombre es la
      // cadena vacia"- y solo una de ellas tiene sentido.
      display_name: textFrom(formData, "display_name"),
      language_preference: language,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  // La cabecera y el menu de cuenta pintan el nombre: viven en el layout y hay
  // que invalidarlo o el cambio no se veria hasta la siguiente navegacion dura.
  revalidatePath("/", "layout");

  return SUCCEEDED;
}

/**
 * DEC-097, paso 1: pedir el codigo por SMS para anadir el celular de acceso.
 *
 * Para quien se dio de alta con correo antes de DEC-089. El numero no se
 * guarda aqui: solo se envia el codigo. Lleva el token anti-bots porque cada
 * SMS se paga.
 */
export async function startAddPhoneAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const phone = textFrom(formData, "phone");
  if (phone === null) return invalid("FIELD_REQUIRED", "phone");

  const token = botCheckTokenFrom(formData);
  const session = await mutableSession();
  const result = await startMyPhoneVerification(
    { phone, ...(token === undefined ? {} : { bot_check_token: token }) },
    locale,
    session,
  );

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    return fromFailure(result.error, code === "PHONE_INVALID" ? "phone" : null);
  }

  return SUCCEEDED;
}

/**
 * DEC-097, paso 2: el codigo. Con el correcto, el numero queda como celular de
 * acceso de la cuenta y desde entonces se entra con el a ESTA cuenta.
 */
export async function verifyAddPhoneAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const phone = textFrom(formData, "phone");
  if (phone === null) return invalid("FIELD_REQUIRED", "phone");

  const typed = textFrom(formData, "code");
  if (typed === null) return invalid("FIELD_REQUIRED", "code");

  const session = await mutableSession();
  const result = await verifyMyPhone({ phone, code: typed.replace(/\s+/g, "") }, locale, session);

  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    return fromFailure(result.error, code === "SIGN_IN_CODE_INVALID" ? "code" : null);
  }

  // El perfil y la cabecera leen el celular de la sesion: se refrescan.
  revalidatePath("/", "layout");
  return SUCCEEDED;
}
