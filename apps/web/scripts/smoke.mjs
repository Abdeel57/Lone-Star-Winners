#!/usr/bin/env node
/**
 * Humo: arranca el servidor de desarrollo DE VERDAD y comprueba que las
 * pantallas traen datos.
 *
 * POR QUE EXISTE
 * --------------
 * Los 166 tests unitarios pasaban mientras la aplicacion mostraba el estado de
 * error en todas las pantallas con datos. No era un fallo de los tests: era que
 * ninguno de ellos arranca Next. En Vitest, MSW intercepta en Node plano y todo
 * funciona; en `next dev`, la interceptacion competia con el parcheo de `fetch`
 * de Next y perdia (ver `src/mocks/dev-server.ts`).
 *
 * Ningun test unitario puede ver esa clase de fallo, hoy ni manana: vive en el
 * arranque del proceso real, no en un modulo. Esta red comprueba lo unico que
 * lo detecta -que el HTML SERVIDO contiene datos- y falla con codigo distinto
 * de cero, asi que sirve tal cual en CI.
 *
 * QUE COMPRUEBA, EXACTAMENTE
 * --------------------------
 * Para cada ruta:
 *   1. que responde 200;
 *   2. que el HTML contiene texto que solo puede venir de los fixtures;
 *   3. que NO se ha renderizado el estado de error de la capa de API.
 *
 * El punto 3 se mide sobre el HTML SIN sus `<script>`: el diccionario de i18n
 * viaja entero dentro del payload de React, asi que el texto del error aparece
 * ahi en todas las paginas, tengan o no error. Buscarlo en el HTML crudo daria
 * siempre positivo y la red no valdria para nada.
 *
 * LO QUE NO HACE
 * --------------
 * No apaga el estado de error ni lo evita: si la API simulada no arranca, estas
 * comprobaciones FALLAN, que es justo lo que tienen que hacer.
 *
 * Uso: `pnpm --filter @lsw/web smoke` (o `node scripts/smoke.mjs`).
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Puerto propio, para no chocar con el `next dev` que alguien tenga abierto. */
const PORT = Number(process.env.SMOKE_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 180_000;

/**
 * Textos del estado de error de la capa de API, en los dos idiomas.
 *
 * Son los mismos de `messages/*.json` -> `states.loadFailed.title`. Se repiten
 * aqui a proposito: si alguien cambia el mensaje sin actualizar esta lista, la
 * red deja de detectar el fallo, y prefiero que eso se vea al leer el fichero
 * antes que importar el diccionario y que la comprobacion siga siendo verde
 * comparando el mensaje consigo mismo.
 */
const ERROR_STATE_TEXTS = ["No hemos podido cargar esta sección", "We could not load this section"];

/**
 * Rutas y lo que tiene que aparecer en cada una.
 *
 * `expect` son cadenas que SOLO pueden venir de un fixture servido por la API:
 * nada de copy del diccionario, que aparece aunque la peticion falle.
 */
const CHECKS = [
  {
    path: "/es",
    expect: [
      "Sorteo promocional Lone Star Road Trip",
      "$45,000.00",
      // Mercancia destacada: la portada tambien depende del catalogo.
      "Camiseta de algodón grueso",
    ],
  },
  {
    path: "/en",
    expect: ["The Lone Star Road Trip Sweepstakes", "$45,000.00", "Heavyweight Cotton Tee"],
  },
  {
    path: "/es/shop",
    expect: ["Camiseta de algodón grueso", "Taza esmaltada de campamento", "$25.00"],
  },
  {
    path: "/en/shop",
    expect: ["Heavyweight Cotton Tee", "Enamel Camp Mug", "$25.00"],
  },
  {
    path: "/es/products/heavyweight-tee",
    expect: ["Camiseta de algodón grueso", "$25.00"],
  },
  {
    // El listado pinta una promocion por estado: se comprueba la primera, la
    // ultima y la activa, no solo que la pagina responda.
    path: "/es/promotions",
    expect: [
      "Sorteo promocional Workshop Build-Out",
      "Sorteo promocional Lone Star Road Trip",
      "Sorteo promocional Coastal Run",
    ],
  },
  {
    path: "/es/promotions/road-trip-2026",
    expect: ["Sorteo promocional Lone Star Road Trip", "Camioneta doble cabina"],
  },
  {
    path: "/es/official-rules",
    expect: ["Reglas Oficiales — a la espera del texto aprobado"],
  },
  {
    path: "/en/official-rules",
    expect: ["Official Rules — awaiting the approved text"],
  },
  { path: "/es/cart", expect: [] },
  {
    /*
     * El carrito CON contenido.
     *
     * La cookie es la que emite la API simulada al anadir una linea (ver
     * `src/mocks/dev-server.ts`). Sin esta comprobacion, la unica pantalla de
     * carrito que se prueba es la vacia, que es tambien la que sigue viendose
     * bien cuando la sesion no se propaga.
     */
    path: "/es/cart",
    headers: { cookie: "lsw_dev_cart=1" },
    expect: ["Camiseta de algodón grueso", "$50.00", "250"],
  },
  { path: "/es/faq", expect: [] },
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

/** HTML sin sus `<script>`: solo lo que un ojo humano leeria en la pagina. */
function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, "");
}

async function waitForServer(child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `El servidor de desarrollo termino antes de estar listo (${child.exitCode}).`,
      );
    }

    try {
      const response = await fetch(`${BASE}/en`, { redirect: "follow" });
      if (response.ok) return;
    } catch {
      // Todavia no escucha. Se reintenta.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`El servidor de desarrollo no estuvo listo en ${READY_TIMEOUT_MS} ms.`);
}

/**
 * Mata el arbol de procesos.
 *
 * `child.kill()` no basta en Windows: `next dev` lanza su propio proceso hijo y
 * matar solo al padre deja el puerto ocupado, de modo que la siguiente
 * ejecucion falla por una razon que no tiene nada que ver con lo que se probaba.
 */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function main() {
  const nextBin = require.resolve("next/dist/bin/next");

  log(`[smoke] arrancando next dev en ${BASE}`);

  const child = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: "development",
      // Explicito: esta red comprueba la aplicacion CON la API simulada. Si
      // alguien apaga los mocks en su entorno, el humo tiene que seguir
      // probando lo mismo.
      WEB_ENABLE_API_MOCKS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const serverOutput = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => serverOutput.push(chunk));
  }

  const failures = [];

  try {
    await waitForServer(child);
    log("[smoke] listo. Comprobando rutas.\n");

    for (const check of CHECKS) {
      const response = await fetch(`${BASE}${check.path}`, {
        redirect: "follow",
        ...(check.headers === undefined ? {} : { headers: check.headers }),
      });
      const html = await response.text();
      const text = visibleText(html);
      const problems = [];

      if (response.status !== 200) problems.push(`HTTP ${response.status}`);

      for (const needle of check.expect) {
        if (!html.includes(needle)) problems.push(`falta el dato del fixture: ${needle}`);
      }

      for (const needle of ERROR_STATE_TEXTS) {
        if (text.includes(needle)) problems.push(`estado de error renderizado: ${needle}`);
      }

      if (problems.length === 0) {
        log(`  ok    ${check.path}${check.headers === undefined ? "" : " (con sesion)"}`);
      } else {
        log(`  FALLA ${check.path}${check.headers === undefined ? "" : " (con sesion)"}`);
        for (const problem of problems) log(`          ${problem}`);
        failures.push(check.path);
      }
    }
  } finally {
    killTree(child);
  }

  log("");

  if (failures.length > 0) {
    log(`[smoke] ${failures.length} ruta(s) sin datos: ${failures.join(", ")}`);
    log("[smoke] salida del servidor:");
    log(serverOutput.join("").split("\n").slice(-40).join("\n"));
    process.exitCode = 1;
    return;
  }

  log(`[smoke] ${CHECKS.length} rutas sirven datos de los fixtures.`);
}

main().catch((error) => {
  log(`[smoke] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
