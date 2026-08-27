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

/**
 * Cabeceras de seguridad ESTATICAS (HO-034 punto 3).
 *
 * `apps/web` no emitia ninguna -ni CSP, ni HSTS, ni `nosniff`- en ningun
 * entorno, mientras `apps/api` si las emitia. Estas son las que no dependen de
 * la peticion; la Content-Security-Policy NO esta aqui y eso es deliberado.
 *
 * POR QUE LA CSP FALTA EN ESTA LISTA
 * ----------------------------------
 * La emite `src/middleware.ts`, porque necesita un NONCE distinto en cada
 * peticion: Next 15 emite mas de cien `<script>` en linea por pagina -el
 * payload de React Server Components- y sin nonce solo quedaria autorizarlos con
 * `'unsafe-inline'`, que autoriza tambien al que inyecte un atacante. El
 * razonamiento completo esta en `src/lib/security-headers.ts`.
 *
 * Aqui NO puede anadirse una segunda politica: dos cabeceras
 * `Content-Security-Policy` se aplican por INTERSECCION, de modo que una
 * estatica con `script-src 'self'` volveria a bloquear los scripts con nonce.
 * El sintoma seria una aplicacion muerta en el navegador sin un solo error en el
 * servidor.
 */
const STATIC_SECURITY_HEADERS = [
  // Sin esto, una respuesta que el navegador decida "adivinar" como HTML puede
  // ejecutarse como HTML. Es la cabecera mas barata del lote.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // El `Referer` sale completo entre paginas del sitio y se reduce al ORIGEN al
  // salir a otro dominio. Sin esto, un enlace externo desde
  // `/account/orders/ord_...` filtraria el identificador del pedido a un tercero.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /*
   * Redundante con `frame-ancestors 'none'` de la CSP, y se pone igual: es
   * inofensiva y sigue siendo lo unico que entienden los navegadores viejos.
   * Si algun dia las dos discrepan, manda `frame-ancestors`.
   */
  { key: "X-Frame-Options", value: "DENY" },

  /*
   * Se NIEGAN las capacidades que esta aplicacion no usa. La lista es corta a
   * proposito: enumerar cuarenta directivas que nadie mantiene envejece peor
   * que negar las cuatro que importan.
   *
   * `payment=()` merece una nota: si el proveedor de pago que se elija
   * (DEC-004 lo deja abierto) necesita la Payment Request API dentro de un
   * componente incrustado, habra que abrirla explicitamente. Hoy no hay
   * proveedor y por tanto no hay nada que permitir.
   */
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/**
 * HSTS, SOLO en produccion.
 *
 * Dos anos, con subdominios. En desarrollo NO se emite, y no es una omision:
 * un navegador que reciba HSTS de `localhost` se niega a volver a hablar por
 * HTTP con `localhost` -en CUALQUIER puerto y para cualquier proyecto- hasta
 * que se limpie el estado del navegador a mano. Se arregla, pero cuesta una
 * tarde y el sintoma no se parece a su causa.
 *
 * No lleva `preload`: apuntarse a la lista de precarga es irreversible en la
 * practica y la decision de dominio no esta tomada.
 */
const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};

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

  headers() {
    const isProduction = process.env.NODE_ENV === "production";
    const common = isProduction
      ? [...STATIC_SECURITY_HEADERS, HSTS_HEADER]
      : STATIC_SECURITY_HEADERS;

    return Promise.resolve([
      { source: "/:path*", headers: common },
      {
        /*
         * La sonda de liveness (DEC-043) NO se cachea. Un intermediario que
         * guarde esta respuesta convierte la sonda en una mentira: seguiria
         * devolviendo `ok` con el proceso ya caido.
         *
         * El propio manejador de ruta ya lo declara. Se repite aqui porque las
         * dos capas responden a preguntas distintas -una es el contenido de la
         * respuesta, la otra la politica del despliegue- y porque un futuro
         * cambio en el manejador no debe poder quitar la garantia en silencio.
         */
        source: "/healthz",
        headers: [...common, { key: "Cache-Control", value: "no-store" }],
      },
    ]);
  },

  // El lint es una tarea propia de Turborepo (`turbo run lint`) con la
  // configuracion del monorepo; el build no debe ejecutar otra distinta.
  eslint: { ignoreDuringBuilds: true },
  // Los errores de tipos SI paran el build: es la mitad de DEC-002.
  typescript: { ignoreBuildErrors: false },
};

export default withNextIntl(nextConfig);
