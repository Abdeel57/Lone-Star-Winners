/**
 * Playwright para el recorrido de punta a punta (HO-030, DEC-018).
 *
 * DOS MODOS, Y LA DIFERENCIA IMPORTA
 * ----------------------------------
 *   full  (por defecto, y el que corre en CI)
 *         `apps/api` compilado contra el PostgreSQL del servicio, con las
 *         migraciones aplicadas y el escenario sembrado; `apps/web` con
 *         `WEB_ENABLE_API_MOCKS=false` apuntando a esa API. Es lo unico que
 *         ejercita el autorizador real, las sesiones reales y filas reales.
 *
 *   mocks (`E2E_MODE=mocks`)
 *         `apps/web` solo, con su servidor de mocks. NO prueba el backend:
 *         prueba la MECANICA -que Playwright arranca, navega y encuentra los
 *         selectores-. Existe porque en una maquina sin Docker ni PostgreSQL
 *         es lo unico ejecutable, y una suite que nunca se ha ejecutado tiene
 *         mas fallos de mecanica que de sistema.
 *
 *         Solo corren las pruebas marcadas `@mockable`. Etiquetar una que
 *         dependa de datos sembrados la haria fallar contra los fixtures del
 *         mock, y el fallo no diria nada sobre el sistema.
 *
 * EN SERIE, Y A PROPOSITO
 * -----------------------
 * `workers: 1` y `fullyParallel: false`. Las pruebas comparten UNA base de
 * datos y un recorrido con estado: el ajuste se aprueba sobre el envio AMOE que
 * aprobo el paso anterior. Paralelizarlas no las haria mas rapidas, las haria
 * mentir.
 *
 * `retries: 0` por el mismo motivo. Un reintento sobre estado que ya cambio no
 * reproduce la prueba: ejecuta otra distinta y la llama igual.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, "..", "..");

// `next` se resuelve desde apps/web, no desde node_modules de la raiz: pnpm no
// lo eleva (ni en local ni en CI), asi que la ruta de la raiz no existe y el
// webServer moria con MODULE_NOT_FOUND antes de arrancar.
const NEXT_BIN = createRequire(join(REPO_ROOT, "apps", "web", "package.json")).resolve(
  "next/dist/bin/next",
);

const MODE =
  process.env.E2E_MODE ?? (process.env.WEB_ENABLE_API_MOCKS === "true" ? "mocks" : "full");

const WEB_PORT = process.env.WEB_PORT ?? "3310";
const API_PORT = process.env.API_PORT ?? "4310";

const WEB_BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`;
const API_BASE_URL = process.env.API_BASE_URL ?? `http://127.0.0.1:${API_PORT}/api/v1`;

const isCi = process.env.CI === "true";

/**
 * Servidores que Playwright levanta y espera.
 *
 * `reuseExistingServer` fuera de CI: quien este desarrollando puede tener sus
 * procesos abiertos y no quiere que la suite se los mate. En CI, nunca: un
 * servidor reutilizado seria un servidor de otra ejecucion, con otro estado.
 */
const webServer =
  MODE === "mocks"
    ? [
        {
          command: `node ${JSON.stringify(NEXT_BIN)} dev --port ${WEB_PORT}`,
          cwd: join(REPO_ROOT, "apps", "web"),
          url: `${WEB_BASE_URL}/healthz`,
          timeout: 240_000,
          reuseExistingServer: !isCi,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            NODE_ENV: "development",
            WEB_ENABLE_API_MOCKS: "true",
            // Directorio de build propio: dos `next dev` sobre el mismo `.next`
            // se pisan y el sintoma aparece en el servidor DEL OTRO. Mismo
            // motivo que documenta `apps/web/scripts/smoke.mjs`.
            LSW_NEXT_DIST_DIR: ".next-e2e",
            // La API simulada la arranca `instrumentation.ts` en el puerto que
            // declare esta variable. Puerto propio, para no hablar con la API
            // simulada de otro proceso.
            API_BASE_URL: `http://127.0.0.1:${String(Number(API_PORT) + 1)}/api/v1`,
            NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${String(Number(API_PORT) + 1)}/api/v1`,
          },
        },
      ]
    : [
        {
          command: `node --enable-source-maps ${JSON.stringify(join(REPO_ROOT, "apps", "api", "dist", "server.js"))}`,
          cwd: REPO_ROOT,
          url: `${API_BASE_URL}/health`,
          timeout: 120_000,
          reuseExistingServer: !isCi,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: `node ${JSON.stringify(NEXT_BIN)} start --port ${WEB_PORT}`,
          cwd: join(REPO_ROOT, "apps", "web"),
          url: `${WEB_BASE_URL}/healthz`,
          timeout: 180_000,
          reuseExistingServer: !isCi,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            /*
             * `next start` sirve un build de PRODUCCION y tiene que correr con
             * el mismo `NODE_ENV` con el que se compilo. El resto del job vive
             * en `NODE_ENV=test` porque `apps/api` se niega a arrancar en
             * produccion sin HTTPS y sin TLS verificado (y hace bien).
             *
             * Efecto secundario util: con `production`, `instrumentation.ts`
             * ni siquiera compila el `import()` del servidor de mocks. Los
             * mocks no pueden colarse aunque alguien se deje la variable.
             */
            NODE_ENV: "production",
            WEB_ENABLE_API_MOCKS: "false",
          },
        },
      ];

export default defineConfig({
  testDir: "./specs",
  testMatch: /.*\.spec\.mjs$/,

  fullyParallel: false,
  workers: 1,
  retries: 0,

  // Un `.only` olvidado en CI convierte la suite entera en una sola prueba, y
  // el resultado sigue siendo verde.
  forbidOnly: isCi,

  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: isCi
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],

  ...(MODE === "mocks" ? { grep: /@mockable/ } : {}),

  use: {
    baseURL: WEB_BASE_URL,
    // `on-first-retry` no sirve con `retries: 0`: no habria traza nunca.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // DEC-011: el navegador tambien en UTC. Una prueba que evalua una ventana
    // de promocion no puede depender de la zona del runner.
    timezoneId: "UTC",
    locale: "es-US",
    // Los servidores del escenario son locales y sin TLS.
    ignoreHTTPSErrors: false,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer,
});
