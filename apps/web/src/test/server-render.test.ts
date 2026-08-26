import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * DEC-013 EN EL BUILD, NO SOLO EN EL CODIGO.
 *
 * DEC-013 exige que los feature flags legalmente materiales se lean EN EL
 * SERVIDOR, en la misma peticion que el render. Escribir el codigo asi no
 * basta: si Next prerenderiza la pagina durante el build, los valores quedan
 * congelados en el HTML y apagar la via gratuita de participacion no tendria
 * efecto hasta el siguiente despliegue. El codigo seria correcto y el
 * comportamiento no.
 *
 * Hoy eso no pasa porque las llamadas usan `cache: "no-store"`, lo que saca a
 * la ruta del prerender. Pero es una propiedad EMERGENTE: bastaria con anadir
 * un `revalidate` a una llamada para perderla, y el build seguiria en verde.
 *
 * Esta red convierte esa propiedad en una regla verificable: toda pagina que
 * lea configuracion de servidor debe declarar `force-dynamic`.
 *
 * (Se usa `fileURLToPath(import.meta.url)` y no `new URL(".", import.meta.url)`
 * por el mismo motivo documentado en `no-hardcoded-copy.test.ts`: Vite
 * reescribe ese segundo patron y dentro de Vitest no se evalua como esta
 * escrito.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIRECTORY = join(HERE, "..", "app");

/** Modulos cuya presencia implica lectura de configuracion de servidor. */
const SERVER_CONFIG_IMPORTS = ["@/lib/flags-server", "./flags-server"];

function listPageFiles(directory: string): string[] {
  const files: string[] = [];

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de import.meta.url, no de entrada de usuario
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPageFiles(full));
    } else if (entry.name === "page.tsx") {
      files.push(full);
    }
  }

  return files;
}

describe("paginas que leen configuracion de servidor (DEC-013)", () => {
  const pages = listPageFiles(APP_DIRECTORY);

  it("encuentra paginas que revisar", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it("toda pagina que lee feature flags se renderiza por peticion", () => {
    const offenders: string[] = [];

    for (const page of pages) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la propia estructura del repositorio
      const source = readFileSync(page, "utf8");

      const readsConfig = SERVER_CONFIG_IMPORTS.some((moduleName) => source.includes(moduleName));
      if (!readsConfig) continue;

      if (!source.includes('export const dynamic = "force-dynamic"')) {
        offenders.push(relative(APP_DIRECTORY, page));
      }
    }

    expect(
      offenders,
      `paginas que leen flags sin declarar force-dynamic:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("ninguna pagina lee los flags desde el cliente", () => {
    // DEC-013 prohibe expresamente leer un flag legalmente material desde el
    // navegador. Una pagina marcada como Client Component no puede llamar a la
    // lectura de servidor, pero el error seria facil de cometer y silencioso.
    const offenders: string[] = [];

    for (const page of pages) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la propia estructura del repositorio
      const source = readFileSync(page, "utf8");
      const isClient = /^\s*["']use client["']/m.test(source);

      if (isClient && SERVER_CONFIG_IMPORTS.some((name) => source.includes(name))) {
        offenders.push(relative(APP_DIRECTORY, page));
      }
    }

    expect(offenders, `paginas cliente que leen flags:\n${offenders.join("\n")}`).toEqual([]);
  });
});
