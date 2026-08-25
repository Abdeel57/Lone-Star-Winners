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

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
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
