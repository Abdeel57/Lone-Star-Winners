// ---------------------------------------------------------------------------
// apps/web - Next.js (App Router).
//
// DEC-004  `output: "standalone"`. La decision de hosting sigue abierta, asi que
//          el build no puede dar por supuesto Vercel: `standalone` produce un
//          servidor Node autocontenido que corre en cualquier sitio.
// DEC-021  i18n con next-intl. Ambos locales llevan prefijo de ruta.
// ---------------------------------------------------------------------------

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
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
