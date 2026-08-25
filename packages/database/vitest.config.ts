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
    // `fileParallelism` es una opcion de RAIZ en Vitest 3: dentro de un
    // `projects[].test` ni siquiera existe en el tipo, y ponerla ahi no
    // desactivaba nada. Vive aqui porque es donde surte efecto.
    //
    // Quien la necesita es la suite `integration`: comparte un unico
    // contenedor de PostgreSQL, asi que paralelizar por fichero multiplica la
    // memoria sin acelerar nada. La suite `unit` audita tres ficheros de
    // texto; correrlos en serie evita ademas levantar varios workers.
    fileParallelism: false,
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
