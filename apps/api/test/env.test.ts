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
  });

  it("acepta una configuracion de produccion correcta", () => {
    expect(loadConfig(PRODUCTION_BASE).isProduction).toBe(true);
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
