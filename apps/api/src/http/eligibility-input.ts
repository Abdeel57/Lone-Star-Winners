/**
 * Validacion de la declaracion de elegibilidad y de los consentimientos
 * (DEC-067). La comparten las altas (`POST /auth/register` y, sin contrasena,
 * `POST /auth/code/register`, DEC-089) y la declaracion de `PUT /me/eligibility`.
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

type ConsentsInput = readonly { readonly key: string; readonly version: string }[];

/**
 * Lo que el esquema no puede comprobar de la fecha: que no sea futura ni
 * anterior a la que admite la CHECK de 0034.
 */
export function assertDateOfBirth(dateOfBirth: string, now: Date): void {
  const today = now.toISOString().slice(0, 10);
  if (dateOfBirth > today || dateOfBirth <= "1900-01-01") {
    throw ApiErrors.validationFailed([{ path: "date_of_birth", code: "out_of_range" }]);
  }
}

/**
 * Que lleguen TODOS los consentimientos con la version vigente. Devuelve los que
 * se guardan: los de `REQUIRED_CONSENTS`, nunca una clave que haya inventado el
 * cliente.
 */
export function assertConsents(consents: ConsentsInput): ConsentAcceptanceInput[] {
  const missing = missingConsents(consents);
  if (missing.length > 0) throw ApiErrors.consentRequired(missing);

  return REQUIRED_CONSENTS.map((consent) => ({ key: consent.key, version: consent.version }));
}

/** La fecha y los consentimientos del alta con contrasena (DEC-067). */
export function assertDeclaration(
  body: { readonly date_of_birth: string; readonly consents: ConsentsInput },
  now: Date,
): ConsentAcceptanceInput[] {
  assertDateOfBirth(body.date_of_birth, now);
  return assertConsents(body.consents);
}
