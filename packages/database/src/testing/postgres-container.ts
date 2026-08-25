/**
 * PostgreSQL real para los tests (DEC-018).
 *
 * DEC-018 descarta explicitamente mocks y SQLite para los tests de ledger,
 * concurrencia y rangos, y la razon vale igual para lo que ya existe hoy:
 * columnas GENERATED, triggers `plpgsql`, `GRANT` por columna, `EXCLUDE USING
 * gist` y `pg_advisory_xact_lock` no tienen equivalente simulado. Un test que
 * los sustituye por un doble no prueba nada de lo que importa.
 *
 * Requiere Docker en la maquina. Los tests que usan este helper viven bajo
 * `test/integration/` y corren con `pnpm test:integration`, separados de la
 * suite unitaria, que no necesita Docker.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { createDatabaseHandle, type DatabaseHandle, type DatabaseRole } from "../client.js";
import { runMigrations } from "../migrate.js";

const DEFAULT_IMAGE = "postgres:16-alpine";

export interface TestDatabase {
  readonly container: StartedPostgreSqlContainer;
  /** Cadena de conexion del superusuario del contenedor. */
  readonly superuserUrl: string;
  /** Abre una conexion con uno de los tres roles de DEC-003. */
  connectAs(role: DatabaseRole): DatabaseHandle;
  stop(): Promise<void>;
}

/**
 * Arranca PostgreSQL, aplica las migraciones y asigna contrasenas locales a
 * los tres roles.
 *
 * Las contrasenas se generan al vuelo por contenedor y nunca se escriben en
 * disco: un secreto de test versionado sigue siendo un secreto versionado
 * (principios 19 y 20).
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const image = process.env["TESTCONTAINERS_POSTGRES_IMAGE"] ?? DEFAULT_IMAGE;

  const container = await new PostgreSqlContainer(image)
    .withDatabase("lone_star_winners_test")
    .withUsername("lsw_test_superuser")
    // DEC-011: el contenedor corre en UTC, igual que produccion.
    .withEnvironment({ TZ: "UTC", PGTZ: "UTC" })
    .start();

  const superuserUrl = container.getConnectionUri();

  await runMigrations({ connectionString: superuserUrl, ssl: false });

  // Contrasenas efimeras, solo dentro de este contenedor.
  const { randomBytes } = await import("node:crypto");
  const passwords: Record<DatabaseRole, string> = {
    migrator: randomBytes(24).toString("base64url"),
    app: randomBytes(24).toString("base64url"),
    readonly_report: randomBytes(24).toString("base64url"),
  };

  const admin = createDatabaseHandle({
    role: "migrator",
    connectionString: superuserUrl,
    maxConnections: 1,
    statementTimeoutMs: 30_000,
    ssl: false,
    applicationName: "lsw-test-bootstrap",
  });

  try {
    const { sql } = await import("drizzle-orm");
    await admin.db.execute(
      sql.raw(`ALTER ROLE lsw_migrator WITH PASSWORD '${passwords.migrator}'`),
    );
    await admin.db.execute(sql.raw(`ALTER ROLE lsw_app WITH PASSWORD '${passwords.app}'`));
    await admin.db.execute(
      sql.raw(`ALTER ROLE lsw_readonly_report WITH PASSWORD '${passwords.readonly_report}'`),
    );
  } finally {
    await admin.close();
  }

  const roleUser: Record<DatabaseRole, string> = {
    migrator: "lsw_migrator",
    app: "lsw_app",
    readonly_report: "lsw_readonly_report",
  };

  const open: DatabaseHandle[] = [];

  return {
    container,
    superuserUrl,
    connectAs(role: DatabaseRole): DatabaseHandle {
      const url = new URL(superuserUrl);
      url.username = roleUser[role];
      url.password = passwords[role];

      const handle = createDatabaseHandle({
        role,
        connectionString: url.toString(),
        maxConnections: 4,
        statementTimeoutMs: 30_000,
        ssl: false,
        applicationName: `lsw-test-${role}`,
      });
      open.push(handle);
      return handle;
    },
    stop: async () => {
      await Promise.all(open.map((handle) => handle.close()));
      await container.stop();
    },
  };
}
