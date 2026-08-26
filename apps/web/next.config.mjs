// ---------------------------------------------------------------------------
// apps/web - Next.js (App Router).
//
// DEC-004  `output: "standalone"`. La decision de hosting sigue abierta, asi que
//          el build no puede dar por supuesto Vercel: `standalone` produce un
//          servidor Node autocontenido que corre en cualquier sitio.
// DEC-021  i18n con next-intl. Ambos locales llevan prefijo de ruta.
// ---------------------------------------------------------------------------

import { join } from "node:path";

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Raiz del monorepo.
 *
 * Con `output: "standalone"` Next copia el arbol de dependencias trazado a
 * partir de esta raiz. Si no se declara, la infiere buscando lockfiles hacia
 * arriba, y basta con que exista un `package-lock.json` suelto en el directorio
 * personal del desarrollador para que elija ese: el build "pasa", pero el
 * `standalone` sale anidado bajo la ruta equivocada y SIN `server.js`, es decir
 * inservible, y solo se descubre al desplegar.
 *
 * Se declara explicitamente para que el resultado no dependa de que haya o no
 * ficheros ajenos fuera del repositorio.
 */
const monorepoRoot = join(import.meta.dirname, "..", "..");

/**
 * Directorio de build, aislable por entorno (`LSW_NEXT_DIST_DIR`).
 *
 * POR QUE EXISTE ESTA VARIABLE
 * ----------------------------
 * `scripts/smoke.mjs` arranca SU PROPIO `next dev` para comprobar el HTML
 * servido. Ya tenia puerto propio para Next y puerto propio para la API
 * simulada, pero seguia escribiendo en el MISMO `.next` que el servidor de
 * desarrollo que alguien tenga abierto. Dos `next dev` sobre el mismo
 * directorio de build se pisan: uno reescribe manifiestos y `chunks` mientras
 * el otro los esta leyendo, y el sintoma no se parece a su causa
 * -`app-paths-manifest.json` que desaparece, `Cannot find module './963.js'`,
 * un `vendor-chunks` ausente, 500 intermitentes en una ruta cualquiera-, de
 * modo que se investiga en el sitio equivocado.
 *
 * `distDir` es opcion de este fichero, no una variable que Next lea por su
 * cuenta, asi que la unica forma de que un proceso hijo pida otro directorio es
 * que la configuracion la lea. El valor por defecto NO cambia: sin variable, el
 * build normal escribe en `.next` y todo lo que asume ese nombre
 * -`output: standalone`, el trazado de ficheros, los scripts de limpieza-
 * sigue funcionando igual.
 *
 * SE VALIDA porque este valor se convierte en una RUTA de escritura: se admite
 * un unico nombre relativo simple, sin separadores y sin `..`. Un valor con
 * travesia de directorios haria que un build escribiera fuera del proyecto.
 */
function resolveDistDir(raw) {
  if (raw === undefined || raw === "") return ".next";

  const isSimpleName = /^[A-Za-z0-9._-]+$/.test(raw) && raw !== "." && raw !== "..";

  if (!isSimpleName) {
    throw new Error(
      `LSW_NEXT_DIST_DIR debe ser un nombre de directorio simple (recibido: "${raw}").`,
    );
  }

  return raw;
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: resolveDistDir(process.env.LSW_NEXT_DIST_DIR),
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,
  // Cabecera `X-Powered-By`: informacion gratuita para quien enumere el stack.
  poweredByHeader: false,

  // Los paquetes internos se publican como codigo fuente TypeScript, sin paso
  // de build propio: Next los compila igual que el codigo de la app.
  transpilePackages: ["@lsw/ui", "@lsw/design-system"],

  // MSW intercepta a nivel de `http`/`undici`; empaquetarlo rompe la
  // interceptacion. Solo se carga en desarrollo (ver src/instrumentation.ts).
  serverExternalPackages: ["msw", "@mswjs/interceptors"],

  // El lint es una tarea propia de Turborepo (`turbo run lint`) con la
  // configuracion del monorepo; el build no debe ejecutar otra distinta.
  eslint: { ignoreDuringBuilds: true },
  // Los errores de tipos SI paran el build: es la mitad de DEC-002.
  typescript: { ignoreBuildErrors: false },
};

export default withNextIntl(nextConfig);
