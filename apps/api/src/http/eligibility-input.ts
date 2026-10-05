/**
 * Validacion de la declaracion de elegibilidad y de los consentimientos
 * (DEC-067). La comparten el alta (`POST /auth/register`) y la declaracion de
 * una cuenta anterior (`PUT /me/eligibility`).
 */

import { z } from "zod";

import { missingConsents, REQUIRED_CONSENTS } from "../config/consents.js";
import { US_RESIDENCE_CODES } from "../services/eligibility.js";
import type { ConsentAcceptanceInput } from "../services/identity-ports.js";

import { ApiErrors } from "./errors.js";

export const consentsInputSchema = z
  .array(z.object({ key: z.string().min(1).max(100), version: z.string().min(1).max(100) }))
  .max(20);

export const dateOfBirthSchema = z.iso.date();

export const residenceStateSchema = z.enum(US_RESIDENCE_CODES);

/**
 * Comprueba lo que el esquema no puede: que la fecha no sea futura -ni anterior
 * a la que admite la CHECK de 0034- y que lleguen TODOS los consentimientos con
 * la version vigente. Devuelve los que se guardan: los de `REQUIRED_CONSENTS`,
 * nunca una clave que haya inventado el cliente.
 */
export function assertDeclaration(
  body: {
    readonly date_of_birth: string;
    readonly consents: readonly { readonly key: string; readonly version: string }[];
  },
  now: Date,
): ConsentAcceptanceInput[] {
  const today = now.toISOString().slice(0, 10);
  if (body.date_of_birth > today || body.date_of_birth <= "1900-01-01") {
    throw ApiErrors.validationFailed([{ path: "date_of_birth", code: "out_of_range" }]);
  }

  const missing = missingConsents(body.consents);
  if (missing.length > 0) throw ApiErrors.consentRequired(missing);

  return REQUIRED_CONSENTS.map((consent) => ({ key: consent.key, version: consent.version }));
}
