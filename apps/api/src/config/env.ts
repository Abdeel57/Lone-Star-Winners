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

/**
 * Parametros de TLS que `pg` acepta DENTRO de la cadena de conexion.
 *
 * Existen porque `pg` no combina la configuracion: la fusiona, y gana la
 * cadena. En `connection-parameters.js` hace
 * `Object.assign({}, config, parse(config.connectionString))`, de modo que un
 * `?sslmode=...` sobrescribe el objeto `ssl` que le pasa `app.ts`. Medido
 * contra el `pg` instalado, pasando siempre `ssl: { rejectUnauthorized: true }`:
 *
 *   (sin query)          -> { rejectUnauthorized: true }
 *   ?sslmode=disable     -> false          <- conexion en claro
 *   ?sslmode=no-verify   -> { rejectUnauthorized: false }
 *   ?ssl=0               -> false          <- conexion en claro
 *
 * Es decir: sin esta guarda, `DATABASE_SSL_MODE=verify-full` puede pasar toda
 * la validacion y todos los tests mientras la conexion real viaja sin cifrar,
 * porque la postura de TLS tendria dos fuentes de verdad y la que manda no es
 * la que se valida. La cadena declara A DONDE se conecta; COMO se protege esa
 * conexion lo declara `DATABASE_SSL_MODE`, y solo el.
 */
const TLS_QUERY_PARAMETERS = [
  "sslmode",
  "ssl",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslnegotiation",
  "uselibpqcompat",
];

/** Devuelve los parametros de TLS presentes en la query de una URL de conexion. */
function tlsParametersIn(connectionString: string): readonly string[] {
  let query: URLSearchParams;

  try {
    query = new URL(connectionString).searchParams;
  } catch {
    // Una cadena que no parsea la rechaza `startsWith("postgres")` o el propio
    // `pg` al conectar. Aqui no se opina.
    return [];
  }

  return TLS_QUERY_PARAMETERS.filter((parameter) => query.has(parameter));
}

const postgresUrlWithoutTlsOverrides = z
  .string()
  .startsWith("postgres")
  .refine((value) => tlsParametersIn(value).length === 0, {
    error: `la cadena de conexion no puede traer parametros de TLS en la query (${TLS_QUERY_PARAMETERS.join(", ")}): en \`pg\` SOBRESCRIBEN a DATABASE_SSL_MODE y dejarian la postura de TLS con dos fuentes de verdad. Quitalos: el modo se declara en DATABASE_SSL_MODE y en ningun otro sitio.`,
  });

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
    DATABASE_URL_APP: postgresUrlWithoutTlsOverrides,
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

    /**
     * DEC-045: clave AES-256 (32 bytes en base64url) con la que se cifra el
     * secreto TOTP antes de persistirlo. Se valida la LONGITUD aqui, no al
     * usarla: si no, una clave corta fallaria en la primera inscripcion de MFA
     * de alguien, en produccion, en vez de impedir el arranque.
     */
    MFA_SECRET_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, "base64url").length === 32, {
        error: "debe ser una clave de 32 bytes codificada en base64url",
      }),

    // ----- Commerce (DEC-059) -----
    // `none` deja montado el proveedor que rechaza todo: el checkout responde
    // 503 PAYMENT_PROVIDER_NOT_CONFIGURED en vez de simular un cobro. `stripe`
    // exige su clave y el secreto del webhook (refinamiento de abajo).
    PAYMENT_PROVIDER: z.enum(["none", "stripe"]),
    PAYMENT_PROVIDER_API_KEY: z.string().trim().min(1).optional(),
    PAYMENT_WEBHOOK_SIGNING_SECRET: z.string().trim().min(1).optional(),
    PAYMENT_WEBHOOK_TOLERANCE_SECONDS: integerFromEnv(30, 3_600).default(300),
    /**
     * Declaracion EXPRESA de que en produccion se usa una clave de prueba de
     * Stripe. Existe porque solo hay un entorno desplegado y el checkout se
     * prueba antes del lanzamiento con tarjetas de prueba. Sin ella, una clave
     * `sk_test_` en produccion no arranca.
     */
    PAYMENT_TEST_MODE: booleanFromEnv.default(false),
    DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/u, { error: "must_be_iso4217_uppercase" }),

    // ----- Correo transaccional (DEC-058) -----
    //
    // Opcionales FUERA de produccion, con `console` como proveedor: en local y
    // en tests el flujo se recorre sin enviar nada. En produccion el
    // refinamiento de abajo exige `resend`, su clave y la URL del portal.
    EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
    EMAIL_FROM_ADDRESS: z.email().default("no-reply@localhost.invalid"),
    EMAIL_FROM_NAME: z.string().trim().min(1).max(80).default("Lone Star Winners"),
    EMAIL_PROVIDER_API_KEY: z.string().trim().min(1).optional(),
    /**
     * URL publica del portal (`apps/web`). La API la necesita para construir
     * los enlaces de los correos, que abren pantallas del portal y no de la
     * API. Es la del dominio que ve el cliente, no la interna de Railway.
     */
    WEB_PUBLIC_URL: z.url().default("http://localhost:3000"),

    // ----- Celular verificado por SMS (DEC-060) -----
    //
    // `none` (defecto) apaga el registro y el inicio de sesion con celular:
    // las rutas responden 503 SMS_NOT_CONFIGURED. `console` es solo para
    // desarrollo. `twilio` exige sus tres identificadores.
    SMS_PROVIDER: z.enum(["none", "console", "twilio"]).default("none"),
    TWILIO_ACCOUNT_SID: z.string().trim().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().trim().min(1).optional(),
    TWILIO_VERIFY_SERVICE_SID: z.string().trim().min(1).optional(),
    /**
     * Clave SECRETA de Cloudflare Turnstile. Con ella, pedir un codigo por SMS
     * exige demostrar que quien pide es una persona. La clave PUBLICA del widget
     * va en `apps/web` (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
     */
    TURNSTILE_SECRET_KEY: z.string().trim().min(1).optional(),
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

    // DEC-058. Con `console` en produccion la recuperacion de contrasena
    // responderia "revisa tu correo" y no llegaria nada: parece que funciona.
    if (env.EMAIL_PROVIDER !== "resend") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER"],
        message:
          "DEC-058: en produccion EMAIL_PROVIDER debe ser `resend`. Con `console` los correos de verificacion y de recuperacion no se envian.",
      });
    }

    if (
      env.EMAIL_FROM_ADDRESS.endsWith(".invalid") ||
      looksLikePlaceholder(env.EMAIL_FROM_ADDRESS)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM_ADDRESS"],
        message:
          "DEC-058: en produccion EMAIL_FROM_ADDRESS debe ser una direccion del dominio verificado en el proveedor.",
      });
    }

    if (!env.WEB_PUBLIC_URL.startsWith("https://") || looksLikePlaceholder(env.WEB_PUBLIC_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["WEB_PUBLIC_URL"],
        message:
          "En produccion WEB_PUBLIC_URL es la direccion HTTPS del portal: los enlaces de los correos apuntan ahi.",
      });
    }
  })
  // ----- Coherencia del SMS y del anti-bots (DEC-060) -----
  .superRefine((env, ctx) => {
    if (env.SMS_PROVIDER === "console" && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_PROVIDER"],
        message:
          "DEC-060: SMS_PROVIDER=console no envia nada y acepta un codigo fijo. En produccion es `twilio` o `none`.",
      });
    }

    if (env.SMS_PROVIDER !== "twilio") {
      return;
    }

    const checks: readonly (readonly [keyof typeof env, RegExp, string])[] = [
      ["TWILIO_ACCOUNT_SID", /^AC[0-9a-f]{32}$/iu, "el Account SID de Twilio (AC + 32 caracteres)"],
      ["TWILIO_AUTH_TOKEN", /^[0-9a-z]{32,}$/iu, "el Auth Token de Twilio"],
      [
        "TWILIO_VERIFY_SERVICE_SID",
        /^VA[0-9a-f]{32}$/iu,
        "el Service SID de Twilio Verify (VA + 32 caracteres)",
      ],
    ];

    for (const [name, shape, what] of checks) {
      const value = env[name];
      if (typeof value !== "string" || !shape.test(value) || looksLikePlaceholder(value)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `DEC-060: SMS_PROVIDER=twilio necesita ${what}.`,
        });
      }
    }

    // Cada codigo cuesta dinero. En produccion no se abre el envio de SMS sin
    // la comprobacion anti-bots que lo protege.
    if (env.NODE_ENV === "production" && env.TURNSTILE_SECRET_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET_KEY"],
        message:
          "DEC-060: en produccion el envio de SMS exige la clave secreta de Cloudflare Turnstile. Sin ella, un programa podria pedir miles de codigos a costa del saldo de Twilio.",
      });
    }
  })
  // ----- Coherencia del proveedor de pagos, en cualquier entorno (DEC-059) -----
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER !== "stripe") {
      return;
    }

    const key = env.PAYMENT_PROVIDER_API_KEY;
    if (key === undefined || !/^(sk|rk)_(live|test)_/u.test(key) || looksLikePlaceholder(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER_API_KEY"],
        message:
          "DEC-059: PAYMENT_PROVIDER=stripe necesita la clave secreta de Stripe (sk_live_, sk_test_ o una restringida rk_).",
      });
    }

    const secret = env.PAYMENT_WEBHOOK_SIGNING_SECRET;
    if (secret === undefined || !secret.startsWith("whsec_") || looksLikePlaceholder(secret)) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_WEBHOOK_SIGNING_SECRET"],
        message:
          "DEC-059: PAYMENT_PROVIDER=stripe necesita el secreto del webhook (whsec_). Sin el, cualquiera podria fabricar pagos y, con ellos, participaciones.",
      });
    }

    // Clave de prueba en produccion: la tienda "cobraria" con tarjetas de
    // prueba, y con una promocion activa otorgaria participaciones reales por
    // cobros ficticios. Solo se admite declarandolo con PAYMENT_TEST_MODE=true.
    const testKey = key !== undefined && /^(sk|rk)_test_/u.test(key);
    if (env.NODE_ENV === "production" && testKey && !env.PAYMENT_TEST_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER_API_KEY"],
        message:
          "DEC-059: clave de PRUEBA de Stripe en produccion. Si es a proposito (pruebas antes del lanzamiento), declara PAYMENT_TEST_MODE=true; si no, usa la clave sk_live_.",
      });
    }

    // Y al reves: el modo de prueba declarado con una clave real mentiria en
    // el log sobre lo que se esta cobrando.
    if (env.PAYMENT_TEST_MODE && key !== undefined && !testKey) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_TEST_MODE"],
        message: "DEC-059: PAYMENT_TEST_MODE=true con una clave REAL de Stripe. Quita la variable.",
      });
    }
  })
  // ----- Coherencia del proveedor de correo, en cualquier entorno -----
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER !== "resend") {
      return;
    }

    if (env.EMAIL_PROVIDER_API_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER_API_KEY"],
        message: "DEC-058: EMAIL_PROVIDER=resend necesita la clave de la API de Resend.",
      });
    } else if (looksLikePlaceholder(env.EMAIL_PROVIDER_API_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER_API_KEY"],
        message: "La clave de correo conserva un marcador de la plantilla .env.example.",
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
  readonly mfa: {
    readonly encryptionKey: string;
  };
  readonly commerce: {
    readonly paymentProvider: string;
    readonly defaultCurrency: string;
    /**
     * DEC-059. Union discriminada: con `stripe` la clave y el secreto existen
     * por construccion; con `none` no hay nada que olvidar.
     */
    readonly payment:
      | { readonly provider: "none" }
      | {
          readonly provider: "stripe";
          readonly secretKey: string;
          readonly webhookSecret: string;
          readonly webhookToleranceSeconds: number;
          readonly testMode: boolean;
        };
  };
  /**
   * Correo transaccional (DEC-058). Union discriminada: con `resend` la clave
   * existe por construccion, y con `console` no hay clave que olvidar.
   */
  readonly email:
    | {
        readonly provider: "resend";
        readonly apiKey: string;
        readonly fromAddress: string;
        readonly fromName: string;
      }
    | {
        readonly provider: "console";
        readonly fromAddress: string;
        readonly fromName: string;
      };
  /** Portal (`apps/web`): destino de los enlaces que viajan por correo. */
  readonly web: {
    readonly publicUrl: string;
  };
  /** DEC-060: verificacion de celular por SMS. `none` apaga el registro con celular. */
  readonly sms:
    | { readonly provider: "none" }
    | { readonly provider: "console" }
    | {
        readonly provider: "twilio";
        readonly accountSid: string;
        readonly authToken: string;
        readonly verifyServiceSid: string;
      };
  /** DEC-060: Cloudflare Turnstile. `null` = no se exige comprobacion anti-bots. */
  readonly botCheck: { readonly secretKey: string } | null;
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
    mfa: {
      encryptionKey: env.MFA_SECRET_ENCRYPTION_KEY,
    },
    commerce: {
      paymentProvider: env.PAYMENT_PROVIDER,
      defaultCurrency: env.DEFAULT_CURRENCY,
      payment:
        env.PAYMENT_PROVIDER === "stripe" &&
        env.PAYMENT_PROVIDER_API_KEY !== undefined &&
        env.PAYMENT_WEBHOOK_SIGNING_SECRET !== undefined
          ? {
              provider: "stripe",
              secretKey: env.PAYMENT_PROVIDER_API_KEY,
              webhookSecret: env.PAYMENT_WEBHOOK_SIGNING_SECRET,
              webhookToleranceSeconds: env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
              testMode: /^(sk|rk)_test_/u.test(env.PAYMENT_PROVIDER_API_KEY),
            }
          : { provider: "none" },
    },
    email:
      // La segunda condicion no es redundante para el lector: el refinamiento
      // ya garantiza que con `resend` hay clave, y aqui se hace visible al
      // compilador en vez de afirmarlo con un `!`.
      env.EMAIL_PROVIDER === "resend" && env.EMAIL_PROVIDER_API_KEY !== undefined
        ? {
            provider: "resend",
            apiKey: env.EMAIL_PROVIDER_API_KEY,
            fromAddress: env.EMAIL_FROM_ADDRESS,
            fromName: env.EMAIL_FROM_NAME,
          }
        : {
            provider: "console",
            fromAddress: env.EMAIL_FROM_ADDRESS,
            fromName: env.EMAIL_FROM_NAME,
          },
    web: {
      publicUrl: env.WEB_PUBLIC_URL,
    },
    sms:
      env.SMS_PROVIDER === "twilio" &&
      env.TWILIO_ACCOUNT_SID !== undefined &&
      env.TWILIO_AUTH_TOKEN !== undefined &&
      env.TWILIO_VERIFY_SERVICE_SID !== undefined
        ? {
            provider: "twilio",
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID,
          }
        : env.SMS_PROVIDER === "console"
          ? { provider: "console" }
          : { provider: "none" },
    botCheck:
      env.TURNSTILE_SECRET_KEY === undefined ? null : { secretKey: env.TURNSTILE_SECRET_KEY },
    exposeOpenApiOverHttp: env.NODE_ENV !== "production",
  };
}
