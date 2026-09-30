/**
 * El esquema de entorno (DEC-018) tiene un unico criterio de exito: que el
 * proceso NO arranque cuando la configuracion es insegura o incompleta.
 */

import { describe, expect, it } from "vitest";

import { EnvironmentValidationError, loadConfig } from "../src/config/env.js";

const VALID_DEV_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  TZ: "UTC",
  LOG_LEVEL: "debug",
  API_HOST: "127.0.0.1",
  API_PORT: "4000",
  API_PUBLIC_URL: "http://localhost:4000",
  API_BODY_LIMIT_BYTES: "1048576",
  API_CORS_ALLOWED_ORIGINS: "http://localhost:3000",
  API_REQUEST_ID_HEADER: "X-Request-Id",
  API_RATE_LIMIT_WINDOW_SECONDS: "60",
  API_RATE_LIMIT_MAX_REQUESTS: "120",
  DATABASE_URL_APP: "postgresql://lsw_app:local@127.0.0.1:5432/lone_star_winners",
  DATABASE_SSL_MODE: "disable",
  DATABASE_POOL_MAX: "10",
  DATABASE_STATEMENT_TIMEOUT_MS: "15000",
  SESSION_SECRET: "0123456789012345678901234567890123456789",
  SESSION_COOKIE_NAME: "lsw_session",
  SESSION_COOKIE_DOMAIN: "localhost",
  SESSION_COOKIE_SECURE: "false",
  SESSION_TTL_MINUTES: "720",
  ADMIN_SESSION_TTL_MINUTES: "60",
  ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: "15",
  STEP_UP_MAX_AGE_SECONDS: "300",
  MFA_SECRET_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  PAYMENT_PROVIDER: "none",
  DEFAULT_CURRENCY: "USD",
};

function withEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...VALID_DEV_ENV, ...overrides };
}

describe("configuracion valida", () => {
  it("carga un entorno de desarrollo completo", () => {
    const config = loadConfig(VALID_DEV_ENV);
    expect(config.http.port).toBe(4000);
    expect(config.isProduction).toBe(false);
    expect(config.http.corsAllowedOrigins).toEqual(["http://localhost:3000"]);
  });

  it("normaliza la cabecera de correlacion a minusculas", () => {
    // Las cabeceras de Node llegan en minusculas; si la configuracion las
    // guardara con la caja original, la busqueda fallaria en silencio y no
    // habria `correlation_id` en ningun log.
    expect(loadConfig(VALID_DEV_ENV).http.requestIdHeader).toBe("x-request-id");
  });

  it("no sirve el documento OpenAPI por HTTP en produccion", () => {
    expect(loadConfig(VALID_DEV_ENV).exposeOpenApiOverHttp).toBe(true);
  });
});

describe("fallo duro (DEC-018)", () => {
  it("no arranca si falta una variable", () => {
    const incomplete = { ...VALID_DEV_ENV };
    delete incomplete.DATABASE_URL_APP;
    expect(() => loadConfig(incomplete)).toThrow(EnvironmentValidationError);
  });

  it("informa de TODOS los problemas a la vez, no del primero", () => {
    const broken = withEnv({
      API_PORT: "no-es-un-puerto",
      LOG_LEVEL: "verboso",
      DEFAULT_CURRENCY: "dolares",
    });
    try {
      loadConfig(broken);
      expect.unreachable("deberia haber fallado");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const issues = (error as EnvironmentValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("exige que el proceso corra en UTC (DEC-011)", () => {
    expect(() => loadConfig(withEnv({ TZ: "America/Chicago" }))).toThrow(/UTC/iu);
  });

  it("rechaza un secreto de sesion demasiado corto", () => {
    expect(() => loadConfig(withEnv({ SESSION_SECRET: "corto" }))).toThrow(
      EnvironmentValidationError,
    );
  });

  it("rechaza una ventana de step-up mayor que la que fija DEC-006", () => {
    expect(() => loadConfig(withEnv({ STEP_UP_MAX_AGE_SECONDS: "600" }))).toThrow(
      EnvironmentValidationError,
    );
  });
});

describe("refuerzos que solo aplican en produccion", () => {
  const PRODUCTION_BASE = withEnv({
    NODE_ENV: "production",
    API_PUBLIC_URL: "https://api.ejemplo.invalid",
    SESSION_COOKIE_SECURE: "true",
    DATABASE_SSL_MODE: "verify-full",
    DATABASE_URL_APP: "postgresql://lsw_app:secreto@db.interno.invalid:5432/lone_star_winners",
    SESSION_SECRET: "0123456789012345678901234567890123456789",
    API_CORS_ALLOWED_ORIGINS: "https://www.ejemplo.invalid",
    EMAIL_PROVIDER: "resend",
    EMAIL_PROVIDER_API_KEY: "re_0123456789abcdefghij",
    EMAIL_FROM_ADDRESS: "no-reply@lsw-pruebas.com",
    WEB_PUBLIC_URL: "https://www.lsw-pruebas.com",
  });

  it("acepta una configuracion de produccion correcta", () => {
    expect(loadConfig(PRODUCTION_BASE).isProduction).toBe(true);
  });

  describe("DEC-058: correo transaccional", () => {
    it("publica el proveedor, el remitente y la URL del portal", () => {
      const config = loadConfig(PRODUCTION_BASE);
      expect(config.email).toMatchObject({
        provider: "resend",
        apiKey: "re_0123456789abcdefghij",
        fromAddress: "no-reply@lsw-pruebas.com",
        fromName: "Lone Star Winners",
      });
      expect(config.web.publicUrl).toBe("https://www.lsw-pruebas.com");
    });

    it("rechaza `console` en produccion: los correos no saldrian", () => {
      expect(() => loadConfig({ ...PRODUCTION_BASE, EMAIL_PROVIDER: "console" })).toThrow(
        /EMAIL_PROVIDER/u,
      );
    });

    it("rechaza `resend` sin clave, en cualquier entorno", () => {
      const withoutKey = { ...PRODUCTION_BASE };
      delete withoutKey.EMAIL_PROVIDER_API_KEY;
      expect(() => loadConfig(withoutKey)).toThrow(/EMAIL_PROVIDER_API_KEY/u);
      expect(() => loadConfig(withEnv({ EMAIL_PROVIDER: "resend" }))).toThrow(
        /EMAIL_PROVIDER_API_KEY/u,
      );
    });

    it("rechaza el remitente de relleno y un portal sin HTTPS", () => {
      expect(() =>
        loadConfig({ ...PRODUCTION_BASE, EMAIL_FROM_ADDRESS: "no-reply@localhost.invalid" }),
      ).toThrow(/EMAIL_FROM_ADDRESS/u);
      expect(() =>
        loadConfig({ ...PRODUCTION_BASE, WEB_PUBLIC_URL: "http://www.lsw-pruebas.com" }),
      ).toThrow(/WEB_PUBLIC_URL/u);
    });

    it("fuera de produccion basta con no declarar nada: `console` y el portal local", () => {
      const config = loadConfig(VALID_DEV_ENV);
      expect(config.email.provider).toBe("console");
      expect(config.web.publicUrl).toBe("http://localhost:3000");
    });
  });

  // Despues del bloque de correo a proposito: `.gitleaksignore` fija por
  // NUMERO DE LINEA los dos falsos positivos de ese bloque, y un bloque nuevo
  // encima los desplazaria.
  describe("DEC-059: pagos con Stripe", () => {
    // Valores con la FORMA de Stripe, ficticios (CLAUDE.md 8).
    const STRIPE = {
      PAYMENT_PROVIDER: "stripe",
      PAYMENT_PROVIDER_API_KEY: "sk_live_lsw_fixture_not_a_real_key", // gitleaks:allow — ficticio
      PAYMENT_WEBHOOK_SIGNING_SECRET: "whsec_lsw_fixture_not_a_real_secret", // gitleaks:allow — ficticio
    };
    const TEST_KEY = "sk_test_lsw_fixture_not_a_real_key"; // gitleaks:allow — ficticio

    it("sin declarar nada sigue en `none`: el checkout responde 503, no cobra", () => {
      expect(loadConfig(PRODUCTION_BASE).commerce.payment).toEqual({ provider: "none" });
    });

    it("con clave y secreto publica la configuracion de Stripe", () => {
      expect(loadConfig({ ...PRODUCTION_BASE, ...STRIPE }).commerce.payment).toEqual({
        provider: "stripe",
        secretKey: STRIPE.PAYMENT_PROVIDER_API_KEY,
        webhookSecret: STRIPE.PAYMENT_WEBHOOK_SIGNING_SECRET,
        webhookToleranceSeconds: 300,
        testMode: false,
      });
    });

    it("stripe sin secreto del webhook no arranca: cualquiera fabricaria pagos", () => {
      const withoutSecret: NodeJS.ProcessEnv = { ...PRODUCTION_BASE, ...STRIPE };
      delete withoutSecret.PAYMENT_WEBHOOK_SIGNING_SECRET;
      expect(() => loadConfig(withoutSecret)).toThrow(/PAYMENT_WEBHOOK_SIGNING_SECRET/u);
    });

    it("rechaza una clave publicable (pk_) o sin forma de Stripe", () => {
      expect(() =>
        loadConfig({ ...PRODUCTION_BASE, ...STRIPE, PAYMENT_PROVIDER_API_KEY: "pk_live_x" }),
      ).toThrow(/PAYMENT_PROVIDER_API_KEY/u);
    });

    it("una clave de PRUEBA en produccion exige declararlo con PAYMENT_TEST_MODE", () => {
      const test = { ...PRODUCTION_BASE, ...STRIPE, PAYMENT_PROVIDER_API_KEY: TEST_KEY };
      expect(() => loadConfig(test)).toThrow(/PAYMENT_TEST_MODE/u);

      const declared = loadConfig({ ...test, PAYMENT_TEST_MODE: "true" });
      expect(declared.commerce.payment).toMatchObject({ provider: "stripe", testMode: true });
    });

    it("PAYMENT_TEST_MODE con una clave real no arranca: el log mentiria", () => {
      expect(() =>
        loadConfig({ ...PRODUCTION_BASE, ...STRIPE, PAYMENT_TEST_MODE: "true" }),
      ).toThrow(/PAYMENT_TEST_MODE/u);
    });

    it("un proveedor desconocido no arranca", () => {
      expect(() => loadConfig({ ...PRODUCTION_BASE, PAYMENT_PROVIDER: "paypal" })).toThrow(
        EnvironmentValidationError,
      );
    });
  });

  describe("DEC-060: celular por SMS", () => {
    // Identificadores con la FORMA de Twilio, ficticios (CLAUDE.md 8).
    const TWILIO = {
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000", // gitleaks:allow — ficticio
      TWILIO_AUTH_TOKEN: "00000000000000000000000000000000", // gitleaks:allow — ficticio
      TWILIO_VERIFY_SERVICE_SID: "VA00000000000000000000000000000000", // gitleaks:allow — ficticio
      TURNSTILE_SECRET_KEY: "0x-lsw-fixture-turnstile-secret", // gitleaks:allow — ficticio
    };

    it("sin declarar nada el registro con celular esta apagado", () => {
      const config = loadConfig(PRODUCTION_BASE);
      expect(config.sms).toEqual({ provider: "none" });
      expect(config.botCheck).toBeNull();
    });

    it("con los tres identificadores y Turnstile publica la configuracion", () => {
      const config = loadConfig({ ...PRODUCTION_BASE, ...TWILIO });
      expect(config.sms).toMatchObject({
        provider: "twilio",
        accountSid: TWILIO.TWILIO_ACCOUNT_SID,
      });
      expect(config.botCheck).toEqual({ secretKey: TWILIO.TURNSTILE_SECRET_KEY });
    });

    it("en produccion Twilio sin Turnstile no arranca: el saldo quedaria expuesto", () => {
      const withoutTurnstile: NodeJS.ProcessEnv = { ...PRODUCTION_BASE, ...TWILIO };
      delete withoutTurnstile.TURNSTILE_SECRET_KEY;
      expect(() => loadConfig(withoutTurnstile)).toThrow(/TURNSTILE_SECRET_KEY/u);
    });

    it("un Service SID sin forma de Verify no arranca", () => {
      expect(() =>
        loadConfig({ ...PRODUCTION_BASE, ...TWILIO, TWILIO_VERIFY_SERVICE_SID: "MG123" }),
      ).toThrow(/TWILIO_VERIFY_SERVICE_SID/u);
    });

    it("console solo fuera de produccion", () => {
      expect(() => loadConfig({ ...PRODUCTION_BASE, SMS_PROVIDER: "console" })).toThrow(
        /SMS_PROVIDER/u,
      );
      expect(loadConfig(withEnv({ SMS_PROVIDER: "console" })).sms).toEqual({
        provider: "console",
      });
    });
  });

  it("rechaza una cookie de sesion sin Secure (DEC-006)", () => {
    expect(() => loadConfig({ ...PRODUCTION_BASE, SESSION_COOKIE_SECURE: "false" })).toThrow(
      /Secure/iu,
    );
  });

  it("rechaza una conexion a PostgreSQL sin verificar el certificado", () => {
    expect(() => loadConfig({ ...PRODUCTION_BASE, DATABASE_SSL_MODE: "require" })).toThrow(
      /verify-full/iu,
    );
  });

  describe("la cadena de conexion no puede redefinir la postura de TLS", () => {
    // El fallo real que esto previene: `pg` fusiona la configuracion haciendo
    // `Object.assign({}, config, parse(config.connectionString))`, asi que la
    // query GANA sobre el objeto `ssl`. Sin esta guarda, `verify-full` pasaba
    // toda la validacion mientras la conexion viajaba en claro. Medido contra
    // el `pg` instalado: `?sslmode=disable` -> ssl === false.
    for (const parameter of [
      "sslmode=disable",
      "sslmode=require",
      "sslmode=no-verify",
      "ssl=0",
      "sslrootcert=/tmp/ca.pem",
    ]) {
      it(`rechaza DATABASE_URL_APP con ${parameter}`, () => {
        expect(() =>
          loadConfig({
            ...PRODUCTION_BASE,
            DATABASE_URL_APP: `postgresql://lsw_app:secreto@db.interno.invalid:5432/lsw?${parameter}`,
          }),
        ).toThrow(/DATABASE_SSL_MODE/u);
      });
    }

    it("acepta una cadena sin parametros de TLS", () => {
      expect(loadConfig(PRODUCTION_BASE).database.appUrl).toContain("lsw_app");
    });

    it("no confunde un parametro no relacionado con uno de TLS", () => {
      const config = loadConfig({
        ...PRODUCTION_BASE,
        DATABASE_URL_APP:
          "postgresql://lsw_app:secreto@db.interno.invalid:5432/lsw?application_name=lsw-api",
      });
      expect(config.database.appUrl).toContain("application_name");
    });
  });

  describe("DEC-043: camino de red hacia PostgreSQL", () => {
    it("exige verify-full cuando no se declara nada (el defecto es el estricto)", () => {
      // Sin DATABASE_NETWORK el esquema asume `public`. Es la garantia de que
      // la excepcion de red privada solo existe si alguien la escribe.
      expect(() => loadConfig({ ...PRODUCTION_BASE, DATABASE_SSL_MODE: "disable" })).toThrow(
        /verify-full/iu,
      );
    });

    it("acepta disable cuando la conexion no sale de la red privada", () => {
      const config = loadConfig({
        ...PRODUCTION_BASE,
        DATABASE_NETWORK: "private",
        DATABASE_SSL_MODE: "disable",
        DATABASE_URL_APP: "postgresql://lsw_app:secreto@postgres.railway.internal:5432/railway",
      });

      expect(config.isProduction).toBe(true);
      expect(config.database.sslMode).toBe("disable");
    });

    it("rechaza en red privada un TLS que cifra pero no verifica", () => {
      // `require` es la trampa: parece mas seguro que `disable` y no lo es.
      // No defiende de un intermediario, y ademas oculta que no lo hace.
      for (const mode of ["require", "verify-ca", "verify-full"] as const) {
        expect(() =>
          loadConfig({
            ...PRODUCTION_BASE,
            DATABASE_NETWORK: "private",
            DATABASE_SSL_MODE: mode,
          }),
        ).toThrow(/DEC-043/u);
      }
    });
  });

  it("rechaza CORS con comodin", () => {
    expect(() => loadConfig({ ...PRODUCTION_BASE, API_CORS_ALLOWED_ORIGINS: "*" })).toThrow(
      /CORS/iu,
    );
  });

  it("rechaza HTTP plano", () => {
    expect(() =>
      loadConfig({ ...PRODUCTION_BASE, API_PUBLIC_URL: "http://api.ejemplo.invalid" }),
    ).toThrow(/HTTPS/iu);
  });

  it("detecta un secreto que sigue siendo el marcador de .env.example", () => {
    // El fallo real que esto previene: alguien copia .env.example a .env en el
    // servidor, arranca, y el proceso funciona con un secreto publicado en el
    // repositorio.
    expect(() =>
      loadConfig({
        ...PRODUCTION_BASE,
        SESSION_SECRET: "FAKE_LOCAL_ONLY_replace_with_48_random_bytes",
      }),
    ).toThrow(/marcador/iu);
  });

  it("detecta una cadena de conexion que sigue siendo la de la plantilla", () => {
    expect(() =>
      loadConfig({
        ...PRODUCTION_BASE,
        DATABASE_URL_APP:
          "postgresql://lsw_app:LOCAL_DEV_PASSWORD_CHANGE_ME@127.0.0.1:5432/lone_star_winners",
      }),
    ).toThrow(/marcador/iu);
  });
});
