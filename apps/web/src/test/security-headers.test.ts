import { afterEach, describe, expect, it, vi } from "vitest";

import { apiConnectOrigins, contentSecurityPolicy, createNonce } from "@/lib/security-headers";

/**
 * CABECERAS DE SEGURIDAD (HO-034 punto 3).
 *
 * `apps/web` no emitia NINGUNA -ni CSP, ni HSTS, ni `nosniff`- en ningun
 * entorno, mientras `apps/api` si las emitia. Esta red cubre las dos mitades de
 * la solucion, que viven en sitios distintos por un motivo:
 *
 *   - las ESTATICAS, en `headers()` de `next.config.mjs`;
 *   - la CSP, en `src/middleware.ts`, porque necesita un nonce por peticion.
 *
 * Lo que estos tests NO pueden ver es si el navegador bloquea algo de verdad.
 * Para eso esta la comprobacion en vivo con `curl -I` contra el servidor de
 * desarrollo, que es donde se midio que Next emite mas de cien `<script>` en
 * linea por pagina.
 */

const NONCE = "AbCd0123+/xyz==";

function directivesOf(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const directive of policy.split(";")) {
    const parts = directive.trim().split(/\s+/);
    const name = parts[0];
    if (name === undefined || name === "") continue;
    map.set(name, parts.slice(1));
  }

  return map;
}

describe("Content-Security-Policy", () => {
  const production = contentSecurityPolicy({
    nonce: NONCE,
    isDevelopment: false,
    connectOrigins: [],
  });
  const development = contentSecurityPolicy({
    nonce: NONCE,
    isDevelopment: true,
    connectOrigins: [],
  });

  it("declara las directivas que cierran el sitio", () => {
    const directives = directivesOf(production);

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("font-src")).toEqual(["'self'"]);
    expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });

  it("prohibe que nadie meta el sitio en un iframe", () => {
    // `frame-ancestors` es la defensa REAL contra el clickjacking.
    // `X-Frame-Options: DENY` -que tambien se emite- es su version vieja.
    expect(directivesOf(production).get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("los scripts en linea van por NONCE y nunca por 'unsafe-inline'", () => {
    // Es la decision central de HO-034 punto 3. `'unsafe-inline'` autorizaria
    // tambien al script que inyecte un atacante, que es de lo que protege la
    // politica: la dejaria decorativa.
    const scriptSrc = directivesOf(production).get("script-src");

    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("`script-src` va ANTES de cualquier `script-src-*`", () => {
    /*
     * No es cosmetica. Next busca "la primera directiva cuyo nombre empieza por
     * `script-src`" para sacar el nonce
     * (`app-render/get-script-nonce-from-header.js`), y `script-src-elem`
     * tambien empieza asi. Si algun dia se anade una y queda delante, Next
     * buscaria el nonce en la directiva equivocada, no lo encontraria, y los
     * scripts saldrian sin nonce: la pagina se veria y no funcionaria.
     */
    const names = [...directivesOf(production).keys()];
    const scriptSrc = names.indexOf("script-src");

    expect(scriptSrc).toBeGreaterThanOrEqual(0);

    for (const [index, name] of names.entries()) {
      if (name.startsWith("script-src") && name !== "script-src") {
        expect(index).toBeGreaterThan(scriptSrc);
      }
    }
  });

  it("'unsafe-eval' y `ws:` existen SOLO en desarrollo", () => {
    // El recargado en caliente de webpack compila con `eval` y habla por
    // WebSocket. Ninguna de las dos cosas puede llegar a produccion.
    expect(directivesOf(development).get("script-src")).toContain("'unsafe-eval'");
    expect(directivesOf(development).get("connect-src")).toContain("ws:");

    expect(directivesOf(production).get("script-src")).not.toContain("'unsafe-eval'");
    expect(directivesOf(production).get("connect-src")).not.toContain("ws:");
    expect(production).not.toContain("unsafe-eval");
  });

  it("admite atributos `style` en linea, y dice por que", () => {
    /*
     * `next/image` emite `style="color:transparent"` en cada imagen y la barra
     * de la linea de tiempo lleva su anchura en el atributo. Un atributo no
     * admite nonce -no es un elemento- asi que la alternativa seria una lista de
     * hashes que cambiaria con cada anchura. Se documenta en vez de fingir que
     * es gratis.
     */
    expect(directivesOf(production).get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("el nonce viaja con el formato que Next reconoce", () => {
    // El patron es el de `get-script-nonce-from-header.js`. Un nonce con un
    // caracter fuera de ese conjunto se ignora en silencio.
    const nonce = createNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
    expect(nonce.length).toBeGreaterThanOrEqual(16);
  });

  it("dos nonces seguidos no se parecen", () => {
    expect(createNonce()).not.toEqual(createNonce());
  });
});

describe("connect-src y el origen de la API", () => {
  it("anade el origen PUBLICO de la API cuando esta declarado", () => {
    const origins = apiConnectOrigins(
      { NEXT_PUBLIC_API_BASE_URL: "https://api.example.test/api/v1" },
      "https://tienda.example.test",
    );

    expect(origins).toEqual(["https://api.example.test"]);
  });

  it("NO publica el origen de la variable privada `API_BASE_URL`", () => {
    /*
     * `API_BASE_URL` es deliberadamente no publica (`src/lib/api/http.ts`): el
     * navegador no habla con `apps/api`. Escribir su origen en una cabecera que
     * se sirve al navegador publicaria justo lo que esa decision mantiene
     * privado, y a cambio de nada.
     */
    const origins = apiConnectOrigins(
      { API_BASE_URL: "http://api-interna.local:4000/api/v1" },
      "https://tienda.example.test",
    );

    expect(origins).toEqual([]);
  });

  it("no repite el propio origen", () => {
    const origins = apiConnectOrigins(
      { NEXT_PUBLIC_API_BASE_URL: "https://tienda.example.test/api/v1" },
      "https://tienda.example.test",
    );

    expect(origins).toEqual([]);
  });

  it("una URL invalida se ignora en vez de tumbar el sitio", () => {
    // Degradar a `connect-src 'self'` sigue siendo seguro. Lanzar aqui dejaria
    // la aplicacion entera sin servir por una variable mal escrita.
    expect(apiConnectOrigins({ NEXT_PUBLIC_API_BASE_URL: "esto-no-es-una-url" }, null)).toEqual([]);
    expect(apiConnectOrigins({ NEXT_PUBLIC_API_BASE_URL: "" }, null)).toEqual([]);
    expect(apiConnectOrigins({}, null)).toEqual([]);
  });

  it("el origen declarado aparece en la politica", () => {
    const policy = contentSecurityPolicy({
      nonce: NONCE,
      isDevelopment: false,
      connectOrigins: ["https://api.example.test"],
    });

    expect(directivesOf(policy).get("connect-src")).toEqual(["'self'", "https://api.example.test"]);
  });
});

/**
 * Las cabeceras estaticas, leidas de la CONFIGURACION REAL.
 *
 * Se importa `next.config.mjs` y se ejecuta su `headers()`, en vez de repetir
 * aqui la lista esperada y comprobarla contra si misma. Si alguien quita una
 * cabecera de la configuracion, este test se pone rojo; si solo cambia el
 * comentario, no.
 */
describe("headers() de next.config.mjs", () => {
  async function headerRules(): Promise<
    { source: string; headers: { key: string; value: string }[] }[]
  > {
    const config = (await import("../../next.config.mjs")) as {
      default: {
        headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
      };
    };
    return config.default.headers();
  }

  function valueOf(
    rules: { source: string; headers: { key: string; value: string }[] }[],
    source: string,
    key: string,
  ): string | undefined {
    return rules
      .find((rule) => rule.source === source)
      ?.headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cubre TODAS las rutas, no solo unas cuantas", async () => {
    const rules = await headerRules();
    expect(rules.some((rule) => rule.source === "/:path*")).toBe(true);
  });

  it("emite nosniff, Referrer-Policy, X-Frame-Options y Permissions-Policy", async () => {
    const rules = await headerRules();

    expect(valueOf(rules, "/:path*", "X-Content-Type-Options")).toBe("nosniff");
    expect(valueOf(rules, "/:path*", "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(valueOf(rules, "/:path*", "X-Frame-Options")).toBe("DENY");
    expect(valueOf(rules, "/:path*", "Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
  });

  it("HSTS SOLO en produccion", async () => {
    /*
     * En desarrollo no se emite, y no es una omision. Un navegador que reciba
     * HSTS de `localhost` se niega a volver a hablar por HTTP con `localhost`
     * -en cualquier puerto y para cualquier proyecto- hasta que se limpie el
     * estado del navegador a mano.
     */
    vi.stubEnv("NODE_ENV", "development");
    expect(valueOf(await headerRules(), "/:path*", "Strict-Transport-Security")).toBeUndefined();

    vi.stubEnv("NODE_ENV", "production");
    expect(valueOf(await headerRules(), "/:path*", "Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("HSTS no se apunta a la lista de precarga", async () => {
    // `preload` es irreversible en la practica y la decision de dominio no esta
    // tomada. Apuntarse por descuido no tiene vuelta atras.
    vi.stubEnv("NODE_ENV", "production");
    expect(valueOf(await headerRules(), "/:path*", "Strict-Transport-Security")).not.toContain(
      "preload",
    );
  });

  it("la sonda de liveness no se cachea", async () => {
    // Un intermediario que guarde esta respuesta convierte la sonda en una
    // mentira: seguiria devolviendo `ok` con el proceso ya caido (DEC-043).
    expect(valueOf(await headerRules(), "/healthz", "Cache-Control")).toBe("no-store");
  });

  it("NO declara una segunda Content-Security-Policy", async () => {
    /*
     * Es la comprobacion mas importante de este bloque y la menos evidente.
     * Dos cabeceras `Content-Security-Policy` se aplican por INTERSECCION: una
     * estatica con `script-src 'self'` volveria a bloquear los scripts que el
     * middleware autoriza con nonce, y el sintoma seria una aplicacion muerta en
     * el navegador sin un solo error en el servidor.
     */
    const rules = await headerRules();

    for (const rule of rules) {
      for (const header of rule.headers) {
        expect(header.key.toLowerCase()).not.toBe("content-security-policy");
      }
    }
  });
});
