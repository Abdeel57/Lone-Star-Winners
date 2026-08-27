#!/usr/bin/env node
/**
 * Ejecuta un comando de Playwright, o explica por que no puede.
 *
 * POR QUE EXISTE
 * --------------
 * `@playwright/test` es una dependencia NUEVA de este repositorio. Mientras
 * nadie ejecute `pnpm install` para incorporarla al lockfile, el paquete no
 * esta en `node_modules` y cualquier `playwright test` falla con un error de
 * resolucion de modulo que no dice nada util.
 *
 * LA ASIMETRIA ES DELIBERADA, Y ES LO IMPORTANTE DE ESTE FICHERO
 * -------------------------------------------------------------
 *   En LOCAL, sin Playwright  -> aviso y salida 0. `turbo run test` no se cae
 *                                por una herramienta que todavia no se ha
 *                                instalado, y el resto del monorepo sigue
 *                                verde.
 *
 *   En CI, sin Playwright     -> salida 1. Aqui lo contrario seria un desastre
 *                                silencioso: el gate de e2e apareceria en
 *                                verde sin haber abierto un navegador, que es
 *                                exactamente la clase de gate que
 *                                `.github/workflows/ci.yml` llama
 *                                "documentacion" en su cabecera.
 *
 * Un "skip" que no distingue entre las dos situaciones es peor que no tener
 * gate: da una senal positiva por ausencia de comprobacion.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

function playwrightIsInstalled() {
  try {
    require.resolve("@playwright/test/package.json");
    return true;
  } catch {
    return false;
  }
}

const [command, ...args] = process.argv.slice(2);

if (command === undefined) {
  console.error("[e2e] Uso: node scripts/require-playwright.mjs <comando> [args...]");
  process.exit(2);
}

if (!playwrightIsInstalled()) {
  const explanation = [
    "@playwright/test no esta instalado.",
    "Es una dependencia NUEVA declarada en tests/e2e/package.json.",
    "Para incorporarla: `pnpm install` en la raiz del repositorio (actualiza el lockfile),",
    "y despues `pnpm --filter @lsw/tests-e2e exec playwright install --with-deps chromium`.",
  ].join(" ");

  if (isCi) {
    console.error(`::error title=e2e::${explanation}`);
    console.error(
      "[e2e] En CI esto es un FALLO, no un salto: un gate que se salta a si mismo no es un gate.",
    );
    process.exit(1);
  }

  console.error(`[e2e] OMITIDO: ${explanation}`);
  console.error("[e2e] Fuera de CI esto no tumba el workspace. En CI, si.");
  process.exit(0);
}

const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`[e2e] no se pudo ejecutar "${command}":`, error);
  process.exit(1);
});
