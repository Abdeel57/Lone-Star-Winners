/**
 * Runner de migraciones (DEC-005: SQL forward-only, sin `db push`).
 *
 * Corre SIEMPRE con el rol `migrator`. Si se ejecutara con el rol `app`, el
 * DDL fallaria -que es exactamente lo que debe pasar- porque `app` no tiene
 * CREATE sobre el esquema.
 *
 * Las migraciones son SQL plano escrito a mano. `drizzle-kit generate` se usa
 * para inspeccionar diferencias contra el esquema TypeScript, nunca como
 * fuente de las migraciones: DEC-005 exige que un auditor externo pueda leer
 * los `GRANT`, los `CHECK` y los triggers directamente en el archivo.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseHandle } from "./client.js";

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export interface RunMigrationsOptions {
  readonly connectionString: string;
  readonly ssl?: boolean | undefined;
  readonly statementTimeoutMs?: number | undefined;
}

export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const handle = createDatabaseHandle({
    role: "migrator",
    connectionString: options.connectionString,
    maxConnections: 1,
    // El DDL con backfill puede tardar mas que una peticion HTTP; por eso el
    // limite del migrator no es el de la aplicacion.
    statementTimeoutMs: options.statementTimeoutMs ?? 300_000,
    ssl: options.ssl === true ? { rejectUnauthorized: true } : false,
    applicationName: "lsw-migrator",
  });

  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}
