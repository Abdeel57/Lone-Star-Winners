/**
 * Caducidad de participaciones (DEC-033).
 *
 * EL FLAG Y LA CONFIGURACION RESPONDEN A DOS PREGUNTAS DISTINTAS
 *
 *   `entry_expiration_enabled` (DEC-032, apagado por defecto) responde a
 *   "existe caducidad en este sistema".
 *
 *   `entry_expiration` en `PromotionRulesVersion.config` responde a "cuanto
 *   dura una participacion en ESTA promocion". Es una clave REQUERIDA de
 *   DEC-012 y sigue en `TBD`.
 *
 *   Con el flag apagado, `expires_at` es SIEMPRE `null` -y un trigger de base
 *   de datos lo impone-, que es lo que convierte el predicado del saldo en una
 *   suma pura.
 *
 * SI EL FLAG SE ENCIENDE Y LA CONFIGURACION NO DICE NADA, ESTO FALLA
 *
 *   Y es lo correcto. Inventar "caducan en 365 dias porque suena razonable"
 *   seria fabricar un requisito legal (principio 2) que ademas afecta a cuantas
 *   participaciones tiene cada persona en el sorteo. Se prefiere que la
 *   promocion no pueda otorgar a que otorgue bajo una regla que nadie aprobo.
 *
 * NO HAY MOVIMIENTO `EXPIRATION`, Y NO ES UN OLVIDO
 *
 *   DEC-033 modela la caducidad como una PROPIEDAD de la transaccion, evaluada
 *   por el predicado del saldo. Un movimiento compensatorio haria que el saldo
 *   dependiera de que un job hubiera corrido a tiempo; con un predicado, el
 *   saldo es correcto aunque no haya corrido nada. Es tambien lo que mantiene
 *   reproducible el `ExportSnapshot` de DEC-016.
 */

import { z } from "zod";

import { SweepstakesError } from "../errors.js";

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Formas admitidas de la clave `entry_expiration`.
 *
 * `NONE` existe y es distinta de "clave ausente": significa que el abogado ha
 * dicho expresamente que no hay caducidad. La ausencia significa que nadie lo
 * ha dicho todavia, y eso no es lo mismo.
 */
export const entryExpirationConfigSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }),
    z.object({
      mode: z.literal("FIXED_DURATION_FROM_EFFECTIVE"),
      /** Dias enteros. DEC-010: nunca fraccional. */
      duration_days: z.number().int().min(1),
    }),
    z.object({
      mode: z.literal("FIXED_INSTANT"),
      /** Instante ISO-8601 con zona explicita (DEC-011). */
      expires_at: z
        .string()
        .refine((value) => !Number.isNaN(Date.parse(value)), {
          error: "must_be_iso8601_instant",
        })
        .refine((value) => /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value), {
          error: "must_declare_timezone_offset",
        }),
    }),
  ])
  .readonly();

export type EntryExpirationConfig = z.infer<typeof entryExpirationConfigSchema>;

const expirationSliceSchema = z.object({ entry_expiration: z.unknown().optional() });

/**
 * Calcula la caducidad de un movimiento de ORIGEN.
 *
 * Un reversal NO pasa por aqui: hereda la caducidad de la transaccion que
 * revierte (DEC-034), y ese valor lo lee el servicio de reversal del ancla.
 */
export function resolveExpiresAt(
  rawConfig: unknown,
  effectiveAt: Date,
  expirationEnabled: boolean,
): Date | null {
  if (!expirationEnabled) {
    return null;
  }

  const slice = expirationSliceSchema.safeParse(rawConfig);
  const raw = slice.success ? slice.data.entry_expiration : undefined;

  if (raw === undefined || raw === null) {
    throw new SweepstakesError(
      "ENTRY_EXPIRATION_CONFIG_MISSING",
      { key: "entry_expiration" },
      "DEC-033: el flag entry_expiration_enabled esta encendido pero la version de reglas no " +
        "declara entry_expiration. Ver docs/LEGAL_PENDING.md -> Entry expiration.",
    );
  }

  const parsed = entryExpirationConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SweepstakesError(
      "ENTRY_EXPIRATION_CONFIG_MISSING",
      { key: "entry_expiration", reason: "invalid_shape" },
      "DEC-033: entry_expiration no tiene una forma reconocida.",
    );
  }

  const config = parsed.data;
  switch (config.mode) {
    case "NONE":
      return null;
    case "FIXED_DURATION_FROM_EFFECTIVE":
      return new Date(effectiveAt.getTime() + config.duration_days * MILLISECONDS_PER_DAY);
    case "FIXED_INSTANT":
      return new Date(Date.parse(config.expires_at));
    default: {
      const exhaustive: never = config;
      throw new RangeError(`Modo de caducidad desconocido: ${JSON.stringify(exhaustive)}`);
    }
  }
}
