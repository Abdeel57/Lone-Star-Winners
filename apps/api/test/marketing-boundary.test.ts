/**
 * La frontera entre el correo de acceso y el de marketing (DEC-099).
 *
 *   1. El codigo de marketing no importa el emisor transaccional.
 *   2. El adaptador de Resend solo habla con contactos y eventos: no existe
 *      ninguna forma de enviar un correo desde aqui.
 *   3. El arranque rechaza compartir clave o dominio.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/env.js";
import { MarketingProviderError } from "../src/services/marketing-ports.js";
import { createResendMarketingProvider } from "../src/services/resend-marketing.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const MARKETING_MODULES = [
  "services/marketing-ports.ts",
  "services/marketing-sync.ts",
  "services/marketing-webhook.ts",
  "services/resend-marketing.ts",
  "services/drizzle-marketing.ts",
  "routes/marketing-webhook.ts",
  "routes/admin-marketing.ts",
  "scripts/marketing-sync.ts",
];

function capture(status = 200, body: Record<string, unknown> = { id: "contact-1" }) {
  const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
      auth: new Headers(init.headers).get("authorization"),
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function provider(fetchImpl: typeof fetch) {
  return createResendMarketingProvider({
    apiKey: "re_clave_de_marketing",
    fetchImpl,
    sleep: () => Promise.resolve(),
  });
}

describe("separacion del correo de acceso", () => {
  it.each(MARKETING_MODULES)("%s no importa el emisor transaccional", (file) => {
    const source = readFileSync(path.join(ROOT, file), "utf8");

    expect(source).not.toMatch(/from\s+"[^"]*\/email\.js"/u);
    expect(source).not.toContain("EMAIL_PROVIDER_API_KEY");
  });

  it("el adaptador no contiene ninguna ruta de envio", () => {
    const source = readFileSync(path.join(ROOT, "services/resend-marketing.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    expect(code).not.toContain("/emails");
    expect(code).not.toContain("/broadcasts");
    expect(code).not.toContain("/automations");
  });

  it("el flujo transaccional no conoce el marketing", () => {
    const source = readFileSync(path.join(ROOT, "services/email.ts"), "utf8");

    expect(source).not.toMatch(/marketing/iu);
  });
});

describe("adaptador de Resend", () => {
  it("usa su propia clave", async () => {
    const { calls, fetchImpl } = capture();

    await provider(fetchImpl).unsubscribe("contact-1");

    expect(calls[0]?.auth).toBe("Bearer re_clave_de_marketing");
  });

  it("todas sus llamadas son a contactos o eventos", async () => {
    const { calls, fetchImpl } = capture();
    const p = provider(fetchImpl);

    await p.createOrAttach({ email: "a@example.invalid", properties: {}, segmentId: "s1" });
    await p.updateContact("c1", { properties: {}, resubscribe: false });
    await p.moveSegment("c1", "s1", "s2");
    await p.removeFromSegment("c1", "s1");
    await p.unsubscribe("c1");
    await p.deleteContact("c1");
    await p.sendAutomationEvent("c1", "evento");

    for (const call of calls) {
      expect(call.url).toMatch(/^https:\/\/api\.resend\.com\/(contacts|events\/send)/u);
    }
  });

  it("un contacto que ya existe NO se vuelve a suscribir", async () => {
    const { calls, fetchImpl } = capture();

    await provider(fetchImpl).createOrAttach({
      email: "a@example.invalid",
      properties: { locale: "es-US" },
      segmentId: "s1",
    });

    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ properties: { locale: "es-US" } });
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/contacts"))).toBe(
      false,
    );
  });

  it("uno que no existe se crea, y solo lleva direccion y propiedades", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body === undefined ? undefined : JSON.parse(init.body as string),
      });
      const missing = init.method === "PATCH";
      return Promise.resolve(
        new Response(JSON.stringify(missing ? {} : { id: "nuevo" }), {
          status: missing ? 404 : 200,
        }),
      );
    }) as unknown as typeof fetch;

    const result = await provider(fetchImpl).createOrAttach({
      email: "a@example.invalid",
      properties: { locale: "es-US", is_buyer: "false" },
      segmentId: "s1",
    });

    expect(result.contactId).toBe("nuevo");
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://api.resend.com/contacts",
      body: {
        email: "a@example.invalid",
        unsubscribed: false,
        properties: { locale: "es-US", is_buyer: "false" },
      },
    });
    expect(calls[2]?.url).toBe("https://api.resend.com/contacts/nuevo/segments/s1");
  });

  it("los eventos van con contact_id: con email crearian el contacto sin permiso", async () => {
    const { calls, fetchImpl } = capture();

    await provider(fetchImpl).sendAutomationEvent("c1", "evento");

    expect(calls[0]?.body).toEqual({ event: "evento", contact_id: "c1" });
  });

  it("deja pausa entre peticiones: el limite lo comparte con los codigos de acceso", async () => {
    const { fetchImpl } = capture();
    const pauses: number[] = [];
    const p = createResendMarketingProvider({
      apiKey: "re_x",
      fetchImpl,
      sleep: (ms) => {
        pauses.push(ms);
        return Promise.resolve();
      },
    });

    await p.unsubscribe("c1");

    expect(pauses[0]).toBeGreaterThanOrEqual(400);
  });

  it("un 429 se distingue como limite de ritmo", async () => {
    const { fetchImpl } = capture(429, {});

    const failure = await provider(fetchImpl)
      .unsubscribe("c1")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MarketingProviderError);
    expect((failure as MarketingProviderError).rateLimited).toBe(true);
  });

  it("dar de baja a quien ya no existe alli no es un fallo", async () => {
    const { fetchImpl } = capture(404, {});

    await expect(provider(fetchImpl).unsubscribe("c1")).resolves.toBeUndefined();
  });
});

describe("el arranque impone la separacion", () => {
  const BASE: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    TZ: "UTC",
    LOG_LEVEL: "debug",
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    API_PUBLIC_URL: "http://localhost:4000",
    API_BODY_LIMIT_BYTES: "1048576",
    API_CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    API_REQUEST_ID_HEADER: "X-Request-Id",
    API_RATE_LIMIT_WINDOW_SECONDS: "60",
    API_RATE_LIMIT_MAX_REQUESTS: "120",
    DATABASE_URL_APP: "postgresql://lsw_app:local@127.0.0.1:5432/lone_star_winners",
    DATABASE_SSL_MODE: "disable",
    DATABASE_POOL_MAX: "10",
    DATABASE_STATEMENT_TIMEOUT_MS: "15000",
    SESSION_SECRET: "0123456789012345678901234567890123456789",
    SESSION_COOKIE_NAME: "lsw_session",
    SESSION_COOKIE_DOMAIN: "localhost",
    SESSION_COOKIE_SECURE: "false",
    SESSION_TTL_MINUTES: "720",
    ADMIN_SESSION_TTL_MINUTES: "60",
    ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: "15",
    STEP_UP_MAX_AGE_SECONDS: "300",
    MFA_SECRET_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
    PAYMENT_PROVIDER: "none",
    DEFAULT_CURRENCY: "USD",
  };
  const load = (overrides: NodeJS.ProcessEnv) => loadConfig({ ...BASE, ...overrides });

  /** Todo lo que `live` necesita, para comprobar que aun asi no arranca. */
  const FULL_LIVE: NodeJS.ProcessEnv = {
    MARKETING_SYNC_MODE: "live",
    RESEND_MARKETING_API_KEY: "clave-de-marketing",
    MARKETING_FROM_ADDRESS: "hola@news.lsw-pruebas.com",
    RESEND_SEGMENT_BUYERS_ID: "seg-1",
    RESEND_SEGMENT_REGISTERED_ID: "seg-2",
    MARKETING_TARGET_PROMOTION_SLUG: "edicion",
  };

  it("por defecto todo esta apagado", () => {
    const { marketing } = load({});

    expect(marketing.sync.mode).toBe("off");
    expect(marketing.sync.automationEventsEnabled).toBe(false);
    expect(marketing.webhookSecret).toBeNull();
    expect(marketing.attributionWindowDays).toBe(7);
  });

  it("rechaza que marketing use la clave de los correos de acceso", () => {
    expect(() =>
      load({
        EMAIL_PROVIDER: "resend",
        EMAIL_PROVIDER_API_KEY: "clave-compartida",
        RESEND_MARKETING_API_KEY: "clave-compartida",
      }),
    ).toThrow(/RESEND_MARKETING_API_KEY/u);
  });

  it("rechaza que marketing salga del dominio de los correos de acceso", () => {
    expect(() =>
      load({
        EMAIL_FROM_ADDRESS: "no-reply@lsw-pruebas.com",
        MARKETING_FROM_ADDRESS: "promos@LSW-pruebas.com",
      }),
    ).toThrow(/MARKETING_FROM_ADDRESS/u);
  });

  it("acepta un subdominio distinto", () => {
    const config = load({
      EMAIL_FROM_ADDRESS: "no-reply@lsw-pruebas.com",
      MARKETING_FROM_ADDRESS: "hola@news.lsw-pruebas.com",
    });

    expect(config.marketing.sync.mode).toBe("off");
  });

  it("en este commit `live` no arranca, ni con toda la configuracion", () => {
    // El texto del permiso ya esta aprobado (2026-11-12); lo que falta es Resend.
    expect(() => load(FULL_LIVE)).not.toThrow(/legallyApproved/u);
    expect(() => load(FULL_LIVE)).toThrow(/authorizedInWriting/u);
  });

  it("dry_run exige la edicion que fija los estados excluidos", () => {
    expect(() => load({ MARKETING_SYNC_MODE: "dry_run" })).toThrow(
      /MARKETING_TARGET_PROMOTION_SLUG/u,
    );
    expect(
      load({ MARKETING_SYNC_MODE: "dry_run", MARKETING_TARGET_PROMOTION_SLUG: "edicion" }).marketing
        .sync.mode,
    ).toBe("dry_run");
  });

  it("los eventos de automatizacion solo existen en `live`", () => {
    expect(() =>
      load({
        MARKETING_SYNC_MODE: "dry_run",
        MARKETING_TARGET_PROMOTION_SLUG: "edicion",
        MARKETING_AUTOMATION_EVENTS_ENABLED: "true",
      }),
    ).toThrow(/MARKETING_AUTOMATION_EVENTS_ENABLED/u);
  });

  it("el secreto del webhook tiene que tener su forma", () => {
    expect(() => load({ RESEND_WEBHOOK_SECRET: "cualquier-cosa" })).toThrow(
      /RESEND_WEBHOOK_SECRET/u,
    );
  });

  it("la ventana de atribucion tiene limites", () => {
    expect(() => load({ MARKETING_ATTRIBUTION_WINDOW_DAYS: "0" })).toThrow(
      /MARKETING_ATTRIBUTION_WINDOW_DAYS/u,
    );
    expect(load({ MARKETING_ATTRIBUTION_WINDOW_DAYS: "14" }).marketing.attributionWindowDays).toBe(
      14,
    );
  });
});
