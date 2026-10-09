import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next-intl", () => ({ useLocale: () => "es" }));

import { MetaPixel } from "@/components/meta-pixel";
import {
  DEFAULT_META_PIXEL_ID,
  hasAdSharingOptOut,
  isMetaPixelExcludedPath,
  metaPixelAllowed,
  resolveMetaPixelId,
} from "@/lib/meta-pixel";

/**
 * Pixel de Meta (DEC-086): cuando se carga y cuando no. Lo que importa aqui es
 * la parte de NO cargarlo -otro dominio, Global Privacy Control, exclusion en
 * `/privacychoices`-, porque es lo que la Politica y la CCPA prometen.
 */

describe("que pixel se usa", () => {
  it("sin variable, el del cliente", () => {
    expect(resolveMetaPixelId({})).toBe(DEFAULT_META_PIXEL_ID);
    expect(DEFAULT_META_PIXEL_ID).toBe("1794885734825835");
  });

  it("la variable lo cambia o lo apaga, y solo admite cifras", () => {
    expect(resolveMetaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: "123456789012" })).toBe("123456789012");
    expect(resolveMetaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: "off" })).toBeNull();
    expect(resolveMetaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: "" })).toBeNull();
    // Acaba en una URL y en la CSP: nada que no sean cifras.
    expect(resolveMetaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: "123');alert(1);//" })).toBeNull();
  });
});

describe("donde y para quien dispara", () => {
  const base = { hostname: "lonestarwinners.com", globalPrivacyControl: false, cookieHeader: "" };

  it("en el dominio real, sin exclusion, si", () => {
    expect(metaPixelAllowed(base)).toBe(true);
    expect(metaPixelAllowed({ ...base, hostname: "www.lonestarwinners.com" })).toBe(true);
  });

  it("en local, en CI o en un dominio de prueba, no", () => {
    expect(metaPixelAllowed({ ...base, hostname: "localhost" })).toBe(false);
    expect(metaPixelAllowed({ ...base, hostname: "127.0.0.1" })).toBe(false);
    expect(metaPixelAllowed({ ...base, hostname: "web-production-1.up.railway.app" })).toBe(false);
  });

  it("con Global Privacy Control, no", () => {
    expect(metaPixelAllowed({ ...base, globalPrivacyControl: true })).toBe(false);
  });

  it("con la exclusion de /privacychoices, no", () => {
    const cookieHeader = "NEXT_LOCALE=es; lsw_ad_sharing_opt_out=1";
    expect(hasAdSharingOptOut(cookieHeader)).toBe(true);
    expect(metaPixelAllowed({ ...base, cookieHeader })).toBe(false);
    expect(hasAdSharingOptOut("lsw_ad_sharing_opt_out=0")).toBe(false);
  });

  it("nunca en la cuenta, el checkout ni la confirmacion de pedido", () => {
    // Ahi van tokens en la URL (restablecer contrasena, verificar correo) e
    // identificadores de pedido, y Meta recibe la URL entera.
    for (const path of [
      "/account",
      "/account/reset-password",
      "/account/verify-email",
      "/account/orders/0f8f5c9e-2b3a-4c1d-9e8f-7a6b5c4d3e2f",
      "/checkout",
      "/checkout/return",
      "/orders/0f8f5c9e-2b3a-4c1d-9e8f-7a6b5c4d3e2f/confirmation",
    ]) {
      expect(isMetaPixelExcludedPath(path), path).toBe(true);
    }
    for (const path of ["/", "/shop", "/cart", "/products/gorra", "/accounting-is-not-account"]) {
      expect(isMetaPixelExcludedPath(path), path).toBe(false);
    }
  });
});

describe("MetaPixel en el navegador", () => {
  beforeEach(() => {
    delete window.fbq;
    delete window._fbq;
    document.head.querySelectorAll("script").forEach((script) => script.remove());
    route.pathname = "/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fuera del dominio real no carga nada", () => {
    // jsdom sirve en `localhost`.
    render(<MetaPixel pixelId="1794885734825835" />);
    expect(window.fbq).toBeUndefined();
    expect(document.head.querySelector('script[src*="facebook"]')).toBeNull();
  });

  it("en el dominio real carga fbevents.js como fichero y encola init y PageView", () => {
    vi.stubGlobal("location", { ...window.location, hostname: "lonestarwinners.com" });

    render(<MetaPixel pixelId="1794885734825835" />);

    const script = document.head.querySelector<HTMLScriptElement>('script[src*="facebook"]');
    expect(script?.src).toBe("https://connect.facebook.net/en_US/fbevents.js");
    expect(script?.async).toBe(true);
    expect(window.fbq?.queue).toEqual([
      // Sin eventos automaticos de Meta: solo los PageView de este componente.
      ["set", "autoConfig", false, "1794885734825835"],
      ["init", "1794885734825835"],
      ["track", "PageView"],
    ]);
    expect(window.fbq?.disablePushState).toBe(true);
    expect(window.fbq?.allowDuplicatePageViews).toBe(true);
  });

  it("al entrar por un enlace de la cuenta (con token), ni se carga", () => {
    vi.stubGlobal("location", { ...window.location, hostname: "lonestarwinners.com" });
    route.pathname = "/account/reset-password";

    render(<MetaPixel pixelId="1794885734825835" />);

    expect(window.fbq).toBeUndefined();
    expect(document.head.querySelector('script[src*="facebook"]')).toBeNull();
  });
});
