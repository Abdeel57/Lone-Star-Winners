/**
 * Requisito de verificacion de email antes de acumular participaciones.
 *
 * ---------------------------------------------------------------------------
 * ESTE `false` ES PROVISIONAL. NO ES UNA DECISION TOMADA.
 * ---------------------------------------------------------------------------
 *
 * `docs/LEGAL_PENDING.md` -> "Email verification before earning entries" sigue
 * en **TBD**. La pregunta abierta es si las Official Rules exigen que un
 * participante verifique su email antes de poder acumular entries; la responde
 * el abogado del cliente, no este repositorio (principio 2).
 *
 * Mientras siga sin respuesta, la clave `eligibility.email_verification_required`
 * puede no estar en `PromotionRulesVersion.config`, y hace falta un
 * comportamiento definido. Se elige `false` -no exigir- por una razon acotada:
 * con `true` por defecto, una promocion cuya configuracion todavia no menciona
 * la clave dejaria de generar participaciones de compra sin que nadie lo haya
 * decidido, que es un fallo silencioso mucho peor que el contrario.
 *
 * QUE PASA CUANDO EL ABOGADO CONTESTE
 *
 *   La respuesta entra como CONFIGURACION en la version de reglas, no como un
 *   cambio de este archivo. Y como `eligibility` es una clave REQUERIDA de
 *   DEC-012, ninguna promocion puede activarse sin ella, asi que en una
 *   promocion ACTIVA el camino `PROVISIONAL_DEFAULT` solo se recorre si el
 *   abogado ha omitido la subclave a proposito.
 *
 * POR QUE LA RESOLUCION DEVUELVE TAMBIEN EL ORIGEN
 *
 *   Porque "no se exigio verificacion" y "nadie dijo si habia que exigirla" son
 *   dos hechos distintos, y el segundo hay que poder contarlo. `source` viaja a
 *   la metadata del movimiento de ledger, de modo que un auditor puede separar
 *   las participaciones otorgadas bajo una regla explicita de las otorgadas
 *   bajo el default provisional, sin tener que adivinarlo por la fecha.
 */

import { z } from "zod";

/**
 * PROVISIONAL (`docs/LEGAL_PENDING.md` -> "Email verification before earning
 * entries"). No tomar por decidido. Ver la cabecera de este archivo.
 */
export const EMAIL_VERIFICATION_REQUIRED_PROVISIONAL_DEFAULT = false;

export type EmailVerificationRequirementSource = "RULES_CONFIG" | "PROVISIONAL_DEFAULT";

export interface EmailVerificationRequirement {
  readonly required: boolean;
  readonly source: EmailVerificationRequirementSource;
}

/**
 * `.optional()` en las dos capas y sin `.strict()`: la configuracion legal
 * contiene muchisimas mas claves que no son asunto de este modulo, y
 * rechazarlas obligaria a este archivo a conocer la configuracion entera.
 */
const eligibilitySliceSchema = z.object({
  eligibility: z
    .object({
      email_verification_required: z.boolean().optional(),
    })
    .optional(),
});

export function resolveEmailVerificationRequirement(
  rawConfig: unknown,
): EmailVerificationRequirement {
  const parsed = eligibilitySliceSchema.safeParse(rawConfig);
  const declared = parsed.success
    ? parsed.data.eligibility?.email_verification_required
    : undefined;

  if (declared === undefined) {
    return {
      required: EMAIL_VERIFICATION_REQUIRED_PROVISIONAL_DEFAULT,
      source: "PROVISIONAL_DEFAULT",
    };
  }
  return { required: declared, source: "RULES_CONFIG" };
}
