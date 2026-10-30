import { describe, expect, it } from "vitest";

import { canonicalRedirectTarget } from "@/lib/canonical-host";

/**
 * REDIRECCION DEL DOMINIO DE RAILWAY AL CANONICO (DEC-094).
 *
 * Lo que protege: que un enlace viejo con el dominio interno de Railway
 * aterrice en lonestarwinners.com con su misma ruta y query -donde Turnstile si
 * carga-, y que NADA mas se redirija: ni desarrollo, ni CI, ni la red privada,
 * ni el propio dominio canonico.
 */
const CANONICAL = "https://lonestarwinners.com";
const RAILWAY_HOST = "web-production-5e278b.up.railway.app";

describe("canonicalRedirectTarget", () => {
  it("manda el dominio de Railway al canonico conservando ruta y query", () => {
    expect(
      canonicalRedirectTarget({
        webPublicUrl: CANONICAL,
        requestHost: RAILWAY_HOST,
        pathname: "/es/account/login",
        search: "?next=%2Faccount%2Fentries",
      }),
    ).toBe("https://lonestarwinners.com/es/account/login?next=%2Faccount%2Fentries");
  });

  it("no toca el dominio canonico, ni en otra capitalizacion", () => {
    for (const host of ["lonestarwinners.com", "LoneStarWinners.com"]) {
      expect(
        canonicalRedirectTarget({
          webPublicUrl: CANONICAL,
          requestHost: host,
          pathname: "/es",
          search: "",
        }),
      ).toBeNull();
    }
  });

  it("sin WEB_PUBLIC_URL no redirige nada: desarrollo y CI siguen igual", () => {
    for (const webPublicUrl of [undefined, "", "   ", "no-es-una-url", "ftp://x"]) {
      expect(
        canonicalRedirectTarget({
          webPublicUrl,
          requestHost: RAILWAY_HOST,
          pathname: "/es",
          search: "",
        }),
      ).toBeNull();
    }
  });

  it("solo actua sobre *.up.railway.app: localhost, CI y la red privada pasan de largo", () => {
    for (const host of [
      "localhost:3000",
      "127.0.0.1:3310",
      "web.railway.internal",
      "otro-dominio.example",
      null,
      "",
    ]) {
      expect(
        canonicalRedirectTarget({
          webPublicUrl: CANONICAL,
          requestHost: host,
          pathname: "/es",
          search: "",
        }),
      ).toBeNull();
    }
  });

  it("el panel tambien se canonicaliza, con su ruta intacta", () => {
    expect(
      canonicalRedirectTarget({
        webPublicUrl: CANONICAL,
        requestHost: RAILWAY_HOST,
        pathname: "/admin/es/orders/abc",
        search: "",
      }),
    ).toBe("https://lonestarwinners.com/admin/es/orders/abc");
  });
});
