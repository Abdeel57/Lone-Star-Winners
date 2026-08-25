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
 *
 * IMPORTANTE sobre la construccion de los patrones: cuando se interpola un
 * fragmento hay que usar `String.raw`. En un template literal normal `\s` no es
 * una secuencia de escape valida y colapsa a la letra `s`, de modo que
 * `` `Math\s*\.\s*random` `` no produce el patron que aparenta sino
 * `Maths*.s*random`, que no detecta nada. Ese error tumbo este fichero entero
 * durante la FASE 1: `\(` colapsaba a `(` y el `new RegExp` lanzaba
 * "Unterminated group" al importarse, asi que el gate reportaba verde por
 * ausencia. Los patrones sin interpolacion se escriben como literales /.../,
 * donde el problema no existe.
 */

import { describe, expect, it } from "vitest";

import { listRepoTextFiles, readRepoFile, repoPathExists, repoRoot } from "../helpers/repo.js";
import { join } from "node:path";

const CRITICAL_PACKAGES = ["packages/security", "packages/tpa", "packages/sweepstakes"] as const;

const WEAK_SOURCES: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "math-random", pattern: new RegExp(String.raw`Math\s*\.\s*${"random"}\s*\(`) },
  { id: "pseudo-random-bytes", pattern: new RegExp(String.raw`${"pseudoRandom"}Bytes\s*\(`) },
  {
    id: "prng-sembrado",
    pattern: /from\s+["'](seedrandom|chance|random-seed|@faker-js\/faker)["']/,
  },
  // Un timestamp no es entropia. Aparece como semilla mas veces de lo que
  // deberia, precisamente porque parece inofensivo.
  { id: "timestamp-como-semilla", pattern: /seed\s*[:=]\s*Date\s*\.\s*now\s*\(/i },
];

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** Desactivaciones de la restriccion de aleatoriedad, en cualquiera de sus formas. */
const SUPPRESSION =
  /eslint-disable(?:-next-line|-line)?[^\n]*no-restricted-(?:properties|syntax|imports)/;

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
        SOURCE_FILE.test(file.path),
      );
      for (const file of files) {
        // `index` es el contador de un recorrido sobre el propio array: no es
        // una clave de origen externo.
        for (const [index, text] of readRepoFile(file.path).split("\n").entries()) {
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

  it("los propios patrones detectan lo que dicen detectar", () => {
    // Sin esta comprobacion, un patron mal construido convierte el test de
    // arriba en un gate que siempre pasa. Es exactamente lo que ocurrio.
    const byId = new Map(WEAK_SOURCES.map((source) => [source.id, source.pattern]));

    const mustMatch: readonly (readonly [string, string])[] = [
      ["math-random", "const n = Math.random();"],
      ["math-random", "const n = Math . random ();"],
      ["math-random", "return Math.random()"],
      ["pseudo-random-bytes", "const b = pseudoRandomBytes(16);"],
      ["pseudo-random-bytes", "pseudoRandomBytes (16)"],
      ["prng-sembrado", `import seedrandom from "seedrandom";`],
      ["prng-sembrado", `import { faker } from "@faker-js/faker";`],
      ["timestamp-como-semilla", "const rng = { seed: Date.now() };"],
      ["timestamp-como-semilla", "seed = Date . now ()"],
    ];
    for (const [id, sample] of mustMatch) {
      expect(byId.get(id)?.test(sample), `${id} deberia detectar: ${sample}`).toBe(true);
    }

    const mustNotMatch: readonly string[] = [
      "const bytes = randomBytes(32);",
      'import { randomInt } from "node:crypto";',
      "const createdAt = Date.now();",
      "// Math is not random here",
    ];
    for (const sample of mustNotMatch) {
      for (const source of WEAK_SOURCES) {
        expect(source.pattern.test(sample), `${source.id} no deberia detectar: ${sample}`).toBe(
          false,
        );
      }
    }
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
      for (const file of listRepoTextFiles(join(repoRoot(), packagePath))) {
        for (const [index, text] of readRepoFile(file.path).split("\n").entries()) {
          if (SUPPRESSION.test(text)) {
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
