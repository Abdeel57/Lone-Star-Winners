"use server";

import { revalidatePath } from "next/cache";

import { localeTag } from "@/i18n/locales";
import { setMyMarketingConsent } from "@/lib/api";

import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "./action-result";
import { localeFrom, textFrom } from "./form-input";
import { mutableSession } from "./session-server";

/**
 * DEC-098: dar o retirar el permiso de correo promocional desde el perfil.
 *
 * `granted=false` lo retira y no necesita nada mas: retirar funciona siempre.
 * `granted=true` manda la version del texto que la tarjeta pinto
 * (`text_version`) y el idioma de la pagina, que es en el que se leyo. Si el
 * texto cambio entre medias, la API responde 409 y la tarjeta se recarga con
 * el vigente.
 */
export async function setMarketingConsentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const granted = textFrom(formData, "granted");
  if (granted !== "true" && granted !== "false") return invalid("VALIDATION_FAILED");

  const session = await mutableSession();

  if (granted === "false") {
    const result = await setMyMarketingConsent({ granted: false }, locale, session);
    if (!result.ok) return fromFailure(result.error, null);
    revalidatePath("/", "layout");
    return SUCCEEDED;
  }

  const textVersion = textFrom(formData, "text_version");
  if (textVersion === null) return invalid("VALIDATION_FAILED");

  const result = await setMyMarketingConsent(
    { granted: true, text_version: textVersion, locale: localeTag(locale) },
    locale,
    session,
  );
  if (!result.ok) {
    // Texto desactualizado: la pagina se vuelve a pintar con el vigente.
    if (result.error.kind === "http" && result.error.code === "MARKETING_CONSENT_TEXT_OUTDATED") {
      revalidatePath("/", "layout");
    }
    return fromFailure(result.error, null);
  }

  revalidatePath("/", "layout");
  return SUCCEEDED;
}
