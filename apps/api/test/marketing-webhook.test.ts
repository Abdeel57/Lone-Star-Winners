/**
 * Webhooks del proveedor de correo (DEC-099).
 *
 * Por orden de lo que costaria equivocarse:
 *
 *   1. que Resend NUNCA pueda dar permiso;
 *   2. que una firma mala no entre, y que se verifique sobre el cuerpo crudo;
 *   3. que una baja, una queja o un rebote permanente tengan su efecto;
 *   4. que no se pida guardar nada del correo transaccional normal.
 */

import { createHmac } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { ProviderEventInput } from "../src/services/marketing-ports.js";
import {
  interpretResendEvent,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "../src/services/marketing-webhook.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const SECRET = `whsec_${Buffer.from("secreto-de-prueba-del-webhook").toString("base64")}`;
const NOW = new Date("2026-11-08T18:00:00.000Z");
const AT = "2026-11-08T17:59:00.000Z";

function signed(body: string, id = "msg_1", timestampSeconds = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(SECRET.replace("whsec_", ""), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${String(timestampSeconds)}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestampSeconds),
    "svix-signature": `v1,${signature}`,
    "content-type": "application/json",
  };
}

describe("verifyWebhookSignature", () => {
  it("coincide con el vector publicado por Svix", () => {
    expect(
      verifyWebhookSignature({
        secret: "whsec_plJ3nmyCDGBKInavdOK15jsl", // gitleaks:allow — vector publico de Svix
        rawBody: Buffer.from('{"event_type":"ping","data":{"success":true}}'),
        now: new Date(1731705121 * 1000),
        headers: {
          id: "msg_loFOjxBNrRLzqYUf",
          timestamp: "1731705121",
          signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=", // gitleaks:allow
        },
      }),
    ).toBe(true);
  });

  const body = Buffer.from('{"type":"contact.updated"}');
  const seconds = Math.floor(NOW.getTime() / 1000);
  const good = signed(body.toString(), "msg_1", seconds);
  const check = (overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]>) =>
    verifyWebhookSignature({
      secret: SECRET,
      rawBody: body,
      now: NOW,
      headers: {
        id: good["svix-id"],
        timestamp: good["svix-timestamp"],
        signature: good["svix-signature"],
      },
      ...overrides,
    });

  it("acepta la firma buena", () => {
    expect(check({})).toBe(true);
  });

  it("rechaza un cuerpo alterado, otro secreto y cabeceras que faltan", () => {
    expect(check({ rawBody: Buffer.from('{"type":"contact.deleted"}') })).toBe(false);
    expect(check({ secret: `whsec_${Buffer.from("otro").toString("base64")}` })).toBe(false);
    expect(check({ headers: { id: undefined, timestamp: "1", signature: "v1,x" } })).toBe(false);
  });

  it("rechaza una entrega fuera de la tolerancia", () => {
    const late = new Date(NOW.getTime() + (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000);
    expect(check({ now: late })).toBe(false);
  });

  it("acepta si una de varias firmas es buena (rotacion de secreto)", () => {
    expect(
      check({
        headers: {
          id: good["svix-id"],
          timestamp: good["svix-timestamp"],
          signature: `v1,AAAA ${good["svix-signature"]}`,
        },
      }),
    ).toBe(true);
  });
});

describe("interpretResendEvent", () => {
  const interpret = (type: string, data: Record<string, unknown>) =>
    interpretResendEvent("evt_1", { type, created_at: AT, data }, NOW);

  it("Resend NUNCA da permiso: unsubscribed false no produce nada", () => {
    expect(
      interpret("contact.updated", { email: "a@example.invalid", unsubscribed: false }),
    ).toBeNull();
  });

  it("ningun evento posible lleva otra cosa que retirar o suprimir", () => {
    const events: [string, Record<string, unknown>][] = [
      ["contact.updated", { email: "a@example.invalid", unsubscribed: true }],
      ["contact.deleted", { email: "a@example.invalid" }],
      ["contact.created", { email: "a@example.invalid", unsubscribed: false }],
      ["email.complained", { to: ["a@example.invalid"], broadcast_id: "b1", email_id: "e1" }],
      ["email.bounced", { to: ["a@example.invalid"], bounce: { type: "Permanent" } }],
      ["suppression.added", { email: "a@example.invalid", origin: "manual" }],
      ["suppression.removed", { email: "a@example.invalid" }],
    ];
    for (const [type, data] of events) {
      const effect = interpret(type, data)?.effect;
      expect(Object.keys(effect ?? { suppress: 0, withdraw: 0 }).sort()).toEqual([
        "suppress",
        "withdraw",
      ]);
    }
    // `contact.created` tampoco: dar de alta alli no es consentir aqui.
    expect(interpret("contact.created", { email: "a@example.invalid" })).toBeNull();
  });

  it("una baja desde el enlace retira el permiso", () => {
    expect(
      interpret("contact.updated", { email: "a@example.invalid", unsubscribed: true }),
    ).toMatchObject({
      email: "a@example.invalid",
      effect: { suppress: null, withdraw: "UNSUBSCRIBE_LINK" },
    });
  });

  it("un contacto borrado alli retira el permiso", () => {
    expect(interpret("contact.deleted", { email: "a@example.invalid" })?.effect).toEqual({
      suppress: null,
      withdraw: "EMAIL_PROVIDER",
    });
  });

  it("una queja retira el permiso y suprime", () => {
    expect(
      interpret("email.complained", { to: ["a@example.invalid"], broadcast_id: "b1" })?.effect,
    ).toEqual({ suppress: "COMPLAINT", withdraw: "EMAIL_PROVIDER" });
  });

  it("un rebote permanente suprime, tambien si era un correo transaccional", () => {
    expect(
      interpret("email.bounced", { to: ["a@example.invalid"], bounce: { type: "Permanent" } })
        ?.effect,
    ).toEqual({ suppress: "HARD_BOUNCE", withdraw: null });
  });

  it("un rebote temporal no suprime", () => {
    expect(
      interpret("email.bounced", {
        to: ["a@example.invalid"],
        broadcast_id: "b1",
        bounce: { type: "Temporary" },
      })?.effect,
    ).toEqual({ suppress: null, withdraw: null });
    expect(
      interpret("email.bounced", { to: ["a@example.invalid"], bounce: { type: "Temporary" } }),
    ).toBeNull();
  });

  it("cada origen de supresion tiene su razon", () => {
    const origin = (value: string) =>
      interpret("suppression.added", { email: "a@example.invalid", origin: value })?.effect;
    expect(origin("bounce")).toEqual({ suppress: "HARD_BOUNCE", withdraw: null });
    expect(origin("complaint")).toEqual({ suppress: "COMPLAINT", withdraw: "EMAIL_PROVIDER" });
    expect(origin("manual")).toEqual({ suppress: "PROVIDER_MANUAL", withdraw: null });
    expect(origin("otro")).toBeUndefined();
  });

  it("levantar una supresion alli no la levanta aqui", () => {
    expect(interpret("suppression.removed", { email: "a@example.invalid" })?.effect).toEqual({
      suppress: null,
      withdraw: null,
    });
  });

  it("mide las campanas y no el correo transaccional", () => {
    expect(
      interpret("email.clicked", {
        to: ["a@example.invalid"],
        broadcast_id: "b1",
        email_id: "e1",
        subject: "Asunto",
        click: { ipAddress: "1.2.3.4", userAgent: "UA", link: "https://x" },
      }),
    ).toMatchObject({
      providerBroadcastId: "b1",
      providerEmailId: "e1",
      eventType: "email.clicked",
    });
    // Un codigo de acceso entregado no interesa.
    expect(interpret("email.delivered", { to: ["a@example.invalid"], email_id: "e1" })).toBeNull();
  });

  it("no conserva IP, navegador, enlace ni asunto", () => {
    const event = interpret("email.clicked", {
      to: ["a@example.invalid"],
      broadcast_id: "b1",
      email_id: "e1",
      subject: "Asunto secreto",
      click: { ipAddress: "1.2.3.4", userAgent: "UA-X", link: "https://x" },
    });
    const dumped = JSON.stringify(event);
    for (const secret of ["1.2.3.4", "UA-X", "Asunto secreto", "https://x"]) {
      expect(dumped).not.toContain(secret);
    }
  });

  it("ignora lo que no entiende", () => {
    expect(interpretResendEvent("e", null, NOW)).toBeNull();
    expect(interpretResendEvent("e", { type: "email.sent" }, NOW)).toBeNull();
    expect(interpret("algo.nuevo", { email: "a@example.invalid" })).toBeNull();
  });
});

describe("POST /api/v1/webhooks/email/resend", () => {
  function world(options: { readonly secret?: string | null } = {}) {
    const applied: ProviderEventInput[] = [];
    const appPromise = createApp({
      config: {
        ...CONTRACT_GENERATION_CONFIG,
        marketing: {
          ...CONTRACT_GENERATION_CONFIG.marketing,
          webhookSecret: options.secret === undefined ? SECRET : options.secret,
        },
      },
      database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
      paymentProvider: { name: "none" },
      repositories: createFakeRepositories(),
      identity: {
        marketing: {
          applyProviderEvent: (input: ProviderEventInput) => {
            applied.push(input);
            return Promise.resolve("APPLIED");
          },
        },
      },
      sms: null,
      botCheck: null,
    } as unknown as AppDependencies);

    async function post(body: string, headers: Record<string, string>) {
      const app: FastifyInstance = await appPromise;
      return app.inject({
        method: "POST",
        url: "/api/v1/webhooks/email/resend",
        payload: body,
        headers,
      });
    }
    return { post, applied };
  }

  const UNSUBSCRIBED = JSON.stringify({
    type: "contact.updated",
    created_at: AT,
    data: { email: "a@example.invalid", unsubscribed: true },
  });

  it("sin secreto configurado no existe: 404", async () => {
    const w = world({ secret: null });

    expect((await w.post(UNSUBSCRIBED, signed(UNSUBSCRIBED))).statusCode).toBe(404);
    expect(w.applied).toEqual([]);
  });

  it("una firma mala es 401 y no aplica nada", async () => {
    const w = world();
    const headers = { ...signed(UNSUBSCRIBED), "svix-signature": "v1,AAAA" };

    expect((await w.post(UNSUBSCRIBED, headers)).statusCode).toBe(401);
    expect(w.applied).toEqual([]);
  });

  it("la firma se comprueba sobre los bytes recibidos, sin reserializar", async () => {
    const w = world();
    // Con espacios: reserializar el JSON cambiaria los bytes y romperia la firma.
    const spaced = UNSUBSCRIBED.replace('"type":', '"type" :   ');

    const response = await w.post(spaced, signed(spaced));

    expect(response.statusCode, response.body).toBe(200);
    expect(w.applied).toHaveLength(1);
  });

  it("una baja firmada llega con el id de entrega y su efecto", async () => {
    const w = world();

    const response = await w.post(UNSUBSCRIBED, signed(UNSUBSCRIBED, "msg_baja"));

    expect(response.json()).toEqual({ received: true });
    expect(w.applied[0]).toMatchObject({
      providerEventId: "msg_baja",
      effect: { withdraw: "UNSUBSCRIBE_LINK" },
    });
  });

  it("un evento que no interesa se acusa sin aplicar nada", async () => {
    const w = world();
    const body = JSON.stringify({
      type: "contact.updated",
      created_at: AT,
      data: { email: "a@example.invalid", unsubscribed: false },
    });

    expect((await w.post(body, signed(body))).statusCode).toBe(200);
    expect(w.applied).toEqual([]);
  });

  it("firmado pero ilegible se acusa: reintentarlo no lo arreglaria", async () => {
    const w = world();
    const body = "{no es json";

    expect((await w.post(body, signed(body))).statusCode).toBe(200);
    expect(w.applied).toEqual([]);
  });
});
