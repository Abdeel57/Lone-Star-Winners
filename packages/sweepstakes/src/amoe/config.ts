/**
 * Configuracion AMOE (Alternative Method of Entry).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE SUBSISTEMA EXISTE ENTERO CON EL FLAG APAGADO
 * ---------------------------------------------------------------------------
 *
 * El principio 8 exige que la capacidad AMOE EXISTA aunque este desactivada, y
 * `docs/LEGAL_PENDING.md` -> "AMOE mechanism" sigue en `TBD`: nadie sabe aun
 * cual de las cuatro modalidades aprobara el abogado.
 *
 * Construirlo despues seria peor que construirlo ahora, y no por comodidad: las
 * participaciones AMOE entran en el MISMO ledger append-only que las de compra
 * (principio 9). Anadir despues una segunda via de escritura sobre una tabla
 * que ya tiene datos reales es exactamente lo que DEC-007 encarece a proposito.
 *
 * ---------------------------------------------------------------------------
 * AQUI NO SE ELIGE NINGUNA MODALIDAD
 * ---------------------------------------------------------------------------
 *
 * Las cuatro se soportan por igual, y ninguna es el default. `amoe_mode` no
 * tiene valor `DISABLED` (DEC-032): la pregunta "existe via AMOE" la responde
 * el flag `amoe_enabled` y solo el. Con un `DISABLED` dentro del enum habria
 * dos sitios contestando lo mismo, y el dia que discrepasen no habria respuesta
 * correcta.
 *
 * ---------------------------------------------------------------------------
 * NINGUN VALOR POR DEFECTO
 * ---------------------------------------------------------------------------
 *
 * Cuantas participaciones da un envio aprobado, cuantos envios admite una
 * persona y en que ventana son decisiones legales. Si la clave falta, el
 * subsistema se niega a operar en vez de suponer (principio 2). `.default(1)`
 * en `entries_per_approved_submission` seria un requisito legal inventado por
 * un ingeniero, y ademas uno que decide cuanto vale la via gratuita frente a la
 * de compra.
 */

import { z } from "zod";

import { AMOE_MODES } from "../enums.js";

/** Instante ISO-8601 con zona explicita (DEC-011). */
const instantSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: "must_be_iso8601_instant" })
  .refine((value) => /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value), {
    error: "must_declare_timezone_offset",
  });

/**
 * Periodo sobre el que se cuenta el limite por participante.
 *
 * Los tres primeros se calculan EN LA ZONA LEGAL de la promocion (DEC-011), no
 * en UTC ni en la del navegador: "un envio al dia" significa un dia natural
 * donde lo digan las Official Rules, y en Texas eso son seis o siete horas de
 * diferencia con UTC segun la epoca del ano. Contar en UTC abriria o cerraria
 * la ventana en el momento equivocado todos los dias.
 */
export const AMOE_LIMIT_PERIODS = ["DAY", "WEEK", "MONTH", "PROMOTION"] as const;
export type AmoeLimitPeriod = (typeof AMOE_LIMIT_PERIODS)[number];

/**
 * Que hacer ante un envio cuya huella ya existe.
 *
 * `REJECT` lo rechaza en el acto. `FLAG_FOR_REVIEW` lo acepta pero lo manda a
 * la cola marcado, para que decida una persona. Las dos son legitimas y la
 * eleccion cambia lo que le pasa a un participante, asi que la decide la
 * configuracion y no el codigo.
 */
export const AMOE_DUPLICATE_POLICIES = ["REJECT", "FLAG_FOR_REVIEW"] as const;
export type AmoeDuplicatePolicy = (typeof AMOE_DUPLICATE_POLICIES)[number];

export const amoeLimitSchema = z
  .object({
    /** `null` = sin limite declarado. Nunca "sin limite decidido" (DEC-012). */
    max_per_participant_per_period: z.number().int().min(1).nullable(),
    period: z.enum(AMOE_LIMIT_PERIODS),
  })
  .readonly();

export type AmoeLimitConfig = z.infer<typeof amoeLimitSchema>;

export const amoeConfigSchema = z
  .object({
    mode: z.enum(AMOE_MODES),
    submission_window: z
      .object({ starts_at: instantSchema, ends_at: instantSchema })
      .refine((window) => Date.parse(window.ends_at) > Date.parse(window.starts_at), {
        error: "window_must_end_after_it_starts",
      })
      .readonly(),
    entries_per_approved_submission: z.number().int().min(1),
    /**
     * Si un envio necesita que lo mire una persona antes de generar
     * participaciones.
     *
     * `MAIL_IN_REVIEW` exige revision por su propia naturaleza -alguien tiene
     * que leer un sobre-, y el `superRefine` de abajo lo impone. En las otras
     * tres es una decision legal.
     */
    requires_review: z.boolean(),
    limit: amoeLimitSchema,
    duplicate_policy: z.enum(AMOE_DUPLICATE_POLICIES),
    /**
     * Claves de los datos que el envio debe aportar. Son CLAVES, no copy: el
     * texto en ingles y en espanol lo resuelve el frontend (DEC-022).
     */
    identity_requirements: z.array(z.string().min(1)).readonly(),
  })
  .superRefine((config, ctx) => {
    if (config.mode === "MAIL_IN_REVIEW" && !config.requires_review) {
      ctx.addIssue({ code: "custom", error: "mail_in_mode_requires_review" });
    }
  })
  .readonly();

export type AmoeConfig = z.infer<typeof amoeConfigSchema>;

const amoeSliceSchema = z.object({ amoe: z.unknown().optional() });

export class AmoeConfigError extends Error {
  public readonly code = "AMOE_CONFIG_INVALID";
  public readonly issues: readonly unknown[];

  public constructor(issues: readonly unknown[]) {
    super("AMOE_CONFIG_INVALID");
    this.name = "AmoeConfigError";
    this.issues = issues;
  }
}

/**
 * Extrae la configuracion AMOE de `PromotionRulesVersion.config`.
 *
 * Devuelve `null` cuando la clave no esta: `amoe` es una clave OPCIONAL de
 * DEC-012, asi que su ausencia no bloquea la activacion de la promocion. Lo que
 * si bloquea es intentar operar la via AMOE sin ella, y de eso se encarga el
 * servicio.
 */
export function readAmoeConfig(rawConfig: unknown): AmoeConfig | null {
  const slice = amoeSliceSchema.safeParse(rawConfig);
  const raw = slice.success ? slice.data.amoe : undefined;
  if (raw === undefined || raw === null) {
    return null;
  }
  const parsed = amoeConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AmoeConfigError(parsed.error.issues);
  }
  return parsed.data;
}
