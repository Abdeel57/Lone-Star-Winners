import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * TEXTO VISIBLE FUERA DEL DICCIONARIO (DEC-021).
 *
 * DEC-021 pide que el build falle "si queda una cadena literal visible fuera
 * del diccionario". Este test es esa red, y es deliberadamente la TERCERA en
 * orden de importancia:
 *
 *   1. El tipado de claves (`src/global.d.ts`) convierte una clave inexistente
 *      en un error de compilacion.
 *   2. `i18n-parity.test.ts` compara los dos idiomas entre si.
 *   3. Este test busca texto escrito a mano dentro del JSX.
 *
 * Es una HEURISTICA, no un analisis sintactico: busca texto entre `>` y `<`
 * dentro de los componentes. Todo texto de la interfaz se resuelve con
 * `{t("...")}`, que contiene llaves, asi que un componente correcto no produce
 * ninguna coincidencia. Si algun dia hiciera falta una excepcion legitima, se
 * anade a `ALLOWED` con su motivo; nunca se relaja el patron.
 */

/**
 * Directorio de este fichero, como RUTA DEL SISTEMA DE FICHEROS.
 *
 * Deliberadamente NO se usa `new URL(".", import.meta.url)`. Vite reescribe ese
 * patron cuando el primer argumento es una cadena literal (es su mecanismo de
 * import de assets), asi que dentro de Vitest la expresion no se evalua como
 * esta escrita: se resuelve contra `location`, que en el entorno jsdom es
 * `http://localhost:3000`. El resultado era una URL `http:` y `fileURLToPath`
 * lanzaba `TypeError: The URL must be of scheme file` en la carga del modulo,
 * de modo que el fichero entero no llegaba a ejecutarse: la red no existia y
 * ademas no aparecia como fallo en el recuento de tests.
 *
 * `fileURLToPath(import.meta.url)` no coincide con ese patron, y `dirname`
 * trabaja sobre rutas nativas, que es lo que `readdirSync` espera tanto en
 * Windows (`C:\...`) como en POSIX.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Carpetas con JSX de interfaz. `mocks` y `test` no pintan nada. */
const SCANNED_DIRECTORIES = [join(HERE, "..", "app"), join(HERE, "..", "components")];

/** Excepciones explicitas, con motivo. Vacio a proposito. */
const ALLOWED: readonly string[] = [];

function listTsxFiles(directory: string): string[] {
  const files: string[] = [];

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de import.meta.url, no de entrada de usuario
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

/** Elimina comentarios para no confundir la prosa de la documentacion con UI. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Candidatos a texto visible escrito a mano.
 *
 * Se descartan:
 *   - los tramos que contienen `{` o `}`, es decir, todo lo que sale de `t()`;
 *   - los que vienen de `=>` o `->`, que son codigo y no marcado;
 *   - los que contienen caracteres que la prosa no tiene: parentesis, corchetes,
 *     punto y coma, igual, comillas, barras.
 */
function findHardcodedText(source: string): string[] {
  const found: string[] = [];
  // `[\s\S]` y no `.`: en JSX formateado, el `>` que cierra una etiqueta suele
  // quedarse solo en su linea, y con `.` se perderia esa coincidencia.
  const pattern = /([\s\S])>([^<>{}]+)</g;

  let match = pattern.exec(source);
  while (match !== null) {
    const previous = match[1] ?? "";
    const candidate = (match[2] ?? "").trim();
    match = pattern.exec(source);

    if (previous === "=" || previous === "-") continue;
    if (candidate.length === 0) continue;
    if (/[()[\];=|&$"`/\\]/.test(candidate)) continue;
    if (ALLOWED.includes(candidate)) continue;

    const words = candidate.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/g) ?? [];
    const looksLikeSentence = words.length >= 2;
    const looksLikeLabel =
      words.length === 1 && /^[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}$/.test(candidate);

    if (looksLikeSentence || looksLikeLabel) found.push(candidate);
  }

  return found;
}

describe("no hay copy escrito a mano en los componentes (DEC-021)", () => {
  const files = SCANNED_DIRECTORIES.flatMap((directory) => listTsxFiles(directory));

  it("encuentra componentes que escanear", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("ningun componente contiene texto visible fuera del diccionario", () => {
    const offenders: string[] = [];

    for (const file of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la propia estructura del repositorio
      const source = stripComments(readFileSync(file, "utf8"));
      for (const text of findHardcodedText(source)) {
        offenders.push(`${file}: "${text}"`);
      }
    }

    expect(offenders, `texto sin traducir:\n${offenders.join("\n")}`).toEqual([]);
  });
});
