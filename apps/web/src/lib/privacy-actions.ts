"use server";

import { localeTag } from "@/i18n/locales";
import { isPrivacyRequestType } from "@/legal/privacy-request-types";
import { submitPrivacyRequest } from "@/lib/api";

import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "./action-result";
import { botCheckTokenFrom, checkboxFrom, localeFrom, textFrom } from "./form-input";

/**
 * Solicitud de privacidad de `/privacychoices` (DEC-063).
 *
 * Sin sesion a proposito: la Politica de Privacidad ofrece el formulario a
 * cualquiera, tenga cuenta o no. Al salir bien, `detail` lleva la REFERENCIA
 * que devolvio la API: es un dato del backend, no copy, y la pantalla la
 * ensena para que la persona pueda citarla.
 */
export async function submitPrivacyRequestAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const requestType = textFrom(formData, "request_type");
  if (!isPrivacyRequestType(requestType)) return invalid("FIELD_REQUIRED", "request_type");

  const fullName = textFrom(formData, "full_name");
  if (fullName === null) return invalid("FIELD_REQUIRED", "full_name");

  const email = textFrom(formData, "email");
  if (email === null) return invalid("FIELD_REQUIRED", "email");

  const state = textFrom(formData, "state");
  if (state === null) return invalid("FIELD_REQUIRED", "state");

  const token = botCheckTokenFrom(formData);

  const result = await submitPrivacyRequest(
    {
      request_type: requestType,
      full_name: fullName,
      email,
      phone: textFrom(formData, "phone"),
      state,
      details: textFrom(formData, "details"),
      authorized_agent: checkboxFrom(formData, "authorized_agent"),
      language: localeTag(locale),
      ...(token === undefined ? {} : { bot_check_token: token }),
    },
    locale,
  );

  if (!result.ok) return fromFailure(result.error);

  return { ...SUCCEEDED, detail: result.data.reference };
}
