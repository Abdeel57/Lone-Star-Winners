"use server";

import { revalidatePath } from "next/cache";

import { localeTag } from "@/i18n/locales";
import { declareMyEligibility } from "@/lib/api";

import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "./action-result";
import { consentsFrom, localeFrom, textFrom } from "./form-input";
import { mutableSession } from "./session-server";

/**
 * Declaracion de elegibilidad en el checkout.
 *
 * La pide el checkout ANTES de cobrar cuando la promocion comprueba edad o
 * estado: sin ella el backend no puede saber si la compra da participaciones y
 * no las otorga. Se envia una vez; el backend no deja reescribirla.
 *
 * DEC-089: dos formas. Una cuenta anterior a DEC-067 declara todo -fecha,
 * estado y documentos-; una cuenta sin contrasena ya declaro el estado y acepto
 * los documentos en el alta, y solo le falta la fecha (`scope=date_of_birth`).
 * El campo oculto lo pone la pagina, pero no se confia en el: el backend
 * rechaza una fecha sin estado y exige los documentos al declarar el estado.
 */
export async function declareEligibilityAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const dateOfBirth = textFrom(formData, "date_of_birth");
  if (dateOfBirth === null) return invalid("FIELD_REQUIRED", "date_of_birth");

  const onlyDateOfBirth = textFrom(formData, "scope") === "date_of_birth";

  const residenceState = onlyDateOfBirth ? null : textFrom(formData, "residence_state");
  if (!onlyDateOfBirth && residenceState === null) {
    return invalid("FIELD_REQUIRED", "residence_state");
  }

  const consents = consentsFrom(formData);
  if (!onlyDateOfBirth && consents.missing) return invalid("CONSENT_REQUIRED", "consent");

  const session = await mutableSession();
  const result = await declareMyEligibility(
    {
      date_of_birth: dateOfBirth,
      language: localeTag(locale),
      ...(residenceState === null
        ? {}
        : { residence_state: residenceState, consents: consents.accepted }),
    },
    locale,
    session,
  );

  // Ya declarada (otra pestana, otro dispositivo): no es un fallo para quien
  // esta pagando. Se recarga y el checkout sigue.
  if (!result.ok) {
    const code = result.error.kind === "http" ? result.error.code : null;
    if (code !== "ELIGIBILITY_ALREADY_DECLARED") {
      return fromFailure(result.error, code === "CONSENT_REQUIRED" ? "consent" : null);
    }
  }

  revalidatePath("/[locale]/checkout", "page");
  return SUCCEEDED;
}
