/**
 * PostgreSQL real para los tests (DEC-018).
 *
 * DEC-018 descarta explicitamente mocks y SQLite para los tests de ledger,
 * concurrencia y rangos, y la razon vale igual para lo que ya existe hoy:
 * columnas GENERATED, triggers `plpgsql`, `GRANT` por columna, `EXCLUDE USING
 * gist` y `pg_advisory_xact_lock` no tienen equivalente simulado. Un test que
 * los sustituye por un doble no prueba nada de lo que importa.
 *
 * DOS VIAS PARA LLEGAR AL MISMO POSTGRESQL
 * ----------------------------------------
 * `startTestDatabase()` elige sola, y la eleccion la decide UNA variable:
 *
 *   TEST_DATABASE_URL sin declarar  -> Testcontainers. Levanta un contenedor
 *                                      por fichero de test. Necesita Docker.
 *                                      Es el camino de siempre en local y no
 *                                      cambia en nada.
 *
 *   TEST_DATABASE_URL declarada     -> instancia EXTERNA ya en marcha. No hay
 *                                      contenedor que levantar: se crea una
 *                                      base de datos nueva por llamada dentro
 *                                      de ese cluster, se migra, y se destruye
 *                                      al terminar.
 *
 * POR QUE HACIA FALTA LA SEGUNDA VIA
 *   Los tests de `test/integration/**` se escribieron y nunca se han ejecutado:
 *   la maquina de desarrollo no tiene Docker, asi que Testcontainers no arranca
 *   (HO-015, HO-030). GitHub Actions si puede dar un `services: postgres:16`,
 *   que es un PostgreSQL de verdad SIN Docker-in-Docker. Esta via es lo que
 *   permite que CI ejecute lo que la maquina local no puede, sin tocar una sola
 *   linea de los tests.
 *
 * LO QUE LAS DOS VIAS GARANTIZAN POR IGUAL
 *   1. Base de datos VIRGEN por llamada. Cinco ficheros de test comparten
 *      cluster en la via externa, pero no base de datos: cada uno crea la suya
 *      con nombre aleatorio y la destruye en `stop()`. Un fichero no puede ver
 *      las filas de otro, igual que con un contenedor por fichero.
 *   2. Las MISMAS migraciones, en el mismo orden, con el mismo runner.
 *   3. Los TRES roles de DEC-003 con contrasenas efimeras generadas al vuelo.
 *      Nunca se escriben en disco: un secreto de test versionado sigue siendo
 *      un secreto versionado (principios 19 y 20).
 *
 * POR QUE LA VIA EXTERNA SOLO ADMITE UN HOST LOCAL
 *   Este modulo hace `CREATE DATABASE` y `DROP DATABASE ... WITH (FORCE)` con
 *   un rol administrativo. Apuntarlo por descuido a un cluster compartido -o a
 *   uno real- destruiria datos ajenos, y la unica proteccion util contra eso es
 *   no permitir que la URL salga de la maquina. Un servicio de CI siempre esta
 *   en `127.0.0.1`; una base de produccion nunca. La comprobacion es una linea
 *   y cierra la clase de accidente entera.
 */

import { randomBytes } from "node:crypto";

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";

import { createDatabaseHandle, type DatabaseHandle, type DatabaseRole } from "../client.js";
import { runMigrations } from "../migrate.js";

const DEFAULT_IMAGE = "postgres:16-alpine";

/** Nombre del rol de PostgreSQL detras de cada rol logico de DEC-003. */
const ROLE_USER: Record<DatabaseRole, string> = {
  migrator: "lsw_migrator",
  app: "lsw_app",
  readonly_report: "lsw_readonly_report",
};

const ALL_ROLES = ["migrator", "app", "readonly_report"] as const;

/** Hosts que se consideran locales para la via externa. Ver la cabecera. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface TestDatabase {
  /**
   * El contenedor, cuando lo hay.
   *
   * `null` en la via externa: no existe contenedor que parar, y devolver un
   * objeto falso que finge serlo seria peor que decir la verdad. Ningun test
   * lo usa hoy; si alguno lo necesitara, tendra que decidir explicitamente que
   * hace cuando no hay contenedor.
   */
  readonly container: StartedPostgreSqlContainer | null;
  /** Como se ha conseguido el PostgreSQL de este handle. */
  readonly mode: "testcontainers" | "external";
  /** Cadena de conexion administrativa APUNTANDO A LA BASE DE ESTE TEST. */
  readonly superuserUrl: string;
  /** Abre una conexion con uno de los tres roles de DEC-003. */
  connectAs(role: DatabaseRole): DatabaseHandle;
  stop(): Promise<void>;
}

/** Contrasenas efimeras, distintas en cada llamada, nunca persistidas. */
function generateRolePasswords(): Record<DatabaseRole, string> {
  return {
    migrator: randomBytes(24).toString("base64url"),
    app: randomBytes(24).toString("base64url"),
    readonly_report: randomBytes(24).toString("base64url"),
  };
}

/**
 * Asigna las contrasenas efimeras a los tres roles de DEC-003.
 *
 * Se hace DESPUES de migrar porque es `0000_baseline.sql` quien crea los roles,
 * y los crea SIN contrasena a proposito: una contrasena dentro de una migracion
 * seria una contrasena versionada.
 *
 * Los roles son objetos de CLUSTER, no de base de datos, asi que en la via
 * externa esta sentencia afecta a todo el cluster. Es correcto: el cluster es
 * el servicio efimero del job de CI, y los ficheros de test corren en serie
 * (`fileParallelism: false` en `vitest.config.ts`).
 */
async function assignRolePasswords(
  adminUrl: string,
  passwords: Record<DatabaseRole, string>,
): Promise<void> {
  const admin = createDatabaseHandle({
    role: "migrator",
    connectionString: adminUrl,
    maxConnections: 1,
    statementTimeoutMs: 30_000,
    ssl: false,
    applicationName: "lsw-test-bootstrap",
  });

  try {
    for (const role of ALL_ROLES) {
      // Interpolacion cruda inevitable: PostgreSQL no admite parametros en
      // `ALTER ROLE`. El valor no viene de fuera -lo acaba de generar
      // `randomBytes(...).toString("base64url")`, alfabeto `[A-Za-z0-9_-]`- asi
      // que no puede contener una comilla que escape del literal.
      await admin.db.execute(
        sql.raw(`ALTER ROLE ${ROLE_USER[role]} WITH PASSWORD '${passwords[role]}'`),
      );
    }
  } finally {
    await admin.close();
  }
}

/**
 * Construye la cadena de conexion de un rol a partir de la administrativa:
 * mismo host, mismo puerto, MISMA base de datos, otro usuario.
 */
function connectionStringForRole(
  baseUrl: string,
  role: DatabaseRole,
  passwords: Record<DatabaseRole, string>,
): string {
  const url = new URL(baseUrl);
  url.username = ROLE_USER[role];
  url.password = passwords[role];
  return url.toString();
}

function openRoleHandle(
  baseUrl: string,
  role: DatabaseRole,
  passwords: Record<DatabaseRole, string>,
): DatabaseHandle {
  return createDatabaseHandle({
    role,
    connectionString: connectionStringForRole(baseUrl, role, passwords),
    maxConnections: 4,
    statementTimeoutMs: 30_000,
    ssl: false,
    applicationName: `lsw-test-${role}`,
  });
}

/**
 * Via 1: Testcontainers. Un contenedor por llamada. Requiere Docker.
 *
 * El comportamiento es exactamente el que tenia antes de existir la via
 * externa. Lo unico que ha cambiado es que el import de
 * `@testcontainers/postgresql` es dinamico, para que la via externa no cargue
 * la libreria -ni su sondeo de Docker- en un entorno donde Docker no existe.
 */
async function startContainerTestDatabase(): Promise<TestDatabase> {
  const image = process.env.TESTCONTAINERS_POSTGRES_IMAGE ?? DEFAULT_IMAGE;

  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");

  const container = await new PostgreSqlContainer(image)
    .withDatabase("lone_star_winners_test")
    .withUsername("lsw_test_superuser")
    // DEC-011: el contenedor corre en UTC, igual que produccion.
    .withEnvironment({ TZ: "UTC", PGTZ: "UTC" })
    .start();

  const superuserUrl = container.getConnectionUri();

  await runMigrations({ connectionString: superuserUrl, ssl: false });

  const passwords = generateRolePasswords();
  await assignRolePasswords(superuserUrl, passwords);

  const open: DatabaseHandle[] = [];

  return {
    container,
    mode: "testcontainers",
    superuserUrl,
    connectAs(role: DatabaseRole): DatabaseHandle {
      const handle = openRoleHandle(superuserUrl, role, passwords);
      open.push(handle);
      return handle;
    },
    stop: async () => {
      await Promise.all(open.map((handle) => handle.close()));
      await container.stop();
    },
  };
}

/**
 * Via 2: instancia externa ya en marcha (el `services: postgres:16` de CI).
 *
 * `adminUrl` debe apuntar a un rol que pueda `CREATE DATABASE` y `ALTER ROLE`
 * -en el servicio de CI, el superusuario del propio servicio-. No se crea
 * ningun rol nuevo: los tres de DEC-003 los crea `0000_baseline.sql`, con
 * guarda de existencia, asi que sobreviven a que varias bases del mismo
 * cluster los compartan.
 */
async function startExternalTestDatabase(adminUrl: string): Promise<TestDatabase> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "startTestDatabase(): TEST_DATABASE_URL con NODE_ENV=production. Este helper crea y DESTRUYE bases de datos; no se ejecuta contra produccion.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL no es una URL de conexion valida.");
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `TEST_DATABASE_URL apunta a ${parsed.hostname}, que no es un host local. Esta via hace CREATE DATABASE y DROP DATABASE: solo se permite un cluster efimero en la propia maquina (el servicio de CI escucha en 127.0.0.1).`,
    );
  }

  // Base de datos virgen por llamada. El nombre es aleatorio para que dos
  // ficheros de test -o dos ejecuciones- no puedan pisarse.
  const databaseName = `lsw_it_${randomBytes(8).toString("hex")}`;

  const bootstrap = createDatabaseHandle({
    role: "migrator",
    connectionString: adminUrl,
    maxConnections: 1,
    statementTimeoutMs: 60_000,
    ssl: false,
    applicationName: "lsw-test-external-bootstrap",
  });

  try {
    // Sin parametros: PostgreSQL no los admite en `CREATE DATABASE`. El nombre
    // sale de `randomBytes(...).toString("hex")`, luego es `lsw_it_` seguido de
    // 16 caracteres de `[0-9a-f]`. No hay nada que escapar.
    await bootstrap.db.execute(sql.raw(`CREATE DATABASE ${databaseName}`));
  } finally {
    await bootstrap.close();
  }

  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${databaseName}`;
  const superuserUrl = testUrl.toString();

  await runMigrations({ connectionString: superuserUrl, ssl: false });

  const passwords = generateRolePasswords();
  await assignRolePasswords(superuserUrl, passwords);

  const open: DatabaseHandle[] = [];

  return {
    container: null,
    mode: "external",
    superuserUrl,
    connectAs(role: DatabaseRole): DatabaseHandle {
      const handle = openRoleHandle(superuserUrl, role, passwords);
      open.push(handle);
      return handle;
    },
    stop: async () => {
      await Promise.all(open.map((handle) => handle.close()));

      const cleanup = createDatabaseHandle({
        role: "migrator",
        connectionString: adminUrl,
        maxConnections: 1,
        statementTimeoutMs: 60_000,
        ssl: false,
        applicationName: "lsw-test-external-cleanup",
      });

      try {
        // `WITH (FORCE)` (PostgreSQL 13+) expulsa a las conexiones que hayan
        // quedado vivas. Sin el, una sola conexion colgada convierte el
        // `DROP DATABASE` en un fallo del `afterAll` y enmascara el resultado
        // real de la suite.
        await cleanup.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`));
      } finally {
        await cleanup.close();
      }
    },
  };
}

/**
 * Arranca PostgreSQL, aplica las migraciones y asigna contrasenas locales a
 * los tres roles.
 *
 * Elige via segun `TEST_DATABASE_URL`. Ver la cabecera del modulo.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;

  if (external !== undefined && external.trim() !== "") {
    return startExternalTestDatabase(external.trim());
  }

  return startContainerTestDatabase();
}
