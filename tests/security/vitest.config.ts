import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Los tests de invariante leen el repositorio: sin aislamiento por hilos
    // no aportan nada y el arranque es mas lento.
    pool: "forks",
    reporters: ["default"],
  },
});
