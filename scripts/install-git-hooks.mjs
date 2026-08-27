#!/usr/bin/env node
/**
 * `prepare` de la raiz: instala los hooks de git con lefthook.
 *
 * POR QUE NO ES `"prepare": "lefthook install"` A SECAS
 * ----------------------------------------------------
 * `pnpm install` ejecuta `prepare`, y `lefthook install` necesita un
 * repositorio git. En un contenedor de build no lo hay: el proveedor copia el
 * codigo fuente SIN el directorio `.git`. Alli `lefthook install` termina con
 *
 *   fatal: not a git repository (or any of the parent directories): .git
 *   Error: exit status 128
 *
 * y como `prepare` forma parte del ciclo de vida de la instalacion, se lleva
 * por delante el `pnpm install` entero. El sintoma es desconcertante -un
 * despliegue que falla en la instalacion de dependencias, sin que ninguna
 * dependencia tenga nada malo- y no se reproduce en local ni en GitHub
 * Actions, donde `actions/checkout` si deja `.git`. Se descubrio desplegando
 * (DEC-043).
 *
 * QUE HACE, Y QUE NO
 * ------------------
 * Se salta la instalacion de hooks cuando NO tiene sentido instalarlos:
 * sin `.git`, o en un entorno de integracion continua. En cualquier otro caso
 * ejecuta `lefthook install` y **propaga el fallo**.
 *
 * Deliberadamente NO es un `lefthook install || true`. Ese atajo arregla el
 * contenedor y de paso silencia el caso que de verdad importa: un
 * desarrollador cuyos hooks no se instalan y que se entera cuando sube un
 * secreto que `gitleaks` habria parado en el pre-commit. Aqui, si hay git y no
 * es CI, un fallo sigue siendo un fallo.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `.git` es un directorio en un clon normal y un ARCHIVO en un worktree o un
 * submodulo. Comprobar solo el directorio dejaria sin hooks a quien trabaje en
 * un worktree, que es justo donde mas facil es olvidarse de ellos.
 */
if (!existsSync(join(repoRoot, ".git"))) {
  console.error("[hooks] sin repositorio git (contenedor de build): no se instalan hooks.");
  process.exit(0);
}

// Los hooks de git son una red para el trabajo local. En CI no hay commits que
// interceptar, y las mismas comprobaciones corren como gates propios.
if (process.env.CI !== undefined && process.env.CI !== "" && process.env.CI !== "false") {
  console.error("[hooks] entorno de CI: no se instalan hooks.");
  process.exit(0);
}

/**
 * Se resuelve el binario de `node_modules/.bin` en vez de confiar en el PATH.
 *
 * Cuando `prepare` lo lanza pnpm, `node_modules/.bin` esta en el PATH y
 * `lefthook` a secas funciona. Ejecutado a mano desde una terminal cualquiera,
 * no lo esta, y el script fallaria por una razon que no tiene nada que ver con
 * los hooks. Un script de arranque que solo funciona invocado de una forma
 * concreta es un script que alguien dara por roto.
 */
const binary = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "lefthook.CMD" : "lefthook",
);

const command = existsSync(binary) ? binary : "lefthook";

// Windows no ejecuta un `.CMD` sin shell desde Node 20. Pero al pasar por
// shell, la ruta se interpreta como linea de comandos: si el repositorio esta
// en una carpeta con espacio -"Lone Star" sin ir mas lejos- `cmd` la parte y
// busca un programa llamado `C:\Users\...\Lone`. Por eso se entrecomilla.
// Los dos caminos se separan en vez de pasar `args` con `shell: true`, que
// Node marca como obsoleto: con shell los argumentos se concatenan sin
// escapar. Aqui el unico argumento es el literal `install`, asi que se
// incrusta en la propia linea de comandos y no hay nada que escapar.
if (process.platform === "win32") {
  execSync(`"${command}" install`, { stdio: "inherit", cwd: repoRoot });
} else {
  execFileSync(command, ["install"], { stdio: "inherit", cwd: repoRoot });
}
