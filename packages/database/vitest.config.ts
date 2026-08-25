import { defineConfig } from "vitest/config";

/**
 * Dos suites separadas a proposito.
 *
 *   unit ......... no necesita Docker. Verifica que el SQL, el esquema
 *                  TypeScript y los catalogos de dominio no han divergido, y
 *                  audita el texto de las migraciones. Corre en cada commit.
 *
 *   integration .. levanta PostgreSQL 16 real con Testcontainers (DEC-018) y
 *                  comprueba lo que no se puede simular: triggers, columnas
 *                  GENERATED, GRANT por columna y transiciones de estado.
 *                  Necesita Docker.
 *
 * DEC-018 descarta mocks y SQLite para lo que importa. La suite unitaria de
 * aqui no los usa como sustituto de la base de datos: audita ARCHIVOS.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/*.test.ts"],
          environment: "node",
          restoreMocks: true,
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/*.int.test.ts"],
          environment: "node",
          restoreMocks: true,
          // Arrancar el contenedor y aplicar las migraciones no es rapido.
          testTimeout: 180_000,
          hookTimeout: 180_000,
          // Un solo contenedor compartido: paralelizar aqui multiplica la
          // memoria sin acelerar nada.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
});
