/**
 * Tipos del esquema de entorno.
 *
 * DEC-018 exige un esquema de entorno validado en el arranque: si falta una
 * variable o es invalida, el proceso NO arranca. Un servicio que arranca a
 * medias con la configuracion incompleta acaba tomando decisiones sobre
 * entries con valores por defecto que nadie eligio.
 *
 * Este paquete es la declaracion; el arranque de `apps/api` y `apps/web` la
 * consume. Se declara aqui, y no dentro de cada app, para que exista UNA sola
 * lista de variables y para que el gate de CI pueda contrastarla contra
 * `.env.example`.
 */

export const ENV_NAMES = ["development", "test", "staging", "production"] as const;
export type EnvName = (typeof ENV_NAMES)[number];

export const ALL_ENVIRONMENTS: readonly EnvName[] = ENV_NAMES;
export const DEPLOYED_ENVIRONMENTS: readonly EnvName[] = ["staging", "production"];
export const NO_ENVIRONMENT: readonly EnvName[] = [];

export type EnvVarKind =
  "string" | "integer" | "boolean" | "url" | "postgres_url" | "enum" | "cron" | "path" | "email";

/** Que proceso la lee. `web` implica navegador si el nombre es `NEXT_PUBLIC_`. */
export type EnvVarScope = "shared" | "api" | "web" | "test";

export interface EnvVarSpec {
  readonly name: string;
  readonly scope: EnvVarScope;
  readonly kind: EnvVarKind;
  /**
   * Es un secreto. Un secreto nunca se registra en logs, nunca se serializa en
   * una respuesta y nunca aparece en `.env.example` con su valor real.
   */
  readonly secret: boolean;
  /** Entornos en los que la variable es obligatoria. */
  readonly requiredIn: readonly EnvName[];
  readonly allowedValues: readonly string[] | null;
  readonly notes: string;
}

export type ProductionRequirement =
  "MUST_EQUAL" | "MUST_NOT_EQUAL" | "MUST_NOT_CONTAIN" | "MUST_START_WITH";

/**
 * Condicion que activa una regla de endurecimiento (DEC-043).
 *
 * Existe porque hay endurecimientos cuyo valor correcto depende de otra
 * variable, y colapsarlos en una sola regla incondicional obligaria a elegir
 * entre dos mentiras: exigir un valor imposible en cierta topologia, o no
 * exigir ninguno. La conexion a PostgreSQL es el caso: sobre red publica el
 * unico modo aceptable es `verify-full`, y sobre la red privada de un
 * proveedor con certificados autofirmados lo es `disable`.
 */
export interface HardeningCondition {
  /** Variable de la que depende la regla. */
  readonly name: string;
  /** Valor que activa la regla. */
  readonly equals: string;
  /**
   * Si la regla se aplica tambien cuando la variable condicionante NO esta
   * definida. Debe valer `true` exactamente en la rama que sea el valor por
   * defecto del esquema de arranque; si ninguna rama lo declara, omitir la
   * variable desactivaria el endurecimiento entero sin que nadie lo note.
   */
  readonly whenAbsent: boolean;
}

/**
 * Endurecimiento obligatorio en entornos desplegados. Son las diferencias entre
 * "funciona en mi maquina" y "se puede poner delante de participantes reales".
 */
export interface ProductionHardeningRule {
  readonly name: string;
  readonly requirement: ProductionRequirement;
  readonly value: string;
  readonly appliesTo: readonly EnvName[];
  readonly rationale: string;
  /** Sin condicion, la regla se aplica siempre en `appliesTo`. */
  readonly appliesWhen?: HardeningCondition;
}

export interface EnvIssue {
  readonly name: string;
  readonly code:
    | "MISSING"
    | "EMPTY"
    | "INVALID_INTEGER"
    | "INVALID_BOOLEAN"
    | "INVALID_URL"
    | "INVALID_POSTGRES_URL"
    | "INVALID_ENUM"
    | "INVALID_EMAIL"
    | "UNDECLARED"
    | "SECRET_EXPOSED_TO_BROWSER"
    | "PRODUCTION_HARDENING";
  readonly message: string;
}

export interface EnvValidationResult {
  readonly environment: EnvName;
  readonly ok: boolean;
  readonly issues: readonly EnvIssue[];
}
