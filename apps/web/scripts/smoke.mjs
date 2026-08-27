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
import { readFileSync, writeFileSync } from "node:fs";
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
 * Puerto propio TAMBIEN para la API simulada.
 *
 * Tener un puerto propio para Next no bastaba. La API simulada la arranca
 * `src/instrumentation.ts` en el puerto que declare `API_BASE_URL`, y por
 * defecto es el 4000: si alguien tiene un `next dev` abierto, ese puerto ya
 * esta ocupado por SU proceso, el del humo no arranca el suyo, y las dos
 * aplicaciones acaban hablando con la misma API.
 *
 * Eso no es un choque de puertos cualquiera: la API simulada carga los fixtures
 * UNA vez, al arrancar, y el recargado en caliente de Next no vuelve a
 * ejecutar la instrumentacion. Es decir, el humo se medía contra los fixtures
 * que estaban en disco cuando alguien abrio su servidor, que pueden ser de hace
 * horas. Con su propia API, el humo prueba SIEMPRE el arbol actual.
 */
const API_PORT = Number(process.env.SMOKE_API_PORT ?? 4210);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}/api/v1`;

/**
 * Directorio de build PROPIO, y no el `.next` de todo el mundo.
 *
 * Tener puertos propios no bastaba, por la misma razon por la que no bastaba
 * tener un puerto solo para Next: el proceso que arranca este script comparte
 * disco con el `next dev` que alguien tenga abierto. Dos `next dev` sobre el
 * mismo `.next` se pisan -uno reescribe manifiestos y `chunks` mientras el
 * otro los lee- y el resultado son 500 intermitentes EN EL OTRO SERVIDOR, que
 * es el peor sitio posible para dejar un fallo: aparece despues, en otra
 * ventana, sin relacion aparente con haber ejecutado el humo.
 *
 * `next.config.mjs` lee esta variable y la valida; sin ella, `.next`.
 */
const DIST_DIR = process.env.SMOKE_DIST_DIR ?? ".next-smoke";

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
 * Cookie de sesion de la API simulada.
 *
 * Se repite aqui por el mismo motivo que `ERROR_STATE_TEXTS`: si alguien cambia
 * el nombre o el valor en `src/mocks/dev-server.ts` sin actualizar esta linea,
 * el humo dejaria de probar el portal CON sesion y seguiria en verde probando
 * el estado sin sesion. Prefiero que eso se vea al leer el fichero antes que
 * importar el fixture y comprobarlo contra si mismo.
 *
 * El valor es un token de MENTIRA con la FORMA del real: 43 caracteres
 * base64url, opaco, sin nada dentro que decodificar (DEC-006).
 */
const SESSION_COOKIE = "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz";

/**
 * Cookie de sesion de PERSONAL (DEC-006, DEC-048).
 *
 * Es la que emite la API simulada al superar el segundo factor. Se repite aqui
 * por el mismo motivo que la de participante: si alguien cambia el nombre o el
 * valor en `src/mocks/dev-server.ts` sin actualizar esta linea, el humo dejaria
 * de probar el panel CON sesion y seguiria en verde probando la pantalla de
 * acceso.
 *
 * SU NOMBRE LLEVA EL SUFIJO `_staff` Y SU `Path` REAL ES `/admin`. Aqui el
 * `Path` no interviene -este cliente manda la cabecera a mano- pero es
 * exactamente la razon de que el panel viva en `/admin/[locale]`: desde
 * `/es/admin` un navegador de verdad no la enviaria y el panel quedaria
 * permanentemente deslogueado.
 *
 * Token de MENTIRA con la FORMA del real: 43 caracteres base64url, opaco.
 */
const STAFF_COOKIE = "lsw_dev_session_staff=Bd4kM9tXr6ZaP1wQ7nJc2sF5hL8gV3eY-uRiO_pCz0T";

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
      "Sorteo promocional GMC Denali 2025",
      // La DESCRIPCION del premio: sale del DETALLE, no del resumen, asi que
      // comprobarla aqui prueba de paso que la portada consigue las dos
      // peticiones y que el hero recibe la segunda (DEC-042). Se comprueba la
      // descripcion y no el nombre porque el nombre -"GMC Denali 2025"- esta
      // contenido en el titulo de la promocion, y entonces bastaria el resumen
      // para dar el check por bueno.
      "entregada lista para circular",
      // La FOTOGRAFIA real del cliente, servida por el optimizador de Next: la
      // ruta viaja codificada dentro de la URL de la imagen optimizada.
      "%2Fprizes%2Fgmc-2025-hero.jpg",
      // Y su texto alternativo, en el idioma de la pagina.
      "Camioneta GMC Denali 2025 plateada",
      "$65,000.00",
      // El universo de participaciones, formateado con la convencion de es-US.
      "10,000",
      // Mercancia destacada: la portada tambien depende del catalogo.
      "Camiseta de algodón grueso",
    ],
  },
  {
    path: "/en",
    expect: [
      "The 2025 GMC Denali Sweepstakes",
      "delivered ready to drive",
      "%2Fprizes%2Fgmc-2025-hero.jpg",
      "Silver GMC Denali 2025 pickup",
      "$65,000.00",
      "10,000",
      "Heavyweight Cotton Tee",
    ],
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
      "Sorteo promocional Lone Star Road Trip",
      "Sorteo promocional GMC Denali 2025",
      "Sorteo promocional Coastal Run",
    ],
  },
  {
    // La promocion protagonista (DEC-042). Su detalle tiene que servir el
    // premio y el valor declarado, que es lo que el hero de la portada consume.
    path: "/es/promotions/gmc-2025",
    expect: [
      "Sorteo promocional GMC Denali 2025",
      "GMC Denali 2025",
      "entregada lista para circular",
      "$65,000.00",
    ],
  },
  {
    path: "/es/promotions/road-trip-2027",
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

  // --- Identidad -----------------------------------------------------------
  //
  // Sin datos de fixture que comprobar: lo que se prueba es que responden 200 y
  // que NO renderizan el estado de error de la capa de API, que es exactamente
  // lo que pasaria si la lectura de sesion de la cabecera fallara.
  { path: "/es/account/login", expect: [] },
  { path: "/en/account/login", expect: [] },
  { path: "/es/account/register", expect: [] },
  { path: "/es/account/forgot-password", expect: [] },
  { path: "/es/account/reset-password", expect: [] },
  { path: "/es/account/verify-email", expect: [] },
  /*
   * El segundo factor SIN sesion: la pantalla existe y dice que no hay nada que
   * completar, en vez de romperse. Es el estado que ve cualquiera que abra la
   * URL de memoria.
   */
  { path: "/es/account/mfa", expect: [] },

  // --- Portal SIN sesion ---------------------------------------------------
  //
  // El estado "inicia sesion" NO es un error, y esta es la unica red que lo
  // distingue de uno: si estas rutas pintaran el estado de error, el humo
  // fallaria aunque respondieran 200.
  { path: "/es/account", expect: [] },
  { path: "/es/account/entries", expect: [] },
  { path: "/es/account/orders", expect: [] },
  { path: "/en/account/profile", expect: [] },
  { path: "/es/checkout", expect: [] },

  // --- Portal CON sesion ---------------------------------------------------
  //
  // La cookie es la que emite la API simulada al iniciar sesion (ver
  // `src/mocks/dev-server.ts`). El valor se repite aqui a proposito, igual que
  // `ERROR_STATE_TEXTS`: si alguien lo cambia sin actualizar esta lista, el
  // humo deja de probar el portal con sesion y prefiero que eso se vea al leer
  // el fichero antes que importar el fixture y comprobarlo contra si mismo.
  //
  // Es un token de MENTIRA con la FORMA del real: 43 caracteres base64url,
  // opaco, sin nada dentro que decodificar.
  {
    path: "/es/account",
    headers: { cookie: SESSION_COOKIE },
    // El nombre sale de la sesion y la cifra del saldo, que son dos rutas
    // distintas del portal: si una fallara, la otra seguiria apareciendo.
    expect: ["Alex Rivera", "11,450"],
  },
  {
    path: "/en/account",
    headers: { cookie: SESSION_COOKIE },
    expect: ["Alex Rivera", "11,450"],
  },
  {
    path: "/es/account/entries",
    headers: { cookie: SESSION_COOKIE },
    // El desglose por procedencia: compra y AMOE en el mismo conjunto.
    expect: ["11,450", "11,250", "200"],
  },
  {
    path: "/es/account/entries/ledger",
    headers: { cookie: SESSION_COOKIE },
    // Un movimiento positivo y uno NEGATIVO: la devolucion tiene que verse.
    expect: ["11,000", "-500"],
  },
  {
    path: "/es/account/orders",
    headers: { cookie: SESSION_COOKIE },
    expect: ["LSW-10524", "LSW-10608"],
  },
  {
    path: "/es/account/orders/ord_0000000000000001",
    headers: { cookie: SESSION_COOKIE },
    // La traza del calculo, con su version de reglas: es lo que permite
    // explicar la cifra meses despues (DEC-012).
    expect: ["LSW-10524", "prv_0000000000000001", "250"],
  },
  {
    path: "/en/account/profile",
    headers: { cookie: SESSION_COOKIE },
    expect: ["participant@example.com"],
  },
  {
    path: "/es/checkout",
    headers: { cookie: `${SESSION_COOKIE}; lsw_dev_cart=1` },
    expect: ["Camiseta de algodón grueso", "250"],
  },
  {
    // La vuelta del proveedor con un borrador que nadie ha pagado todavia. La
    // pagina NO se cree la URL: pregunta al backend y pinta "pendiente".
    path: "/es/checkout/return?draft=chk_0000000000000001",
    headers: { cookie: SESSION_COOKIE },
    expect: [],
  },
  {
    path: "/es/orders/ord_0000000000000002/confirmation",
    headers: { cookie: SESSION_COOKIE },
    // Pedido pagado con las participaciones TODAVIA no otorgadas: la pantalla
    // tiene que decirlo sin prometer nada.
    expect: ["LSW-10608"],
  },

  // --- Via gratuita de participacion (FE-M6) ------------------------------
  //
  // El fixture por defecto es `amoe_enabled: false`, que es el estado real hoy.
  // Lo que se comprueba es que la ruta responde 200 con su estado DELIBERADO y
  // no con el estado de error: la funcion no existe, y eso no es un fallo.
  { path: "/es/amoe", expect: [] },
  { path: "/en/amoe", expect: [] },
  {
    // Con sesion y la via apagada, el portal tampoco se rompe: alguien puede
    // tener envios de una promocion anterior y llegar aqui desde un marcador.
    path: "/es/account/amoe",
    headers: { cookie: SESSION_COOKIE },
    expect: [],
  },

  /*
   * LAS CUATRO MODALIDADES NO SE PRUEBAN AQUI, Y CONVIENE SABER POR QUE.
   *
   * Se intento y no puede funcionar con un servidor solo: el escenario de la
   * API simulada se elige con `LSW_DEV_AMOE`, una variable de entorno del
   * proceso, porque `GET /config` y `GET /promotions/:slug/amoe-config` son
   * rutas PUBLICAS y la interfaz las pide sin sesion, de modo que ninguna
   * cookie llega hasta ellas. Eso es correcto -la configuracion publica no
   * viaja con credenciales- y no se cambia por comodidad de una red.
   *
   * Probar las cuatro exigiria arrancar cuatro servidores, que es mucho coste
   * para lo que ya cubren `src/test/amoe.test.tsx` (las cuatro modalidades, la
   * apagada, la encendida sin modalidad y la de formulario sin campos) y
   * `src/test/amoe-actions.test.ts` (que el payload lleva SOLO los campos
   * declarados). Lo que esta red aporta y ninguna otra puede es que la ruta
   * exista y responda con su estado deliberado, que es lo de arriba.
   *
   * Para verlas en el navegador:
   *   LSW_DEV_AMOE=ONLINE_FORM pnpm --filter @lsw/web dev
   */

  // --- Panel de administracion (FE-M7, DEC-048) ---------------------------
  //
  // ESTAS RUTAS SON LA RED DE DEC-048. Si el panel acabara colgando de
  // `/[locale]/admin`, estas comprobaciones darian 404 aqui mismo, que es
  // muchisimo mejor que descubrirlo cuando la cookie de personal deja de viajar
  // y el sintoma es "inicio sesion y me devuelve al login".
  { path: "/admin/es/login", expect: [] },
  { path: "/admin/en/login", expect: [] },
  {
    // Sin sesion, el panel NO es un error: pide iniciar sesion. Si esta ruta
    // pintara el estado de error, el humo fallaria aunque respondiera 200.
    path: "/admin/es",
    expect: [],
  },
  {
    // La portada del panel CON sesion de personal. El correo sale de la sesion
    // y la cifra del cuadro de mando, que son dos lecturas distintas: si una
    // fallara, la otra seguiria apareciendo.
    path: "/admin/es",
    headers: { cookie: STAFF_COOKIE },
    expect: ["promotions@example.com", "PROMOTION_MANAGER", "1,284,500"],
  },
  {
    path: "/admin/en",
    headers: { cookie: STAFF_COOKIE },
    expect: ["promotions@example.com", "1,284,500"],
  },
  {
    // Cola de revision AMOE: el envio de un participante y el codigo del otro.
    path: "/admin/es/amoe",
    headers: { cookie: STAFF_COOKIE },
    expect: ["participant@example.com", "LSW-FREE-4821"],
  },
  {
    // Promociones, con la version de reglas vigente en el listado.
    path: "/admin/es/promotions",
    headers: { cookie: STAFF_COOKIE },
    expect: ["Sorteo promocional GMC Denali 2025"],
  },
  {
    // SIN idioma: lo pone la negociacion propia del panel (DEC-048).
    path: "/admin",
    expect: [],
  },
  {
    /*
     * LA COMPROBACION QUE RESUME DEC-048 ENTERA.
     *
     * Se pide `/admin/amoe` -sin idioma- con la cookie de personal. Para que
     * esto sirva datos tienen que cumplirse las tres cosas a la vez: que el
     * middleware redirija conservando la ruta, que el idioma acabe DENTRO de
     * `/admin`, y que la cookie de personal siga viajando despues de la
     * redireccion. Si el panel colgara de `/[locale]/admin`, la ultima fallaria.
     */
    path: "/admin/amoe",
    headers: { cookie: STAFF_COOKIE },
    expect: ["participant@example.com"],
  },
  {
    /*
     * Sesion de PARTICIPANTE en el panel. Ocurre a diario: la cookie del
     * escaparate tiene `Path=/` y viaja tambien a `/admin`. Tiene que verse el
     * 403 deliberado, NO el estado de error y NO el formulario de personal.
     */
    path: "/admin/es",
    headers: { cookie: SESSION_COOKIE },
    expect: [],
  },
  {
    /*
     * EL PANEL NO EXISTE BAJO EL ESCAPARATE, y esta es la red que lo prueba.
     * Si algun dia alguien crea `app/[locale]/admin`, esta comprobacion pasa a
     * responder 200 y el humo falla, que es exactamente lo que tiene que pasar:
     * ahi la cookie de personal no viaja.
     */
    path: "/es/admin",
    status: 404,
    expect: [],
  },
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

/* eslint-disable security/detect-non-literal-fs-filename --
 * Las rutas de este bloque se componen con `join(APP_DIR, ...)` a partir de la
 * lista literal `NEXT_MANAGED_FILES`, declarada aqui mismo. No hay ninguna
 * ruta que un visitante -ni el entorno- pueda influir, y esto ademas no es
 * codigo servido: es la herramienta que arranca el humo. */

/**
 * FICHEROS VERSIONADOS QUE NEXT REESCRIBE SEGUN EL `distDir`.
 *
 * POR QUE EXISTE ESTA LISTA
 * -------------------------
 * `next dev` no solo LEE la configuracion del proyecto: al arrancar ESCRIBE en
 * el arbol de fuentes para dejar la integracion de TypeScript apuntando a su
 * directorio de build. Mientras el humo compartia `.next` con todo el mundo,
 * eso era invisible -reescribia los mismos valores que ya estaban-. Con el
 * `distDir` propio (`.next-smoke`) deja de serlo: cada fichero de esta lista
 * queda apuntando a un directorio generado que solo existe mientras corre el
 * humo, en un fichero que esta EN GIT.
 *
 * El sintoma es de los caros: el arbol se ensucia solo, el diff aparece en el
 * commit de otro, y `format:check` falla en un fichero que nadie edito.
 *
 * ES UNA LISTA EXPLICITA, no un descubrimiento automatico. Cada entrada dice
 * QUE reescribe Next en ella, porque el dia que Next cambie de estrategia esa
 * frase es lo que permite comprobar si la entrada sigue haciendo falta.
 */
const NEXT_MANAGED_FILES = [
  {
    name: "tsconfig.json",
    // Next se asegura de que `include` contenga los tipos generados bajo su
    // `distDir`, y de paso reserializa el fichero entero con su propio formato
    // -lo que ademas rompe `format:check`, que si tiene opinion sobre el.
    why: "include de los tipos generados + reserializado",
  },
  {
    name: "next-env.d.ts",
    // La cabecera lleva una `/// <reference path="./<distDir>/types/routes.d.ts" />`
    // que Next reescribe con el `distDir` en vigor. Hallazgo de la sesion de
    // Railway: un build con `LSW_NEXT_DIST_DIR=.next-build` se lo dejo apuntando
    // ahi. El fichero dice "should not be edited" y esta versionado: las dos
    // cosas a la vez significan que quien lo toque tiene que devolverlo.
    why: "referencia a los tipos de rutas del distDir",
  },
];

/**
 * Lee los ficheros de `NEXT_MANAGED_FILES` ANTES de arrancar el hijo.
 *
 * Devuelve una instantanea; `null` en `content` significa que el fichero no
 * estaba, y entonces no hay nada que devolver (no se crea uno nuevo: restaurar
 * es deshacer un cambio, no inventarse un fichero).
 */
function captureNextManagedFiles() {
  return NEXT_MANAGED_FILES.map((entry) => {
    const path = join(APP_DIR, entry.name);

    try {
      return { ...entry, path, content: readFileSync(path, "utf8") };
    } catch {
      return { ...entry, path, content: null };
    }
  });
}

/**
 * Devuelve cada fichero a como estaba antes de arrancar el hijo.
 *
 * Solo escribe si el contenido CAMBIO, para no tocar la fecha de un fichero
 * que nadie modifico. Un fallo al restaurar se avisa pero no tumba el humo: el
 * resultado de las comprobaciones sigue siendo valido y lo que hay que ver es
 * que quedo un fichero sucio.
 */
function restoreNextManagedFiles(snapshot) {
  for (const entry of snapshot) {
    if (entry.content === null) continue;

    try {
      if (readFileSync(entry.path, "utf8") === entry.content) continue;
      writeFileSync(entry.path, entry.content);
      log(`[smoke] ${entry.name} restaurado: lo reescribio el next dev del humo (${entry.why}).`);
    } catch (error) {
      log(`[smoke] AVISO: no se pudo restaurar ${entry.name}: ${String(error)}`);
    }
  }
}

/* eslint-enable security/detect-non-literal-fs-filename */

async function main() {
  const nextBin = require.resolve("next/dist/bin/next");

  // Se guardan ANTES de arrancar: el hijo los reescribe. Ver
  // `NEXT_MANAGED_FILES`.
  const managedBefore = captureNextManagedFiles();

  log(`[smoke] arrancando next dev en ${BASE} con API simulada en ${API_BASE_URL}`);

  const child = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: "development",
      // Explicito: esta red comprueba la aplicacion CON la API simulada. Si
      // alguien apaga los mocks en su entorno, el humo tiene que seguir
      // probando lo mismo.
      WEB_ENABLE_API_MOCKS: "true",
      // Y en SU puerto, no en el de quien tenga un servidor abierto. Ver la
      // nota de `API_PORT`. Se pisan las dos variables que lee `apiBaseUrl()`,
      // porque un `.env` local podria declarar cualquiera de ellas.
      API_BASE_URL,
      NEXT_PUBLIC_API_BASE_URL: API_BASE_URL,
      // Y su propio DIRECTORIO DE BUILD. Ver `DIST_DIR` mas arriba.
      LSW_NEXT_DIST_DIR: DIST_DIR,
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

      /*
       * `status` es opcional y por defecto 200. Existe para poder comprobar una
       * AUSENCIA: que el panel NO se sirve bajo el prefijo del escaparate. Sin
       * el, una ruta que empezara a responder 200 donde no debe pasaria
       * desapercibida, porque el humo solo sabria buscar datos en ella.
       */
      const expectedStatus = check.status ?? 200;
      if (response.status !== expectedStatus) {
        problems.push(`HTTP ${response.status}, se esperaba ${expectedStatus}`);
      }

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
    restoreNextManagedFiles(managedBefore);
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
