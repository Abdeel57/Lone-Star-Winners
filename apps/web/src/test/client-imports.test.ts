import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Un componente de cliente no importa VALORES de la capa HTTP de la API.
 *
 * El indice `@/lib/api` reexporta `http.ts`, que lee `next/headers` para
 * reenviar la IP del visitante (DEC-061). Si un componente `"use client"`
 * importa de ahi una funcion o una constante, Next mete `http.ts` en el bundle
 * del navegador y el build falla con "You're importing a component that needs
 * next/headers". Asi cayo el despliegue de d2d3c85: los tests pasaban y solo
 * `next build` lo vio.
 *
 * Los TIPOS si pueden venir del indice (`import type` se borra al compilar).
 * Los valores, de la hoja: `localized`, `contract`, `admin-contract`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIRECTORY = join(HERE, "..");

/** Modulos que arrastran `http.ts` al importarse. */
const SERVER_API_MODULES = new Set([
  "@/lib/api",
  "@/lib/api/index",
  "@/lib/api/http",
  "@/lib/api/resources",
  "@/lib/api/visitor-address",
]);

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de import.meta.url, no de entrada de usuario
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test" && entry.name !== "mocks") files.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/u.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Importaciones de un modulo que traen algun VALOR (no solo tipos). */
function valueImportsFrom(source: string): string[] {
  const found: string[] = [];
  const pattern = /import\s+(type\s)?\s*\{([^}]*)\}\s+from\s+"([^"]+)"/gu;
  for (const match of source.matchAll(pattern)) {
    const [, typeOnly, specifiers = "", moduleName = ""] = match;
    if (typeOnly !== undefined || !SERVER_API_MODULES.has(moduleName)) continue;
    const values = specifiers
      .split(",")
      .map((specifier) => specifier.trim())
      .filter((specifier) => specifier.length > 0 && !specifier.startsWith("type "));
    if (values.length > 0) found.push(`${moduleName}: ${values.join(", ")}`);
  }
  return found;
}

describe("componentes de cliente y la capa HTTP de la API (DEC-061)", () => {
  const clientFiles = listSourceFiles(SOURCE_DIRECTORY).filter((file) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la propia estructura del repositorio
    /^\s*["']use client["']/u.test(readFileSync(file, "utf8")),
  );

  it("encuentra componentes de cliente que revisar", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it("ninguno importa valores de un modulo que arrastra http.ts", () => {
    const offenders = clientFiles.flatMap((file) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la propia estructura del repositorio
      valueImportsFrom(readFileSync(file, "utf8")).map(
        (detail) => `${relative(SOURCE_DIRECTORY, file)} -> ${detail}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("la regla detecta el caso que tumbo el build", () => {
    expect(
      valueImportsFrom('import { pickLocalized, type ProductDetail } from "@/lib/api";'),
    ).toEqual(["@/lib/api: pickLocalized"]);
    expect(valueImportsFrom('import type { ProductDetail } from "@/lib/api";')).toEqual([]);
    expect(valueImportsFrom('import { pickLocalized } from "@/lib/api/localized";')).toEqual([]);
  });
});
