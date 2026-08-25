/**
 * Configuracion de `drizzle-kit`.
 *
 * DEC-005: las migraciones son SQL forward-only escrito a mano. `drizzle-kit`
 * se usa para INSPECCIONAR (`drizzle-kit check`, y `generate` para leer el
 * diff contra el esquema TypeScript), nunca como generador de las migraciones
 * que se aplican, y NUNCA con `push`.
 *
 * El motivo esta en la propia decision: `security` debe poder abrir una
 * migracion en CI y comprobar que ninguna concede UPDATE o DELETE sobre las
 * tablas de ledger o auditoria. Con SQL generado y opaco eso no es posible.
 */

import { defineConfig } from "drizzle-kit";

const connectionString = process.env["DATABASE_URL_MIGRATOR"];

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    // Sin valor por defecto a proposito: preferimos que `drizzle-kit` falle a
    // que se conecte a una base de datos que nadie eligio.
    url: connectionString ?? "",
  },
});
