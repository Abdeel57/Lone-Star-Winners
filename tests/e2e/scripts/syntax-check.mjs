#!/usr/bin/env node
/**
 * `typecheck` de este paquete.
 *
 * POR QUE NO ES `tsc`
 * -------------------
 * Este paquete no tiene TypeScript, y eso es una decision, no una omision.
 *
 * `eslint.config.mjs` de la raiz aplica la capa type-aware a `**\/*.ts` de TODO
 * el repositorio, incluido este directorio. Con `@playwright/test` sin instalar
 * -que es el estado del repositorio hasta que alguien ejecute `pnpm install`-
 * TypeScript no puede resolver el modulo, las importaciones quedan como `any`,
 * y `no-unsafe-call` / `no-unsafe-member-access` convierten `pnpm run lint:root`
 * en rojo para todo el mundo. Medido: 8 errores en un fichero de 6 lineas.
 *
 * En `.mjs` esa capa no se aplica -la seccion 4 de la configuracion raiz les
 * pone `disableTypeChecked`- y el paquete puede existir en el arbol sin romper
 * los gates de nadie mientras la dependencia no este.
 *
 * El precedente esta a la vista: `apps/web/scripts/smoke.mjs`, la otra red que
 * arranca procesos de verdad, tambien es JavaScript por razones parecidas.
 *
 * QUE COMPRUEBA ESTE SCRIPT
 * -------------------------
 * `node --check` sobre cada `.mjs`: sintaxis y forma de modulo ES. No es
 * comprobacion de tipos y no pretende serlo; llamarla `typecheck` seria mentir
 * si este paquete tuviera tipos que comprobar, y no los tiene. Lo que si evita
 * es el fallo caro: un fichero de e2e con un parentesis de menos que solo se
 * descubre 20 minutos despues, en CI, cuando Playwright intenta cargarlo.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const IGNORED_DIRECTORIES = new Set(["node_modules", "playwright-report", "test-results"]);

/* eslint-disable security/detect-non-literal-fs-filename --
 * Las rutas se componen con `join` a partir de `PACKAGE_DIR`, que sale de
 * `import.meta.url`. No hay entrada de usuario en ningun punto: esto recorre el
 * propio paquete para comprobar sus ficheros. Mismo criterio -y mismo alcance:
 * fichero concreto, regla concreta- que las excepciones de tests/security. */

function collectModules(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    if (entry.startsWith(".")) continue;

    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      found.push(...collectModules(full));
      continue;
    }

    if (entry.endsWith(".mjs")) found.push(full);
  }

  return found;
}

/* eslint-enable security/detect-non-literal-fs-filename */

const modules = collectModules(PACKAGE_DIR).sort();
const failures = [];

for (const file of modules) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });

  if (result.status === 0) {
    console.error(`  ok    ${relative(PACKAGE_DIR, file)}`);
    continue;
  }

  failures.push(relative(PACKAGE_DIR, file));
  console.error(`  FALLA ${relative(PACKAGE_DIR, file)}`);
  console.error(result.stderr.trim());
}

if (failures.length > 0) {
  console.error(`\n[e2e] ${String(failures.length)} fichero(s) con sintaxis invalida.`);
  process.exit(1);
}

console.error(`\n[e2e] ${String(modules.length)} modulo(s) comprobados.`);
