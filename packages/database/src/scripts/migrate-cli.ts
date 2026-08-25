/**
 * `pnpm --filter @lsw/database db:migrate`
 *
 * Exige `DATABASE_URL_MIGRATOR`. Si falta, el proceso NO arranca: aplicar
 * migraciones con la conexion equivocada es mas caro de deshacer que de
 * prevenir (DEC-018, esquema de entorno validado en boot).
 */

import { runMigrations } from "../migrate.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_MIGRATOR;

  if (connectionString === undefined || connectionString.trim() === "") {
    console.error(
      "[migrate] Falta DATABASE_URL_MIGRATOR. DEC-003: las migraciones corren con el rol `migrator`, nunca con `app`.",
    );
    process.exit(1);
  }

  const sslMode = process.env.DATABASE_SSL_MODE ?? "disable";

  console.error("[migrate] aplicando migraciones forward-only...");
  await runMigrations({ connectionString, ssl: sslMode !== "disable" });
  console.error("[migrate] listo.");
}

main().catch((error: unknown) => {
  console.error("[migrate] fallo:", error);
  process.exit(1);
});
