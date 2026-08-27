/**
 * El caminante del repositorio, probado sobre sus propias exclusiones.
 *
 * POR QUE ESTE FICHERO EXISTE
 *
 *   Todos los escaneres de invariante de este paquete comparten un unico
 *   recorrido: `listRepoTextFiles`. Su lista de directorios ignorados no es una
 *   comodidad de rendimiento, es parte del gate. Si el caminante baja a un
 *   artefacto de compilacion, los escaneres empiezan a informar sobre codigo
 *   que no ha escrito nadie del equipo, y un gate que informa de defectos
 *   inventados acaba desactivado -o ignorado, que es peor, porque sigue
 *   pareciendo vivo-.
 *
 *   Eso paso: `apps/web/scripts/smoke.mjs` arranca su `next dev` con un
 *   `distDir` propio en `apps/web/.next-smoke`, para no pisar el `.next` del
 *   servidor de desarrollo vivo, y existe una receta de build aislado en
 *   `apps/web/.next-build`. La lista enumeraba `.next` y solo `.next`, asi que
 *   el caminante entraba en `apps/web/.next-smoke/server/middleware.js` -un
 *   bundle de webpack- y el escaner de `HO-014` devolvia 45 falsos positivos.
 *   En local se "arreglaba" borrando el directorio; en CI, con el smoke
 *   corriendo antes que los tests, era un rojo permanente.
 *
 *   La correccion ignora la familia `.next*` entera. Este fichero es la red.
 *   Un `expect(isIgnoredDirectory(".next-smoke")).toBe(true)` a solas no habria
 *   detectado el defecto original -el predicado no existia, y el fallo estaba
 *   en QUE se consultaba-, asi que el caso central crea el directorio de
 *   verdad, en la ruta de verdad, con un fichero que SI es una infraccion real
 *   de `HO-014`, y recorre el repositorio entero.
 *
 * POR QUE EL FIXTURE SE ENSAMBLA POR FRAGMENTOS
 *
 *   El contenido del fixture tiene que ser una infraccion autentica de
 *   `HO-014`: una plantilla con barra invertida entregada a `RegExp`. Si esa
 *   linea apareciese entera en el fuente de ESTE fichero, el escaner de
 *   `HO-014` -que recorre el repositorio y no excluye `src/invariants/`- se
 *   toparia con ella y fallaria. Se ensambla en tiempo de ejecucion, igual que
 *   hacen `internal-draw-disabled.test.ts` y `weak-randomness.test.ts` con sus
 *   propias muestras. Excluir este fichero del recorrido era la alternativa
 *   facil, y deja un punto ciego permanente.
 *
 * POR QUE EL CONTROL NEGATIVO NO VIVE DENTRO DEL REPOSITORIO
 *
 *   "El fixture no aparece" y "el caminante no miro nada" son indistinguibles
 *   sin un control que SI aparezca. La primera version de este test creaba ese
 *   control como un directorio nuevo bajo `tests/security/src/helpers/`, y
 *   fallo en rojo: Vitest ejecuta los ficheros de test en procesos paralelos,
 *   `internal-draw-disabled.test.ts` estaba recorriendo el repositorio a la vez,
 *   listo el fichero de control y lo leyo justo despues de que el `finally` de
 *   aqui lo borrase (`ENOENT`). Cualquier fichero transitorio en una ruta que
 *   los escaneres recorren es una carrera.
 *
 *   Por eso el control vive en el directorio temporal del sistema y se le pasa
 *   al caminante como `startAt`: el arbol lleva las dos polaridades con
 *   contenido IDENTICO, de modo que lo unico que distingue al fichero hallado
 *   del omitido es el nombre del directorio que lo contiene. Ningun otro
 *   proceso lo ve.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isIgnoredDirectory, listRepoTextFiles, repoRoot } from "../helpers/repo.js";

const BACKTICK = String.fromCharCode(96);
const BACKSLASH = String.fromCharCode(92);

/**
 * Una linea que `HO-014` DEBE considerar infraccion: plantilla con una barra
 * invertida suelta (`\s`, que en una cadena normal colapsa a `s`) entregada al
 * constructor de expresiones regulares. Es la forma que tienen de verdad los
 * bundles que Next escribe en su `distDir`.
 */
const TRAP_LINE =
  `const p = new Reg${"Exp"}(` +
  `${BACKTICK}${BACKSLASH}s*${BACKSLASH}.${BACKSLASH}s*random${BACKTICK});`;

const TRAP_CONTENTS = [
  "// Fixture de test: imita el bundle de webpack de un distDir de Next.",
  TRAP_LINE,
  "module.exports = { p };",
  "",
].join("\n");

/**
 * Subdirectorio propio dentro del artefacto: el smoke escribe su propio
 * `server/middleware.js` y este test no debe pisarlo ni borrarlo.
 */
const FIXTURE_SUBDIRECTORY = "__walker_fixture__";

/** Las dos familias de `distDir` que hoy existen bajo `apps/web`. */
const ARTIFACT_DIRECTORIES: readonly string[] = [".next-smoke", ".next-build"];

// ---------------------------------------------------------------------------
// El predicado.
// ---------------------------------------------------------------------------

describe("isIgnoredDirectory", () => {
  it("ignora la familia `.next` entera, no solo `.next`", () => {
    for (const name of [".next", ".next-smoke", ".next-build"]) {
      expect(isIgnoredDirectory(name), name).toBe(true);
    }
  });

  it("sigue ignorando dependencias y salidas de herramientas", () => {
    for (const name of [".git", "node_modules", "dist", "build", "out", ".turbo", "coverage"]) {
      expect(isIgnoredDirectory(name), name).toBe(true);
    }
  });

  it("no ignora codigo fuente", () => {
    // El prefijo es `.next`, con punto: `next-env` y `nextjs` no empiezan por
    // el. Si esta lista se volviese verde por accidente, el caminante dejaria
    // de mirar el repositorio y todos los escaneres pasarian por vacio, que es
    // el unico fallo que un escaner no puede detectar sobre si mismo.
    for (const name of ["src", "apps", "packages", "docs", "tests", "next-env", "nextjs"]) {
      expect(isIgnoredDirectory(name), name).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// El fixture es de verdad una trampa.
// ---------------------------------------------------------------------------

describe("el fixture de este test", () => {
  it("es una infraccion autentica de HO-014", () => {
    // Sin esto, los casos de abajo podrian pasar por vacio: un fixture inerte
    // tampoco apareceria como hallazgo, y no probaria nada.
    expect(TRAP_CONTENTS).toContain(`Reg${"Exp"}(${BACKTICK}`);
    expect(TRAP_CONTENTS).toContain(`${BACKTICK}${BACKSLASH}s`);
    // Una barra DUPLICADA seria el patron correcto, y no una infraccion.
    expect(TRAP_CONTENTS).not.toContain(`${BACKSLASH}${BACKSLASH}s`);
  });
});

// ---------------------------------------------------------------------------
// El caso real: la ruta que rompio la suite.
// ---------------------------------------------------------------------------

describe("listRepoTextFiles: los distDir de Next no se recorren", () => {
  it("no devuelve nada de `apps/web/.next-smoke` ni de `apps/web/.next-build`", () => {
    const root = repoRoot();
    /** Directorios creados aqui, para borrar solo lo nuestro. */
    const created: string[] = [];
    const fixtures: string[] = [];

    try {
      for (const artifact of ARTIFACT_DIRECTORIES) {
        const artifactRoot = join(root, "apps", "web", artifact);
        const directory = join(artifactRoot, FIXTURE_SUBDIRECTORY);
        // El smoke puede haber dejado `.next-smoke` en su sitio; en ese caso no
        // es nuestro y no se borra al terminar.
        if (!existsSync(artifactRoot)) {
          created.push(artifactRoot);
        }
        mkdirSync(directory, { recursive: true });
        created.push(directory);
        const file = join(directory, "middleware.js");
        writeFileSync(file, TRAP_CONTENTS, "utf8");
        fixtures.push(file);
      }

      // El recorrido corre con el fixture PRESENTE en disco: ese, y no el
      // directorio recien borrado a mano, es el caso que rompio la suite.
      const walked = new Set(listRepoTextFiles().map((file) => file.absolutePath));

      for (const fixture of fixtures) {
        expect(existsSync(fixture), `${fixture} deberia existir en disco`).toBe(true);
        expect(walked.has(fixture), `${fixture} no debe aparecer en el recorrido`).toBe(false);
      }

      // Control: el recorrido llego hasta `apps/web` y devolvio ficheros de
      // ahi. Se usan ficheros YA versionados a proposito; crear uno nuevo en
      // una ruta que los escaneres recorren es una carrera con los demas
      // ficheros de test, que corren en paralelo (ver la cabecera).
      expect(walked.has(join(root, "apps", "web", "next.config.mjs"))).toBe(true);
      expect(walked.has(join(root, "apps", "web", "package.json"))).toBe(true);
    } finally {
      for (const directory of created.reverse()) {
        rmSync(directory, { force: true, recursive: true });
      }
    }
  });

  it("desciende a un directorio nuevo que no esta ignorado, con el mismo contenido", () => {
    // Arbol hermetico, fuera del repositorio: mismas dos polaridades, contenido
    // identico. Lo unico que cambia es el nombre del directorio.
    const sandbox = mkdtempSync(join(tmpdir(), "lsw-walker-"));

    try {
      const visible = join(sandbox, "src", "trap.js");
      mkdirSync(join(sandbox, "src"), { recursive: true });
      writeFileSync(visible, TRAP_CONTENTS, "utf8");

      const hidden: string[] = [];
      for (const artifact of [".next", ".next-smoke", ".next-build", "node_modules", "dist"]) {
        mkdirSync(join(sandbox, artifact), { recursive: true });
        const file = join(sandbox, artifact, "trap.js");
        writeFileSync(file, TRAP_CONTENTS, "utf8");
        hidden.push(file);
      }

      const walked = new Set(listRepoTextFiles(sandbox).map((file) => file.absolutePath));

      expect(walked.has(visible), "un directorio nuevo NO ignorado si se recorre").toBe(true);
      for (const file of hidden) {
        expect(walked.has(file), file).toBe(false);
      }
    } finally {
      rmSync(sandbox, { force: true, recursive: true });
    }
  });
});
