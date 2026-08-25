/**
 * `pnpm --filter @lsw/database db:seed`
 *
 * Siembra datos de desarrollo con el rol `app`, no con `migrator`. Es
 * deliberado: si la semilla necesitara privilegios de DDL para funcionar,
 * significaria que los GRANT de DEC-003 estan mal repartidos, y este script lo
 * detecta antes que un incidente en produccion.
 *
 * Se niega a ejecutarse con `NODE_ENV=production`.
 */

import { createDatabaseHandle } from "../client.js";
import { seedDevelopmentData } from "../seed/dev-seed.js";

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    console.error(
      "[seed] Rechazado: esta semilla es de desarrollo y nunca debe correr contra produccion.",
    );
    process.exit(1);
  }

  const connectionString = process.env["DATABASE_URL_APP"];
  if (connectionString === undefined || connectionString.trim() === "") {
    console.error("[seed] Falta DATABASE_URL_APP.");
    process.exit(1);
  }

  const handle = createDatabaseHandle({
    role: "app",
    connectionString,
    maxConnections: 1,
    statementTimeoutMs: 60_000,
    ssl: false,
    applicationName: "lsw-dev-seed",
  });

  try {
    const result = await seedDevelopmentData(handle.db);
    console.error("[seed] datos ficticios creados:", {
      identities: result.identities,
      participants: result.participants,
      adminUsers: result.adminUsers,
      promotions: result.promotions,
      products: result.products,
    });
    for (const warning of result.warnings) {
      console.error("[seed] aviso:", warning);
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] fallo:", error);
  process.exit(1);
});
