import { defineConfig } from "vitest/config";

/**
 * Dos suites, como en `packages/database`.
 *
 *   unit ......... sin base de datos: los handlers con sus puertos sustituidos.
 *                  Corre en cada commit (`pnpm test`).
 *
 *   integration .. la aplicacion REAL contra PostgreSQL real (DEC-018): rutas,
 *                  sesiones, ledger y export de punta a punta. Necesita
 *                  `TEST_DATABASE_URL` o Docker (`pnpm test:integration`).
 *
 * Separadas porque `test/**` incluiria tambien `test/integration/*.int.test.ts`,
 * y una prueba de integracion sin base de datos no prueba nada: falla.
 */
export default defineConfig({
  test: {
    // En la RAIZ, como en `packages/database`: en Vitest 3 dentro de
    // `projects[].test` no surte efecto. La suite `integration` lo necesita:
    // cada fichero arranca su base con `startTestDatabase`, que cambia las
    // contrasenas de los roles de TODO el cluster (son objetos de cluster). Con
    // dos ficheros en paralelo, el segundo invalida las del primero y sus
    // conexiones nuevas fallan con 500. Con un solo fichero no se notaba; con
    // `guest-cart.int.test.ts` (DEC-079) el CI se puso rojo.
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
          // Migrar una base nueva y montar la aplicacion no es rapido.
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
