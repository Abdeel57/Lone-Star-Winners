import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ADMIN_BASE,
  adminHref,
  adminLocaleOf,
  adminRedirectPath,
  isAdminPath,
  localeFromAcceptLanguage,
  LOCALE_COOKIE,
  negotiateAdminLocale,
} from "@/i18n/admin-routing";
import { LOCALES } from "@/i18n/locales";

/**
 * ENRUTADO DEL PANEL (DEC-048).
 *
 * POR QUE ESTE FICHERO EXISTE
 * ---------------------------
 * El fallo que previene no se parece a un fallo: si el panel acabara en
 * `/es/admin/...`, cada pantalla responderia 200, el HTML se renderizaria
 * entero, y lo unico que pasaria es que el navegador no enviaria la cookie de
 * personal -porque tiene `Path=/admin` (DEC-006)- y el panel quedaria
 * permanentemente deslogueado. El sintoma seria "inicio sesion y me devuelve al
 * login", sin ningun error en ningun log.
 *
 * Asi que aqui se comprueban las dos mitades de DEC-048:
 *   1. que toda ruta del panel empieza por `/admin` y lleva su idioma DESPUES;
 *   2. que el comodin del escaparate no se lleva `/admin` por delante.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rutas del panel (DEC-048)", () => {
  it("toda ruta del panel empieza por /admin y el idioma va despues", () => {
    for (const locale of LOCALES) {
      expect(adminHref(locale)).toBe(`/admin/${locale}`);
      expect(adminHref(locale, "/amoe")).toBe(`/admin/${locale}/amoe`);
      expect(adminHref(locale, "amoe")).toBe(`/admin/${locale}/amoe`);
      expect(adminHref(locale, "/")).toBe(`/admin/${locale}`);

      // La forma que romperia la cookie de personal. Si algun dia una de estas
      // aserciones falla, el panel deja de recibir su sesion.
      expect(adminHref(locale)).not.toBe(`/${locale}/admin`);
      expect(adminHref(locale, "/amoe").startsWith(ADMIN_BASE)).toBe(true);
    }
  });

  it("reconoce lo que es del panel y lo que no", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/es")).toBe(true);
    expect(isAdminPath("/admin/es/amoe")).toBe(true);

    expect(isAdminPath("/es/admin")).toBe(false);
    expect(isAdminPath("/administracion")).toBe(false);
    expect(isAdminPath("/es")).toBe(false);
    expect(isAdminPath("/")).toBe(false);
  });

  it("lee el idioma de una ruta del panel, y solo cuando es uno soportado", () => {
    expect(adminLocaleOf("/admin/es/amoe")).toBe("es");
    expect(adminLocaleOf("/admin/en")).toBe("en");

    expect(adminLocaleOf("/admin")).toBeNull();
    expect(adminLocaleOf("/admin/fr/amoe")).toBeNull();
    expect(adminLocaleOf("/es/admin")).toBeNull();
  });

  it("la redireccion conserva la ruta entera", () => {
    // Entrar a una pantalla concreta sin idioma no puede dejar a nadie en la
    // portada del panel: es la misma promesa que DEC-021 hace en el escaparate.
    expect(adminRedirectPath("/admin", "es")).toBe("/admin/es");
    expect(adminRedirectPath("/admin/amoe", "es")).toBe("/admin/es/amoe");
    expect(adminRedirectPath("/admin/orders/ord_1", "en")).toBe("/admin/en/orders/ord_1");
  });
});

describe("negociacion de idioma del panel", () => {
  it("respeta los factores de calidad de Accept-Language", () => {
    // Sin factores de calidad, `en;q=0.2, es;q=0.9` se resolveria a ingles por
    // venir antes, que es lo contrario de lo que el navegador esta pidiendo.
    expect(localeFromAcceptLanguage("en;q=0.2, es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("es;q=0.1, en;q=0.8")).toBe("en");
  });

  it("acepta cualquier variante del idioma, no solo la estadounidense", () => {
    // Quien pide espanol de Mexico prefiere el espanol de este sitio antes que
    // su ingles. Exigir `es-US` exacto lo mandaria al ingles.
    expect(localeFromAcceptLanguage("es-MX,es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("es-419")).toBe("es");
    expect(localeFromAcceptLanguage("en-GB")).toBe("en");
  });

  it("ignora lo que no expresa una preferencia utilizable", () => {
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("de,fr;q=0.8")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();

    // `q=0` significa "este no", no "este el que menos".
    expect(localeFromAcceptLanguage("es;q=0, en;q=0.5")).toBe("en");
  });

  it("la eleccion explicita gana a la preferencia del navegador", () => {
    expect(negotiateAdminLocale({ cookieLocale: "es", acceptLanguage: "en-US,en;q=0.9" })).toBe(
      "es",
    );

    expect(negotiateAdminLocale({ cookieLocale: "en", acceptLanguage: "es-US,es;q=0.9" })).toBe(
      "en",
    );
  });

  it("una cookie manipulada no decide nada", () => {
    // El valor llega del cliente y se edita en cinco segundos. Se valida en vez
    // de confiarse, y se cae a la preferencia del navegador.
    expect(negotiateAdminLocale({ cookieLocale: "../../etc", acceptLanguage: "es-US" })).toBe("es");

    expect(negotiateAdminLocale({ cookieLocale: "fr", acceptLanguage: null })).toBe("en");
    expect(negotiateAdminLocale({ cookieLocale: undefined, acceptLanguage: undefined })).toBe("en");
  });

  it("usa la MISMA cookie de idioma que el escaparate", () => {
    // Dos cookies distintas producirian dos idiomas simultaneos en la misma
    // pestana: espanol en la tienda e ingles en el panel.
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
  });
});

/**
 * EL MATCHER DEL MIDDLEWARE, LEIDO DEL FICHERO.
 *
 * Se comprueba sobre el TEXTO del `middleware.ts` y no importandolo: importarlo
 * arrastra `next-intl/middleware`, que espera el runtime de Next. Lo que hay
 * que verificar aqui es una propiedad del fichero, no un comportamiento.
 */
describe("matcher del middleware", () => {
  const source = readFileSync(join(HERE, "..", "middleware.ts"), "utf8");

  it("declara sus dos entradas propias para el panel", () => {
    expect(source).toContain('"/admin"');
    expect(source).toContain('"/admin/:path*"');
  });

  it("saca /admin del comodin del escaparate", () => {
    // Sin esto, next-intl mandaria `/admin/...` a `/en/admin/...` y la cookie de
    // personal dejaria de viajar (DEC-048).
    expect(source).toContain("(?!_next|_vercel|api|admin|healthz|.*\\\\..*)");
  });

  it("conserva el escape doble del punto", () => {
    /*
     * En una cadena de JavaScript `"\."` se colapsa a `.`, y el patron pasaria a
     * ser `.*..*` -"dos caracteres cualesquiera"-, que excluiria del middleware
     * casi cualquier ruta en vez de solo los ficheros con extension. Ya paso
     * una vez; esta linea es la red.
     */
    expect(source).toContain("\\\\..*");
    expect(source).not.toMatch(/\(\?!_next\|_vercel\|api\|admin\|healthz\|\.\*\\\.\*\)/);
  });
});
