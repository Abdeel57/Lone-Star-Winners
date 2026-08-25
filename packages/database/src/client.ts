/**
 * Conexion a PostgreSQL.
 *
 * DEC-003 exige tres roles diferenciados, y este modulo hace que esa
 * separacion sea visible en el codigo: para obtener una conexion hay que decir
 * con QUE rol, y el tipo no admite un valor por defecto. Un pool generico
 * llamado `db` acabaria usandose para migrar, para servir peticiones y para
 * generar informes, y la separacion de DEC-003 seria decorativa.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema/index.js";

/** DEC-003. El nombre coincide con el sufijo de la variable de entorno correspondiente. */
export type DatabaseRole = "migrator" | "app" | "readonly_report";

export interface DatabaseConnectionOptions {
  readonly role: DatabaseRole;
  readonly connectionString: string;
  readonly maxConnections: number;
  /**
   * DEC-018 (fiabilidad operativa): una consulta sin limite puede bloquear una
   * fila de promocion durante minutos. El limite se aplica en la conexion, no
   * confiando en que cada consulta se acuerde.
   */
  readonly statementTimeoutMs: number;
  readonly ssl: PoolConfig["ssl"];
  /** Aparece en `pg_stat_activity`: permite saber que proceso abrio cada conexion. */
  readonly applicationName: string;
}

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly role: DatabaseRole;
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * DEC-011: cada conexion fija `UTC` explicitamente.
 *
 * Sin esto, el `timezone` efectivo lo decide la configuracion del servidor o
 * la del rol, y dos entornos podrian evaluar el mismo deadline de forma
 * distinta. La zona legal de la promocion se aplica al comparar, no al
 * conectar.
 */
function buildStartupOptions(statementTimeoutMs: number): string {
  return [
    "-c timezone=UTC",
    `-c statement_timeout=${String(statementTimeoutMs)}`,
    // Un `idle_in_transaction` largo mantiene locks vivos sobre filas de
    // promocion y bloquea las migraciones.
    `-c idle_in_transaction_session_timeout=${String(statementTimeoutMs * 2)}`,
  ].join(" ");
}

export function createDatabaseHandle(options: DatabaseConnectionOptions): DatabaseHandle {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections,
    application_name: options.applicationName,
    ssl: options.ssl,
    options: buildStartupOptions(options.statementTimeoutMs),
  });

  const db = drizzle(pool, { schema, casing: "snake_case" });

  return {
    role: options.role,
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export { schema };
