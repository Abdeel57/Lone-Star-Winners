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

import { AMOE_MODES, type LocaleCode } from "../enums.js";

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

/**
 * Que CONTROL pinta el formulario para un campo.
 *
 * Gobierna presentacion, y nada mas: que teclado abre un telefono, si el
 * navegador ofrece un calendario. NO gobierna ninguna validacion legal -no hay
 * aqui formatos de codigo postal, ni edades minimas, ni longitudes obligadas-.
 * El dominio revalida el payload contra `identity_requirements` y es quien
 * decide; un envio con el control "equivocado" se acepta o se rechaza por lo
 * que dice el dominio, jamas por lo que pintara el navegador.
 */
export const AMOE_FIELD_TYPES = ["TEXT", "EMAIL", "TEL", "TEXTAREA", "DATE", "CODE"] as const;
export type AmoeFieldType = (typeof AMOE_FIELD_TYPES)[number];

/**
 * Tope de caracteres de un valor del payload.
 *
 * Es el limite del TRANSPORTE -el mismo que declara el cuerpo de
 * `POST /amoe-submissions`- y por eso se puede publicar sin inventar nada: lo
 * que lo supere lo rechaza la API, asi que decirlo por adelantado es describir
 * el sistema, no imponer una regla nueva.
 */
export const AMOE_FIELD_MAX_LENGTH = 500;

export const amoeFieldDescriptorSchema = z
  .object({
    type: z.enum(AMOE_FIELD_TYPES).optional(),
    /** Puntero al copy del frontend (DEC-022). Nunca prosa. */
    label_key: z.string().min(1).max(120).optional(),
    max_length: z.number().int().min(1).max(AMOE_FIELD_MAX_LENGTH).optional(),
  })
  .readonly();

/**
 * Instrucciones en los dos locales de DEC-021. Ninguno es traduccion secundaria
 * del otro, asi que los dos son OBLIGATORIOS cuando la clave esta presente.
 *
 * El tipo se declara sobre `LocaleCode` y el esquema enumera las claves: si
 * algun dia se anadiera un locale de primera clase, el esquema dejaria de
 * satisfacer al tipo y el paquete no compilaria. Es la unica forma de que
 * "ambos idiomas" no se convierta en "los dos que habia cuando se escribio".
 */
export type AmoeInstructions = Readonly<Record<LocaleCode, string>>;

const localizedInstructionsSchema = z
  .object({
    "en-US": z.string().min(1).max(8000),
    "es-US": z.string().min(1).max(8000),
  })
  .readonly() satisfies z.ZodType<AmoeInstructions>;

const externalUrlSchema = z.string().min(1).max(2000).refine(isHttpsUrl, {
  error: "must_be_https_url",
});

/**
 * Solo `https:`.
 *
 * No se comprueba con una expresion regular: `new URL` es quien decide que es
 * un esquema, y una regexp que intentara distinguir `https:` de
 * `java\nscript:` acabaria dejando pasar el segundo. Un destino con otro
 * esquema renderizado como `href` es ejecucion de codigo de terceros en la
 * pagina de la via gratuita.
 */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

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
    /**
     * Descriptores de PRESENTACION de los campos, por clave del payload.
     *
     * OPCIONAL, y lo que declara NO es legal: que control pinta el navegador y
     * a que etiqueta de copy apunta el campo. Que datos se piden -eso si es
     * legal- lo sigue diciendo `identity_requirements` y solo el; un descriptor
     * de una clave que no este ahi no anade ningun campo al formulario.
     *
     * Existe porque sin el, la unica forma de que la interfaz supiera pintar un
     * campo de correo como correo seria adivinarlo del nombre de la clave, y
     * adivinar el nombre de una clave que escribe el abogado es exactamente la
     * clase de suposicion que este paquete no hace.
     */
    identity_fields: z.record(z.string().min(1), amoeFieldDescriptorSchema).nullish(),
    /**
     * Instrucciones de la via gratuita, EN LOS DOS IDIOMAS.
     *
     * ES TEXTO LEGALMENTE CONTROLANTE y por eso vive en la version de reglas y
     * no en el copy del frontend: la direccion postal, el formato del sobre y
     * los plazos de `MAIL_IN_REVIEW` los redacta el abogado del cliente. Es la
     * excepcion consciente a DEC-022 -aqui el backend SI publica prosa- y la
     * razon de que se exijan los dos locales (DEC-021): unas instrucciones
     * publicadas en un solo idioma son una via gratuita que no existe para la
     * mitad de los participantes.
     *
     * Ausente = `null`. El sistema NO la redacta ni la traduce.
     */
    instructions: localizedInstructionsSchema.nullish(),
    /**
     * Destino de `EXTERNAL_INSTRUCTIONS`. Solo `https:`, y se comprueba aqui.
     *
     * Validarlo en el momento de leer la configuracion -y no al pintarlo-
     * significa que un `javascript:` en la configuracion de una promocion
     * rompe la promocion en vez de llegar a un navegador. El frontend vuelve a
     * comprobarlo, y esa duplicidad es deliberada: ninguna de las dos capas es
     * la unica que lo mira.
     */
    external_url: externalUrlSchema.nullish(),
  })
  .superRefine((config, ctx) => {
    if (config.mode === "MAIL_IN_REVIEW" && !config.requires_review) {
      ctx.addIssue({ code: "custom", error: "mail_in_mode_requires_review" });
    }
  })
  .readonly();

export type AmoeConfig = z.infer<typeof amoeConfigSchema>;

/**
 * Un campo del formulario, ya resuelto: lo que la configuracion declara mas los
 * valores por defecto de los descriptores que no declara.
 *
 * `key` es la clave del `payload` -la que exige `identity_requirements`- y
 * `labelKey` es un puntero al copy del frontend (DEC-022). Son dos cosas
 * distintas a proposito: la primera la decide el abogado y viaja en el envio;
 * la segunda solo decide que palabra se lee encima del campo.
 */
export interface AmoeRequiredField {
  readonly key: string;
  readonly type: AmoeFieldType;
  /**
   * Hoy SIEMPRE `true`: la lista sale de `identity_requirements`, y el dominio
   * rechaza el envio al que le falte cualquiera de ellas
   * (`AMOE_PAYLOAD_INVALID`). Viaja explicito de todos modos para que la
   * interfaz no tenga que deducir de un nombre de campo si puede dejarlo
   * vacio, y para que el dia que las Official Rules admitan un campo opcional
   * la forma de la respuesta no cambie.
   */
  readonly required: boolean;
  readonly labelKey: string;
  readonly maxLength: number;
}

/**
 * Resuelve los campos del formulario a partir de la configuracion.
 *
 * El ORDEN es el de `identity_requirements`, no el de `identity_fields`: el
 * orden en que se piden los datos es parte de como se presenta la via gratuita,
 * y lo fija la lista legal, no un mapa de descriptores cuyo orden de claves
 * nadie garantiza.
 *
 * Los descriptores se recorren a un `Map` antes de consultarlos, por el mismo
 * motivo que `assertPayloadComplete` en el servicio: con acceso indexado
 * directo, una clave `__proto__` leeria la cadena de prototipos en vez del dato.
 */
export function amoeRequiredFields(config: AmoeConfig): readonly AmoeRequiredField[] {
  const descriptors = new Map(Object.entries(config.identity_fields ?? {}));

  return config.identity_requirements.map((key) => {
    const descriptor = descriptors.get(key);
    return Object.freeze({
      key,
      // `TEXT` no es una suposicion sobre el dato: es exactamente lo que el
      // transporte acepta -una cadena- y lo que el dominio valida. Un descriptor
      // ausente no autoriza a estrechar el control.
      type: descriptor?.type ?? "TEXT",
      required: true,
      // Sin descriptor, la clave del payload ES la clave de copy. Si el
      // frontend no la conoce, pinta su etiqueta generica; inventarle aqui una
      // traduccion seria redactar interfaz desde el backend.
      labelKey: descriptor?.label_key ?? key,
      maxLength: descriptor?.max_length ?? AMOE_FIELD_MAX_LENGTH,
    });
  });
}

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
