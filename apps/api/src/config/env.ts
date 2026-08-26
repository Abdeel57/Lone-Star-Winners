/**
 * Configuracion tipada del proceso, validada al arrancar.
 *
 * DEC-018 exige un esquema de entorno validado en boot. La consecuencia
 * practica es que este modulo NO tiene valores por defecto para nada que
 * pueda ser inseguro: prefiere que el proceso no arranque a que arranque con
 * una configuracion que nadie eligio.
 *
 * Un fallo aqui es un fallo duro, y lo es a proposito. Un servidor que arranca
 * con `SESSION_COOKIE_SECURE=false` en produccion porque la variable faltaba
 * es peor que un servidor que no arranca: el primero parece que funciona.
 *
 * Lo que NO se lee de aqui, por decision expresa:
 *   - Feature flags legalmente materiales (DEC-013): viven en base de datos,
 *     apagados por defecto, con cambio auditado.
 *   - Constantes legales (DEC-012): viven en `PromotionRulesVersion`.
 *   - Cualquier interruptor de sorteo interno (DEC-017): no existe.
 */

import { z } from "zod";

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
const NODE_ENVS = ["development", "test", "production"] as const;
const SSL_MODES = ["disable", "require", "verify-ca", "verify-full"] as const;

/**
 * Marcadores que `.env.example` usa para dejar claro que un valor es falso.
 * Si uno de ellos llega a produccion, alguien copio la plantilla y no la
 * relleno. Es un fallo que merece detener el arranque.
 */
const PLACEHOLDER_MARKERS = ["FAKE", "CHANGE_ME", "REPLACE", "EJEMPLO", "EXAMPLE"];

function looksLikePlaceholder(value: string): boolean {
  const upper = value.toUpperCase();
  return PLACEHOLDER_MARKERS.some((marker) => upper.includes(marker));
}

const integerFromEnv = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/u, { error: "must_be_a_non_negative_integer" })
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= min && value <= max, {
      error: `must_be_between_${String(min)}_and_${String(max)}`,
    });

const booleanFromEnv = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => ["true", "false", "1", "0"].includes(value), {
    error: "must_be_true_or_false",
  })
  .transform((value) => value === "true" || value === "1");

const commaSeparatedUrls = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine((entries) => entries.length > 0, { error: "must_list_at_least_one_origin" });

export const environmentSchema = z
  .object({
    // ----- Runtime -----
    NODE_ENV: z.enum(NODE_ENVS),
    /**
     * DEC-011: el proceso corre en UTC. No es una preferencia: si el proceso
     * corriera en otra zona, `new Date()` y los formateos por defecto
     * introducirian un desfase silencioso, y la zona legal de la promocion
     * dejaria de ser la unica que decide.
     */
    TZ: z.literal("UTC", {
      error: "DEC-011: el proceso debe correr en UTC. La zona legal la declara cada promocion.",
    }),
    LOG_LEVEL: z.enum(LOG_LEVELS),

    // ----- HTTP -----
    API_HOST: z.string().min(1),
    API_PORT: integerFromEnv(1, 65_535),
    API_PUBLIC_URL: z.url(),
    API_BODY_LIMIT_BYTES: integerFromEnv(1_024, 33_554_432),
    API_CORS_ALLOWED_ORIGINS: commaSeparatedUrls,
    API_REQUEST_ID_HEADER: z
      .string()
      .min(1)
      .transform((value) => value.toLowerCase()),
    API_RATE_LIMIT_WINDOW_SECONDS: integerFromEnv(1, 3_600),
    API_RATE_LIMIT_MAX_REQUESTS: integerFromEnv(1, 1_000_000),

    // ----- PostgreSQL (DEC-003) -----
    DATABASE_URL_APP: z.string().startsWith("postgres"),
    DATABASE_SSL_MODE: z.enum(SSL_MODES),
    /**
     * DEC-043: por que camino de red viaja la conexion a PostgreSQL.
     *
     * `public`  - la conexion cruza Internet. Es el valor por defecto, y en
     *             produccion obliga a `verify-full`. No se puede relajar por
     *             descuido: hay que escribir `private` a proposito.
     *
     * `private` - la conexion NO sale de una red privada del proveedor
     *             (en Railway, `*.railway.internal`). Ese proveedor emite
     *             certificados autofirmados, asi que `verify-full` no puede
     *             satisfacerse: no existe una CA publica que los firme.
     *             Fingir TLS con `require` seria peor que no tenerlo, porque
     *             `require` sin verificacion no protege de un intermediario y
     *             ademas *parece* que si. Por eso en `private` el unico modo
     *             coherente es `disable`, y la garantia la aporta el
     *             aislamiento de red, no el certificado.
     *
     * Elegir `private` sobre una red que no lo sea deja la base de datos
     * expuesta en claro. La responsabilidad de esa afirmacion es de quien
     * despliega, y por eso es explicita en vez de inferida.
     */
    DATABASE_NETWORK: z.enum(["public", "private"]).default("public"),
    DATABASE_POOL_MAX: integerFromEnv(1, 100),
    DATABASE_STATEMENT_TIMEOUT_MS: integerFromEnv(100, 600_000),

    // ----- Sesiones (DEC-006) -----
    // `apps/api` no implementa la sesion: la implementa `packages/security`.
    // Pero el proceso que sirve HTTP es quien fija la cookie, asi que valida
    // su configuracion desde el primer arranque.
    SESSION_SECRET: z.string().min(32, { error: "session_secret_too_short" }),
    SESSION_COOKIE_NAME: z.string().min(1),
    SESSION_COOKIE_DOMAIN: z.string().min(1),
    SESSION_COOKIE_SECURE: booleanFromEnv,
    SESSION_TTL_MINUTES: integerFromEnv(1, 43_200),
    ADMIN_SESSION_TTL_MINUTES: integerFromEnv(1, 1_440),
    ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: integerFromEnv(1, 1_440),
    /** DEC-006 fija la ventana de step-up en 5 minutos o menos. */
    STEP_UP_MAX_AGE_SECONDS: integerFromEnv(30, 300),

    // ----- Commerce -----
    // El procesador de pagos NO esta decidido (CLAUDE.md seccion 7).
    // `none` es el unico valor que este hito reconoce.
    PAYMENT_PROVIDER: z.string().min(1),
    DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/u, { error: "must_be_iso4217_uppercase" }),
  })
  // ----- Refinamientos que solo aplican en produccion -----
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") {
      return;
    }

    if (!env.SESSION_COOKIE_SECURE) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_COOKIE_SECURE"],
        message: "DEC-006: en produccion la cookie de sesion debe ser Secure.",
      });
    }

    // DEC-043. El modo de TLS exigible depende del camino de red, y las dos
    // ramas son igual de estrictas: ninguna admite `require` ni `verify-ca`,
    // que cifran sin verificar y por tanto no defienden de un intermediario.
    if (env.DATABASE_NETWORK === "public") {
      if (env.DATABASE_SSL_MODE !== "verify-full") {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_SSL_MODE"],
          message:
            "En produccion sobre red publica la conexion a PostgreSQL debe verificar el certificado (verify-full). Si la base solo es accesible por la red privada del proveedor, declara DATABASE_NETWORK=private.",
        });
      }
    } else if (env.DATABASE_SSL_MODE !== "disable") {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_SSL_MODE"],
        message:
          "DEC-043: con DATABASE_NETWORK=private el proveedor usa certificados autofirmados y `verify-full` no puede satisfacerse. El unico modo coherente es `disable`: la garantia la da el aislamiento de red, no un TLS que no se verifica.",
      });
    }

    if (env.API_CORS_ALLOWED_ORIGINS.includes("*")) {
      ctx.addIssue({
        code: "custom",
        path: ["API_CORS_ALLOWED_ORIGINS"],
        message: "En produccion CORS nunca es *.",
      });
    }

    if (looksLikePlaceholder(env.SESSION_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message:
          "El secreto de sesion conserva un marcador de la plantilla .env.example. Alguien copio el fichero y no lo relleno.",
      });
    }

    if (looksLikePlaceholder(env.DATABASE_URL_APP)) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL_APP"],
        message: "La cadena de conexion conserva un marcador de la plantilla .env.example.",
      });
    }

    if (env.API_PUBLIC_URL.startsWith("http://")) {
      ctx.addIssue({
        code: "custom",
        path: ["API_PUBLIC_URL"],
        message: "En produccion la API se sirve sobre HTTPS.",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export interface ApiConfig {
  readonly nodeEnv: Environment["NODE_ENV"];
  readonly isProduction: boolean;
  readonly logLevel: Environment["LOG_LEVEL"];
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly publicUrl: string;
    readonly bodyLimitBytes: number;
    readonly corsAllowedOrigins: readonly string[];
    readonly requestIdHeader: string;
    readonly rateLimit: { readonly windowSeconds: number; readonly maxRequests: number };
  };
  readonly database: {
    readonly appUrl: string;
    readonly sslMode: Environment["DATABASE_SSL_MODE"];
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
  };
  readonly session: {
    readonly secret: string;
    readonly cookieName: string;
    readonly cookieDomain: string;
    readonly cookieSecure: boolean;
    readonly ttlMinutes: number;
    readonly adminTtlMinutes: number;
    readonly adminIdleTimeoutMinutes: number;
    readonly stepUpMaxAgeSeconds: number;
  };
  readonly commerce: {
    readonly paymentProvider: string;
    readonly defaultCurrency: string;
  };
  /**
   * El documento OpenAPI enumera toda la superficie administrativa. En
   * produccion no se sirve por HTTP: se publica como artefacto de build para
   * `frontend` y para el test de contrato de DEC-015.
   */
  readonly exposeOpenApiOverHttp: boolean;
}

export class EnvironmentValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(
      `Configuracion de entorno invalida:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    // Se reportan TODOS los problemas de una vez. Descubrirlos de uno en uno
    // convierte la puesta en marcha en una cadena de reintentos.
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join(".") || "(raiz)";
      return `${key}: ${issue.message}`;
    });
    throw new EnvironmentValidationError(issues);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    logLevel: env.LOG_LEVEL,
    http: {
      host: env.API_HOST,
      port: env.API_PORT,
      publicUrl: env.API_PUBLIC_URL,
      bodyLimitBytes: env.API_BODY_LIMIT_BYTES,
      corsAllowedOrigins: env.API_CORS_ALLOWED_ORIGINS,
      requestIdHeader: env.API_REQUEST_ID_HEADER,
      rateLimit: {
        windowSeconds: env.API_RATE_LIMIT_WINDOW_SECONDS,
        maxRequests: env.API_RATE_LIMIT_MAX_REQUESTS,
      },
    },
    database: {
      appUrl: env.DATABASE_URL_APP,
      sslMode: env.DATABASE_SSL_MODE,
      poolMax: env.DATABASE_POOL_MAX,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    session: {
      secret: env.SESSION_SECRET,
      cookieName: env.SESSION_COOKIE_NAME,
      cookieDomain: env.SESSION_COOKIE_DOMAIN,
      cookieSecure: env.SESSION_COOKIE_SECURE,
      ttlMinutes: env.SESSION_TTL_MINUTES,
      adminTtlMinutes: env.ADMIN_SESSION_TTL_MINUTES,
      adminIdleTimeoutMinutes: env.ADMIN_SESSION_IDLE_TIMEOUT_MINUTES,
      stepUpMaxAgeSeconds: env.STEP_UP_MAX_AGE_SECONDS,
    },
    commerce: {
      paymentProvider: env.PAYMENT_PROVIDER,
      defaultCurrency: env.DEFAULT_CURRENCY,
    },
    exposeOpenApiOverHttp: env.NODE_ENV !== "production",
  };
}
