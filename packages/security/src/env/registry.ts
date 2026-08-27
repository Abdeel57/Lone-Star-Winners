/**
 * Registro de variables de entorno de Lone Star Winners.
 *
 * Contrato con `.env.example` (que pertenece a `backend`): toda variable que
 * aparezca alli debe estar declarada aqui, y al reves. El test de
 * `tests/security` compara ambas listas y falla si divergen. Una variable no
 * declarada es una variable que nadie valida en el arranque.
 *
 * Lo que NO vive en el entorno, por decision registrada:
 *   - feature flags legalmente materiales (DEC-013: base de datos, apagados por
 *     defecto, con cambio auditado);
 *   - cualquier interruptor de sorteo interno (DEC-017: hacen falta cinco
 *     cerrojos, y ninguno es una variable de entorno);
 *   - constantes legales: edad, jurisdicciones, formulas, deadlines
 *     (DEC-012: `PromotionRulesVersion`).
 */

import {
  ALL_ENVIRONMENTS,
  DEPLOYED_ENVIRONMENTS,
  NO_ENVIRONMENT,
  type EnvName,
  type EnvVarKind,
  type EnvVarScope,
  type EnvVarSpec,
  type ProductionHardeningRule,
} from "./spec.js";

interface VarOptions {
  readonly secret?: boolean;
  readonly allowedValues?: readonly string[];
}

function v(
  name: string,
  scope: EnvVarScope,
  kind: EnvVarKind,
  requiredIn: readonly EnvName[],
  notes: string,
  options: VarOptions = {},
): EnvVarSpec {
  return Object.freeze({
    name,
    scope,
    kind,
    requiredIn,
    notes,
    secret: options.secret ?? false,
    allowedValues: options.allowedValues ?? null,
  });
}

// `fatal` no aparece en el comentario de `.env.example`, pero si en el esquema
// de arranque de `apps/api`. Se admite el conjunto mas amplio: rechazar aqui un
// valor que el proceso acepta solo produciria un falso bloqueo de arranque.
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
const SSL_MODES = ["disable", "require", "verify-ca", "verify-full"] as const;
const DATABASE_NETWORKS = ["public", "private"] as const;

const RUNTIME_AND_DATA_VARS: readonly EnvVarSpec[] = Object.freeze([
  // ----- Runtime -------------------------------------------------------
  v("NODE_ENV", "shared", "enum", ALL_ENVIRONMENTS, "Entorno de ejecucion.", {
    allowedValues: ["development", "test", "production"],
  }),
  v("TZ", "shared", "string", ALL_ENVIRONMENTS, "DEC-011: el proceso corre en UTC."),
  v("LOG_LEVEL", "shared", "enum", ALL_ENVIRONMENTS, "Nivel de log.", {
    allowedValues: LOG_LEVELS,
  }),

  // ----- apps/api ------------------------------------------------------
  v("API_HOST", "api", "string", ALL_ENVIRONMENTS, "Interfaz de escucha de Fastify."),
  v("API_PORT", "api", "integer", ALL_ENVIRONMENTS, "Puerto de escucha."),
  v("API_PUBLIC_URL", "api", "url", ALL_ENVIRONMENTS, "URL publica de la API."),
  v("API_BODY_LIMIT_BYTES", "api", "integer", ALL_ENVIRONMENTS, "Limite de cuerpo de peticion."),
  v(
    "API_CORS_ALLOWED_ORIGINS",
    "api",
    "string",
    ALL_ENVIRONMENTS,
    "Origenes permitidos, separados por coma. En produccion nunca comodin.",
  ),
  v("API_REQUEST_ID_HEADER", "api", "string", ALL_ENVIRONMENTS, "Cabecera de correlacion."),
  v("API_RATE_LIMIT_WINDOW_SECONDS", "api", "integer", ALL_ENVIRONMENTS, "Ventana de rate limit."),
  v("API_RATE_LIMIT_MAX_REQUESTS", "api", "integer", ALL_ENVIRONMENTS, "Maximo por ventana."),

  // ----- apps/web ------------------------------------------------------
  v("WEB_PUBLIC_URL", "web", "url", ALL_ENVIRONMENTS, "URL publica del portal."),
  v("NEXT_PUBLIC_SITE_URL", "web", "url", ALL_ENVIRONMENTS, "URL del sitio, visible en navegador."),
  v(
    "NEXT_PUBLIC_API_BASE_URL",
    "web",
    "url",
    ALL_ENVIRONMENTS,
    "Base de la API, visible en navegador.",
  ),
  v(
    "API_BASE_URL",
    "web",
    "url",
    ALL_ENVIRONMENTS,
    "Base de la API para las llamadas que hace el SERVIDOR de Next. Sin prefijo NEXT_PUBLIC_ a proposito: en despliegue puede apuntar a una direccion interna que el navegador no debe conocer.",
  ),
  v(
    "WEB_ENABLE_API_MOCKS",
    "web",
    "boolean",
    // Opcional en todas partes: ausente significa apagado, que es el valor
    // seguro. Declararla obligatoria en produccion obligaria a escribir
    // literalmente `false` en el entorno de produccion, y una variable que hay
    // que acordarse de poner a `false` es una variable que algun dia estara
    // a `true`.
    NO_ENVIRONMENT,
    "Interruptor de los mocks de red de apps/web (MSW). Prohibido en entornos desplegados: ver PRODUCTION_HARDENING_RULES.",
  ),

  // ----- PostgreSQL (DEC-003) ------------------------------------------
  v(
    "DATABASE_URL_MIGRATOR",
    "api",
    "postgres_url",
    ALL_ENVIRONMENTS,
    "Rol con DDL. Solo lo usa el runner de migraciones.",
    { secret: true },
  ),
  v(
    "DATABASE_URL_APP",
    "api",
    "postgres_url",
    ALL_ENVIRONMENTS,
    "Rol de aplicacion. Sin UPDATE/DELETE sobre ledger ni auditoria (DEC-007).",
    { secret: true },
  ),
  v(
    "DATABASE_URL_READONLY",
    "api",
    "postgres_url",
    DEPLOYED_ENVIRONMENTS,
    "Rol de solo lectura para informes y auditoria.",
    { secret: true },
  ),
  v("DATABASE_SSL_MODE", "api", "enum", ALL_ENVIRONMENTS, "Modo TLS de la conexion.", {
    allowedValues: SSL_MODES,
  }),
  v(
    "DATABASE_NETWORK",
    "api",
    "enum",
    NO_ENVIRONMENT,
    "DEC-043: camino de red hacia PostgreSQL. Si falta, se asume `public`, que es la rama estricta.",
    { allowedValues: DATABASE_NETWORKS },
  ),
  v("DATABASE_POOL_MAX", "api", "integer", ALL_ENVIRONMENTS, "Tamano maximo del pool."),
  v("DATABASE_STATEMENT_TIMEOUT_MS", "api", "integer", ALL_ENVIRONMENTS, "Timeout de sentencia."),

  // ----- Arranque en frio de una base gestionada (DEC-043) --------------
  // Las lee `db:bootstrap`, nunca el proceso que sirve HTTP. Por eso su
  // `requiredIn` es NO_ENVIRONMENT: en local el arranque en frio se resuelve
  // con `packages/database/sql/local-dev/set-role-passwords.sql`.
  v(
    "DATABASE_URL_SUPERUSER",
    "api",
    "postgres_url",
    NO_ENVIRONMENT,
    "Superusuario del proveedor gestionado. Solo `db:bootstrap`: crea roles y aplica migraciones cuando `lsw_migrator` aun no puede autenticarse.",
    { secret: true },
  ),
  v(
    "LSW_DB_MIGRATOR_PASSWORD",
    "api",
    "string",
    NO_ENVIRONMENT,
    "Contrasena que `db:bootstrap` asigna a `lsw_migrator`.",
    { secret: true },
  ),
  v(
    "LSW_DB_APP_PASSWORD",
    "api",
    "string",
    NO_ENVIRONMENT,
    "Contrasena que `db:bootstrap` asigna a `lsw_app`.",
    { secret: true },
  ),
  v(
    "LSW_DB_READONLY_PASSWORD",
    "api",
    "string",
    NO_ENVIRONMENT,
    "Contrasena que `db:bootstrap` asigna a `lsw_readonly_report`. Opcional: sin ella el rol queda sin poder autenticarse.",
    { secret: true },
  ),

  // ----- Segundo factor (DEC-006, DEC-045) -----------------------------
  v(
    "MFA_SECRET_ENCRYPTION_KEY",
    "api",
    "string",
    // Obligatoria desde la fase 2: `apps/api` la exige en el arranque para
    // poder descifrar secretos TOTP. Sin ella el proceso no levanta, que es lo
    // correcto: un MFA que no puede verificarse no es un MFA degradado, es un
    // panel de administracion sin segundo factor.
    ALL_ENVIRONMENTS,
    "Clave AES-256 (32 bytes en base64url) con la que se cifra el secreto TOTP antes de persistirlo. Rotarla invalida todos los factores MFA inscritos.",
    { secret: true },
  ),

  // ----- Colas (DEC-020) -----------------------------------------------
  v("PGBOSS_SCHEMA", "api", "string", ALL_ENVIRONMENTS, "Esquema de pg-boss."),
  v("PGBOSS_POLL_INTERVAL_SECONDS", "api", "integer", ALL_ENVIRONMENTS, "Intervalo de sondeo."),
  v(
    "PGBOSS_DATABASE_URL",
    "api",
    "postgres_url",
    NO_ENVIRONMENT,
    "Vacio: reutiliza DATABASE_URL_APP.",
    { secret: true },
  ),
]);

const IDENTITY_VARS: readonly EnvVarSpec[] = Object.freeze([
  // ----- Identidad y sesiones (DEC-006) --------------------------------
  v(
    "SESSION_SECRET",
    "api",
    "string",
    ALL_ENVIRONMENTS,
    "Secreto de firma/derivacion de sesiones opacas. Rotable. Nunca en el repositorio.",
    { secret: true },
  ),
  v("SESSION_COOKIE_NAME", "api", "string", ALL_ENVIRONMENTS, "Nombre de la cookie de sesion."),
  v("SESSION_COOKIE_DOMAIN", "api", "string", ALL_ENVIRONMENTS, "Dominio de la cookie."),
  v(
    "SESSION_COOKIE_SECURE",
    "api",
    "boolean",
    ALL_ENVIRONMENTS,
    "false SOLO en desarrollo sobre http.",
  ),
  v("SESSION_TTL_MINUTES", "api", "integer", ALL_ENVIRONMENTS, "TTL de sesion de participante."),
  v(
    "ADMIN_SESSION_TTL_MINUTES",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "TTL de sesion administrativa, mas corto por politica.",
  ),
  v(
    "ADMIN_SESSION_IDLE_TIMEOUT_MINUTES",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "Inactividad maxima de una sesion administrativa.",
  ),
  v(
    "STEP_UP_MAX_AGE_SECONDS",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "DEC-006: antiguedad maxima del MFA para operaciones sensibles. Tope duro: 300.",
  ),
  v("ARGON2_MEMORY_KIB", "api", "integer", ALL_ENVIRONMENTS, "Argon2id: memoria."),
  v("ARGON2_TIME_COST", "api", "integer", ALL_ENVIRONMENTS, "Argon2id: iteraciones."),
  v("ARGON2_PARALLELISM", "api", "integer", ALL_ENVIRONMENTS, "Argon2id: paralelismo."),
  v("MFA_TOTP_ISSUER", "api", "string", ALL_ENVIRONMENTS, "Emisor mostrado en la app de TOTP."),
  v(
    "MFA_TOTP_WINDOW",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "Ventana de tolerancia TOTP, en pasos de 30 s.",
  ),
]);

const AUDIT_AND_EXPORT_VARS: readonly EnvVarSpec[] = Object.freeze([
  // ----- Auditoria y sellado externo (DEC-008) -------------------------
  v(
    "AUDIT_CHAIN_CANONICALIZATION_VERSION",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "Version de canonicalizacion de la hash chain. Cambiarla invalida la comparacion de hashes anteriores.",
  ),
  v(
    "AUDIT_CHAIN_VERIFIER_CRON",
    "api",
    "cron",
    DEPLOYED_ENVIRONMENTS,
    "Periodicidad del verificador de integridad.",
  ),
  v(
    "AUDIT_SEAL_STORAGE_ENDPOINT",
    "api",
    "url",
    DEPLOYED_ENVIRONMENTS,
    "Almacen externo write-once del sellado diario.",
  ),
  v("AUDIT_SEAL_STORAGE_BUCKET", "api", "string", DEPLOYED_ENVIRONMENTS, "Bucket de sellado."),
  v("AUDIT_SEAL_STORAGE_REGION", "api", "string", DEPLOYED_ENVIRONMENTS, "Region del bucket."),
  v(
    "AUDIT_SEAL_STORAGE_ACCESS_KEY_ID",
    "api",
    "string",
    DEPLOYED_ENVIRONMENTS,
    "Credencial de escritura del sellado. Fuera del alcance del rol de base de datos app.",
    { secret: true },
  ),
  v(
    "AUDIT_SEAL_STORAGE_SECRET_ACCESS_KEY",
    "api",
    "string",
    DEPLOYED_ENVIRONMENTS,
    "Credencial de escritura del sellado.",
    { secret: true },
  ),
  v(
    "AUDIT_SEAL_OBJECT_LOCK_REQUIRED",
    "api",
    "boolean",
    ALL_ENVIRONMENTS,
    "Exigir object-lock/WORM. En produccion no puede ser false.",
  ),

  // ----- Export y TPA (DEC-016) ----------------------------------------
  v(
    "EXPORT_STORAGE_ENDPOINT",
    "api",
    "url",
    DEPLOYED_ENVIRONMENTS,
    "Almacen write-once de exports.",
  ),
  v("EXPORT_STORAGE_BUCKET", "api", "string", DEPLOYED_ENVIRONMENTS, "Bucket de exports."),
  v(
    "EXPORT_SIGNING_KEY_ID",
    "api",
    "string",
    DEPLOYED_ENVIRONMENTS,
    "Identificador de la clave de firma desprendida.",
  ),
  v(
    "EXPORT_SIGNING_KEY_PATH",
    "api",
    "path",
    DEPLOYED_ENVIRONMENTS,
    "Ruta a la clave privada, SIEMPRE fuera del repositorio. En produccion la sirve el gestor de secretos.",
  ),
  v(
    "EXPORT_SCHEMA_VERSION",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "Version del esquema de export entregado al administrador externo.",
  ),
]);

const INTEGRATION_VARS: readonly EnvVarSpec[] = Object.freeze([
  // ----- Commerce y pagos ----------------------------------------------
  v(
    "PAYMENT_PROVIDER",
    "api",
    "string",
    ALL_ENVIRONMENTS,
    "Procesador de pagos. SIN DECIDIR (CLAUDE.md seccion 7): `none` mientras no exista su DEC.",
  ),
  v("PAYMENT_PROVIDER_API_BASE_URL", "api", "url", NO_ENVIRONMENT, "Base de la API del proveedor."),
  v("PAYMENT_PROVIDER_API_KEY", "api", "string", NO_ENVIRONMENT, "Credencial del proveedor.", {
    secret: true,
  }),
  v(
    "PAYMENT_WEBHOOK_SIGNING_SECRET",
    "api",
    "string",
    NO_ENVIRONMENT,
    "Verificacion de firma del webhook. Sin ella un tercero fabrica eventos de pago y, con ellos, entries.",
    { secret: true },
  ),
  v(
    "PAYMENT_WEBHOOK_TOLERANCE_SECONDS",
    "api",
    "integer",
    ALL_ENVIRONMENTS,
    "Tolerancia de reloj al validar la firma. Acota el replay.",
  ),
  v(
    "DEFAULT_CURRENCY",
    "shared",
    "string",
    ALL_ENVIRONMENTS,
    "Moneda por defecto. DEC-010: el dinero son enteros de unidad menor mas moneda explicita.",
  ),

  // ----- Email ----------------------------------------------------------
  v("EMAIL_PROVIDER", "api", "string", ALL_ENVIRONMENTS, "Proveedor de email. Sin decidir."),
  v("EMAIL_FROM_ADDRESS", "api", "email", ALL_ENVIRONMENTS, "Remitente."),
  v("EMAIL_FROM_NAME", "api", "string", ALL_ENVIRONMENTS, "Nombre del remitente."),
  v("EMAIL_PROVIDER_API_KEY", "api", "string", NO_ENVIRONMENT, "Credencial del proveedor.", {
    secret: true,
  }),

  // ----- Observabilidad -------------------------------------------------
  v("OTEL_ENABLED", "api", "boolean", ALL_ENVIRONMENTS, "Activar telemetria."),
  v("OTEL_EXPORTER_OTLP_ENDPOINT", "api", "url", NO_ENVIRONMENT, "Colector OTLP."),
  v("OTEL_SERVICE_NAME", "api", "string", ALL_ENVIRONMENTS, "Nombre del servicio en telemetria."),

  // ----- Tests (DEC-018) ------------------------------------------------
  v("TEST_DATABASE_URL", "test", "postgres_url", ["test"], "Base de datos de tests.", {
    secret: true,
  }),
  v(
    "TESTCONTAINERS_POSTGRES_IMAGE",
    "test",
    "string",
    ["test"],
    "Imagen de PostgreSQL real para los tests de ledger. Mocks y SQLite estan descartados.",
  ),
  v(
    "TESTCONTAINERS_RYUK_DISABLED",
    "test",
    "boolean",
    NO_ENVIRONMENT,
    "Recolector de contenedores.",
  ),
  v("E2E_BASE_URL", "test", "url", NO_ENVIRONMENT, "Base para Playwright."),
]);

export const ENV_REGISTRY: readonly EnvVarSpec[] = Object.freeze([
  ...RUNTIME_AND_DATA_VARS,
  ...IDENTITY_VARS,
  ...AUDIT_AND_EXPORT_VARS,
  ...INTEGRATION_VARS,
]);

export const ENV_REGISTRY_BY_NAME: ReadonlyMap<string, EnvVarSpec> = new Map(
  ENV_REGISTRY.map((spec) => [spec.name, spec]),
);

/**
 * Endurecimiento obligatorio en entornos desplegados.
 *
 * Cada regla existe porque su ausencia ya ha causado incidentes reales en
 * proyectos parecidos: cookies sin `Secure`, TLS sin verificar, CORS con
 * comodin, o un bucket de evidencia sin object-lock.
 */
export const PRODUCTION_HARDENING_RULES: readonly ProductionHardeningRule[] = Object.freeze([
  {
    name: "SESSION_COOKIE_SECURE",
    requirement: "MUST_EQUAL",
    value: "true",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale: "Una cookie de sesion sin Secure viaja en claro ante cualquier degradacion a http.",
  },
  // La postura de TLS tiene UNA fuente de verdad: DATABASE_SSL_MODE. En `pg`
  // la query de la cadena de conexion sobrescribe el objeto `ssl`
  // (`Object.assign({}, config, parse(connectionString))`), asi que un
  // `?sslmode=disable` colado en la URL anula verify-full sin que nada mas se
  // entere. Medido: `?sslmode=disable` -> ssl === false, conexion en claro.
  {
    name: "DATABASE_URL_APP",
    requirement: "MUST_NOT_CONTAIN",
    value: "sslmode=",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale:
      "Un sslmode en la cadena de conexion sobrescribe DATABASE_SSL_MODE en `pg` y puede dejar la conexion en claro mientras la validacion sigue diciendo verify-full.",
  },
  {
    name: "DATABASE_URL_SUPERUSER",
    requirement: "MUST_NOT_CONTAIN",
    value: "sslmode=",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale: "Misma razon, y sobre la conexion mas privilegiada del sistema: la del bootstrap.",
  },

  // DEC-043. Dos ramas, ninguna laxa: la unica diferencia es que sobre red
  // privada el certificado del proveedor es autofirmado y `verify-full` no
  // puede satisfacerse. `require` y `verify-ca` estan prohibidos en AMBAS: no
  // defienden del man-in-the-middle y ademas aparentan que si.
  {
    name: "DATABASE_SSL_MODE",
    requirement: "MUST_EQUAL",
    value: "verify-full",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    appliesWhen: { name: "DATABASE_NETWORK", equals: "public", whenAbsent: true },
    rationale: "Sin verify-full, TLS protege del sniffing pero no del man-in-the-middle.",
  },
  {
    name: "DATABASE_SSL_MODE",
    requirement: "MUST_EQUAL",
    value: "disable",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    appliesWhen: { name: "DATABASE_NETWORK", equals: "private", whenAbsent: false },
    rationale:
      "Sobre la red privada del proveedor la garantia es el aislamiento, no el certificado. Un TLS que no se verifica solo anadiria una falsa sensacion de seguridad.",
  },
  {
    name: "WEB_ENABLE_API_MOCKS",
    requirement: "MUST_NOT_EQUAL",
    value: "true",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale:
      "Con los mocks activos el portal responde con datos inventados. En una promocion eso significa ensenar a un participante un numero de entries que no existe en el ledger.",
  },
  {
    name: "API_CORS_ALLOWED_ORIGINS",
    requirement: "MUST_NOT_CONTAIN",
    value: "*",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale: "CORS con comodin convierte cualquier sitio en cliente autorizado de la API.",
  },
  {
    name: "AUDIT_SEAL_OBJECT_LOCK_REQUIRED",
    requirement: "MUST_EQUAL",
    value: "true",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale:
      "DEC-008: sin WORM en el almacen de sellado, quien tenga acceso total puede reescribir el pasado de forma coherente.",
  },
  {
    name: "API_PUBLIC_URL",
    requirement: "MUST_START_WITH",
    value: "https://",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale: "TLS obligatorio en cualquier entorno con datos de personas reales.",
  },
  {
    name: "WEB_PUBLIC_URL",
    requirement: "MUST_START_WITH",
    value: "https://",
    appliesTo: DEPLOYED_ENVIRONMENTS,
    rationale: "TLS obligatorio en el portal del participante.",
  },
  {
    name: "TESTCONTAINERS_RYUK_DISABLED",
    requirement: "MUST_NOT_EQUAL",
    value: "true",
    appliesTo: ["test"],
    rationale:
      "Sin Ryuk, los contenedores de test sobreviven al runner y contaminan la siguiente ejecucion.",
  },
]);
