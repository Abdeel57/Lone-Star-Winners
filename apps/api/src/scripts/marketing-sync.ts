/**
 * Una pasada del sincronizador de contactos (DEC-099).
 *
 *   pnpm --filter @lsw/api marketing:sync
 *
 * No esta conectado a ningun cron ni al arranque de la API. Con
 * `MARKETING_SYNC_MODE=off`, que es el valor por defecto, no toca nada. Imprime
 * solo cifras: ni direcciones ni identificadores.
 */

import { createDatabaseHandle } from "@lsw/database";

import { loadConfig } from "../config/env.js";
import { createMarketingRepository } from "../services/drizzle-marketing.js";
import { runMarketingSync } from "../services/marketing-sync.js";
import { createResendMarketingProvider } from "../services/resend-marketing.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const sync = config.marketing.sync;

  const database = createDatabaseHandle({
    role: "app",
    connectionString: config.database.appUrl,
    maxConnections: 2,
    statementTimeoutMs: config.database.statementTimeoutMs,
    ssl:
      config.database.sslMode === "disable"
        ? false
        : { rejectUnauthorized: config.database.sslMode === "verify-full" },
    applicationName: "lsw-marketing-sync",
  });

  try {
    const report = await runMarketingSync({
      config: sync,
      repository: createMarketingRepository(database.db),
      // Solo en `live`: `dry_run` no tiene con que llamar al proveedor.
      provider:
        sync.mode === "live" && sync.apiKey !== null
          ? createResendMarketingProvider({ apiKey: sync.apiKey })
          : null,
      now: () => new Date(),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "marketing_sync_failed");
  process.exitCode = 1;
});
