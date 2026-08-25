/**
 * INVARIANTE: aleatoriedad debil prohibida donde puede influir en quien gana.
 *
 * DEC-017, cerrojo 5, y DEC-018. ESLint ya lo prohibe, pero una regla de lint
 * se desactiva con un comentario en una linea. Este test mira el codigo
 * resultante, y ademas comprueba que la propia regla sigue existiendo: si
 * alguien la borra de `eslint.config.mjs`, el gate de lint dejaria de fallar en
 * silencio y nadie se enteraria.
 *
 * Los patrones se construyen concatenando fragmentos para que este fichero no
 * se detecte a si mismo.
 */

import { describe, expect, it } from "vitest";

import { listRepoTextFiles, readRepoFile, repoPathExists, repoRoot } from "../helpers/repo.js";
import { join } from "node:path";

const CRITICAL_PACKAGES = ["packages/security", "packages/tpa", "packages/sweepstakes"] as const;

const WEAK_SOURCES: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "math-random", pattern: new RegExp(`Math\s*\.\s*${"random"}\s*\(`) },
  { id: "pseudo-random-bytes", pattern: new RegExp(`${"pseudoRandom"}Bytes\s*\(`) },
  {
    id: "prng-sembrado",
    pattern: /from\s+["'](seedrandom|chance|random-seed|@faker-js\/faker)["']/,
  },
  // Un timestamp no es entropia. Aparece como semilla mas veces de lo que
  // deberia, precisamente porque parece inofensivo.
  { id: "timestamp-como-semilla", pattern: /seed\s*[:=]\s*Date\s*\.\s*now\s*\(/i },
];

describe("DEC-017: solo CSPRNG en los paquetes que pueden influir en un sorteo", () => {
  it("ningun paquete critico usa aleatoriedad debil o sembrada", () => {
    const offences: string[] = [];

    for (const packagePath of CRITICAL_PACKAGES) {
      if (!repoPathExists(packagePath)) {
        // El paquete todavia no existe (packages/sweepstakes es de `backend`).
        // El test seguira vigilandolo en cuanto aparezca.
        continue;
      }
      const files = listRepoTextFiles(join(repoRoot(), packagePath)).filter((file) =>
        /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file.path),
      );
      for (const file of files) {
        const lines = readRepoFile(file.path).split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          const text = lines[index] ?? "";
          for (const source of WEAK_SOURCES) {
            if (source.pattern.test(text)) {
              offences.push(`${file.path}:${String(index + 1)} [${source.id}] ${text.trim()}`);
            }
          }
        }
      }
    }

    expect(offences, `Aleatoriedad no criptografica:\n${offences.join("\n")}`).toStrictEqual([]);
  });

  it("la regla de ESLint que lo prohibe sigue en la configuracion raiz", () => {
    expect(repoPathExists("eslint.config.mjs")).toBe(true);
    const config = readRepoFile("eslint.config.mjs");

    for (const packagePath of CRITICAL_PACKAGES) {
      expect(
        config.includes(packagePath),
        `${packagePath} ya no aparece en la lista de paquetes con aleatoriedad restringida.`,
      ).toBe(true);
    }

    expect(
      /no-restricted-properties|no-restricted-syntax/.test(config),
      "Ha desaparecido la restriccion de aleatoriedad de eslint.config.mjs (DEC-017/DEC-018).",
    ).toBe(true);
  });

  it("nadie desactiva la regla con un comentario suelto", () => {
    const suppressions: string[] = [];
    for (const packagePath of CRITICAL_PACKAGES) {
      if (!repoPathExists(packagePath)) {
        continue;
      }
      const files = listRepoTextFiles(join(repoRoot(), packagePath));
      for (const file of files) {
        const lines = readRepoFile(file.path).split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          const text = lines[index] ?? "";
          if (/eslint-disable[^\n]*no-restricted-(properties|syntax|imports)/.test(text)) {
            suppressions.push(`${file.path}:${String(index + 1)}`);
          }
        }
      }
    }
    expect(
      suppressions,
      `Supresiones de la regla de aleatoriedad:\n${suppressions.join("\n")}`,
    ).toStrictEqual([]);
  });
});
