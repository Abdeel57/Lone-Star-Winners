import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next-intl", () => ({ useLocale: () => "es" }));

import { MetaPixel } from "@/components/meta-pixel";
import {
  DEFAULT_META_PIXEL_ID,
  hasAdSharingOptOut,
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
});

describe("MetaPixel en el navegador", () => {
  beforeEach(() => {
    delete window.fbq;
    delete window._fbq;
    document.head.querySelectorAll("script").forEach((script) => script.remove());
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
      ["init", "1794885734825835"],
      ["track", "PageView"],
    ]);
  });
});
