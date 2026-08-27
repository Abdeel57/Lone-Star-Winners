/**
 * `pnpm --filter @lsw/database db:bootstrap`
 *
 * Deja una base de datos gestionada (Railway, DEC-043) lista para servir, en
 * un solo paso y de forma idempotente. Corre en cada despliegue.
 *
 * POR QUE EXISTE ESTE SCRIPT Y NO BASTA `db:migrate`
 * -------------------------------------------------
 * `db:migrate` exige `DATABASE_URL_MIGRATOR`, es decir el rol `lsw_migrator`.
 * En una base recien creada ese rol **todavia no existe**: lo crea la propia
 * migracion `0000_baseline.sql`. Y aunque existiera, se crea con `LOGIN` pero
 * SIN contrasena a proposito (principios 19 y 20 de `CLAUDE.md`: una
 * contrasena en una migracion es una contrasena versionada), de modo que no
 * puede autenticarse.
 *
 * Es un arranque en frio circular. En una instalacion autogestionada lo
 * resuelve el gestor de secretos antes del primer despliegue. En un proveedor
 * gestionado no hay tal momento: lo unico que existe desde el minuto cero es
 * el superusuario que crea el proveedor.
 *
 * Asi que este script hace, en orden:
 *
 *   1. Aplica las migraciones con el superusuario del proveedor. Es la
 *      desviacion de DEC-003 que DEC-043 documenta: en un Postgres gestionado
 *      no se puede separar `migrator` del propietario del esquema, porque el
 *      proveedor no cede la propiedad de `public`. La separacion que SI se
 *      conserva -y que es la que protege el ledger- es la del rol de la
 *      aplicacion: `lsw_app` nunca recibe UPDATE/DELETE sobre ledger ni
 *      auditoria, y eso lo garantizan los GRANT explicitos de cada migracion,
 *      que se aplican igual sea quien sea el que las ejecute.
 *
 *   2. Asigna contrasena a los tres roles. Las contrasenas llegan por entorno
 *      desde el gestor de variables del proveedor; este archivo no contiene
 *      ninguna, ni de ejemplo.
 *
 * Ejecutarlo dos veces no cambia nada: las migraciones ya aplicadas se saltan
 * y `ALTER ROLE` es idempotente.
 */

import { Client } from "pg";

import { runMigrations } from "../migrate.js";

interface RolePassword {
  readonly role: string;
  readonly password: string;
  readonly variable: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    console.error(`[bootstrap] Falta ${name}.`);
    process.exit(1);
  }

  return value;
}

/**
 * Asigna la contrasena sin interpolar nunca el valor en el texto del SQL.
 *
 * `ALTER ROLE ... PASSWORD $1` no es valido en PostgreSQL: la contrasena debe
 * ir como literal. Concatenarla a mano seria una inyeccion esperando a una
 * contrasena con comilla simple. El rodeo es pasarla como parametro a
 * `set_config` y dejar que `format('%L')` la escape dentro del motor.
 *
 * `set_config(..., true)` la limita a la transaccion en curso, de modo que no
 * queda en la sesion despues del `COMMIT`.
 */
async function setRolePassword(client: Client, entry: RolePassword): Promise<void> {
  await client.query("BEGIN");

  try {
    // Ni la contrasena ni el nombre del rol se concatenan al texto del SQL:
    // ambos viajan como parametros y los escapa `format` dentro del motor.
    await client.query("SELECT set_config('lsw.bootstrap_password', $1, true)", [entry.password]);
    await client.query("SELECT set_config('lsw.bootstrap_role', $1, true)", [entry.role]);
    await client.query(`
      DO $bootstrap$
      DECLARE
        target text := current_setting('lsw.bootstrap_role');
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target) THEN
          RAISE EXCEPTION 'El rol % no existe despues de migrar.', target;
        END IF;

        EXECUTE format(
          'ALTER ROLE %I WITH PASSWORD %L',
          target,
          current_setting('lsw.bootstrap_password')
        );
      END
      $bootstrap$;
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const superuserUrl = requireEnv("DATABASE_URL_SUPERUSER");

  /**
   * Sin valor por defecto, y a proposito.
   *
   * Este script es el `preDeployCommand`: corre ANTES de que arranque la api y
   * conecta con el SUPERUSUARIO. Un `?? "disable"` aqui significaba que una
   * variable mal escrita en el gestor de secretos abria la sesion mas
   * privilegiada del sistema en claro, y encima en silencio: la api se negaria
   * a arrancar despues (correcto), pero el bootstrap ya habria conectado. La
   * conexion mas privilegiada no puede ser la que menos se valida.
   */
  const sslMode = requireEnv("DATABASE_SSL_MODE");

  if (!["disable", "require", "verify-ca", "verify-full"].includes(sslMode)) {
    console.error(`[bootstrap] DATABASE_SSL_MODE invalido: ${sslMode}`);
    process.exit(1);
  }

  // Misma razon que en `apps/api/src/config/env.ts`: en `pg` la query de la
  // cadena de conexion SOBRESCRIBE el objeto `ssl`, asi que un `?sslmode=`
  // aqui anularia en silencio lo que se decida abajo.
  const tlsInQuery = [
    "sslmode",
    "ssl",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslnegotiation",
  ].filter((parameter) => {
    try {
      return new URL(superuserUrl).searchParams.has(parameter);
    } catch {
      return false;
    }
  });

  if (tlsInQuery.length > 0) {
    console.error(
      `[bootstrap] DATABASE_URL_SUPERUSER trae ${tlsInQuery.join(", ")} en la query, y en \`pg\` eso sobrescribe a DATABASE_SSL_MODE. Quitalo.`,
    );
    process.exit(1);
  }

  const useSsl = sslMode !== "disable";

  const passwords: readonly RolePassword[] = [
    {
      role: "lsw_migrator",
      password: requireEnv("LSW_DB_MIGRATOR_PASSWORD"),
      variable: "LSW_DB_MIGRATOR_PASSWORD",
    },
    {
      role: "lsw_app",
      password: requireEnv("LSW_DB_APP_PASSWORD"),
      variable: "LSW_DB_APP_PASSWORD",
    },
  ];

  const readonlyPassword = process.env.LSW_DB_READONLY_PASSWORD;
  const allPasswords =
    readonlyPassword === undefined || readonlyPassword.trim() === ""
      ? passwords
      : [
          ...passwords,
          {
            role: "lsw_readonly_report",
            password: readonlyPassword,
            variable: "LSW_DB_READONLY_PASSWORD",
          },
        ];

  console.error("[bootstrap] 1/2 aplicando migraciones forward-only...");
  await runMigrations({ connectionString: superuserUrl, ssl: useSsl });

  console.error("[bootstrap] 2/2 asignando contrasenas de rol (DEC-003)...");
  const client = new Client({
    connectionString: superuserUrl,
    ssl: useSsl ? { rejectUnauthorized: sslMode === "verify-full" } : false,
    application_name: "lsw-bootstrap",
  });

  await client.connect();

  try {
    for (const entry of allPasswords) {
      await setRolePassword(client, entry);
      console.error(`[bootstrap]   ${entry.role}: contrasena asignada desde ${entry.variable}`);
    }

    if (readonlyPassword === undefined || readonlyPassword.trim() === "") {
      console.error(
        "[bootstrap]   lsw_readonly_report: sin contrasena (LSW_DB_READONLY_PASSWORD no definida). No podra autenticarse hasta que se le asigne una.",
      );
    }
  } finally {
    await client.end();
  }

  console.error("[bootstrap] listo.");
}

main().catch((error: unknown) => {
  console.error("[bootstrap] fallo:", error);
  process.exit(1);
});
