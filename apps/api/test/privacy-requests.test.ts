/**
 * Solicitudes de privacidad: el formulario de `/privacychoices` (DEC-063).
 *
 * Lo que estos casos protegen:
 *
 *   1. que la solicitud LLEGUE al buzon del negocio, con quien la envio como
 *      `reply_to`, y que si no llega la persona se entere (503);
 *   2. que el acuse vaya a quien la envio, en su idioma, sin repetir lo que
 *      escribio, y que su fallo no se confunda con el de la solicitud;
 *   3. que el texto de un desconocido no salga como HTML en el correo del
 *      negocio;
 *   4. que con anti-bots configurado no se envie nada sin token valido.
 */

import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { BotCheck } from "../src/services/bot-check.js";
import type { EmailMessage } from "../src/services/email.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const URL = "/api/v1/privacy-requests";
const INBOX = CONTRACT_GENERATION_CONFIG.privacy.requestInbox;

interface WorldOptions {
  /** Que envio falla: el del buzon, el del acuse o ninguno. */
  readonly failSend?: "inbox" | "ack" | null;
  readonly botCheck?: "none" | "pass" | "fail";
}

async function world(options: WorldOptions = {}) {
  const sent: EmailMessage[] = [];

  const botCheck: BotCheck = {
    verify: () => Promise.resolve(options.botCheck === "pass"),
  };

  const app = await createApp({
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    email: {
      provider: "fake",
      send: (message: EmailMessage) => {
        const toInbox = message.to === INBOX;
        if (options.failSend === "inbox" && toInbox) {
          return Promise.reject(new Error("buzon caido"));
        }
        if (options.failSend === "ack" && !toInbox) {
          return Promise.reject(new Error("acuse caido"));
        }
        sent.push(message);
        return Promise.resolve();
      },
    },
    botCheck: (options.botCheck ?? "none") === "none" ? null : botCheck,
  } as unknown as AppDependencies);

  return { app, sent };
}

const VALID = {
  request_type: "DELETE",
  full_name: "Persona de Prueba",
  email: "persona@example.invalid",
  phone: null,
  state: "Texas",
  details: "Borrad mi cuenta <b>ya</b>",
  authorized_agent: false,
  language: "es-US",
} as const;

function errorCode(response: { json: <T>() => T }): string {
  return response.json<{ error: { code: string } }>().error.code;
}

describe("POST /api/v1/privacy-requests", () => {
  it("entrega el expediente al buzon con reply_to y acusa recibo en el idioma de la persona", async () => {
    const { app, sent } = await world();
    const response = await app.inject({ method: "POST", url: URL, payload: VALID });

    expect(response.statusCode).toBe(202);
    const body = response.json<{ received: boolean; reference: string }>();
    expect(body.received).toBe(true);
    expect(body.reference).toMatch(/^PR-[A-HJ-NP-Z2-9]{10}$/u);

    const inbox = sent.find((message) => message.to === INBOX);
    const ack = sent.find((message) => message.to === VALID.email);
    expect(inbox?.replyTo).toBe(VALID.email);
    expect(inbox?.subject).toContain(body.reference);
    expect(inbox?.text).toContain("Delete my personal information");
    expect(ack?.subject).toBe(`Recibimos tu solicitud de privacidad (${body.reference})`);
    // El acuse NO repite lo que escribio la persona.
    expect(ack?.text).not.toContain("Borrad mi cuenta");
    await app.close();
  });

  it("escapa el texto del formulario en el HTML del buzon", async () => {
    const { app, sent } = await world();
    await app.inject({ method: "POST", url: URL, payload: VALID });

    const inbox = sent.find((message) => message.to === INBOX);
    expect(inbox?.html).toContain("&lt;b&gt;ya&lt;/b&gt;");
    expect(inbox?.html).not.toContain("<b>ya</b>");
    await app.close();
  });

  it("si el buzon no la recibe, responde 503 y no manda acuse", async () => {
    const { app, sent } = await world({ failSend: "inbox" });
    const response = await app.inject({ method: "POST", url: URL, payload: VALID });

    expect(response.statusCode).toBe(503);
    expect(sent).toHaveLength(0);
    await app.close();
  });

  it("si solo falla el acuse, la solicitud llego: 202", async () => {
    const { app, sent } = await world({ failSend: "ack" });
    const response = await app.inject({ method: "POST", url: URL, payload: VALID });

    expect(response.statusCode).toBe(202);
    expect(sent.map((message) => message.to)).toEqual([INBOX]);
    await app.close();
  });

  it("rechaza un tipo desconocido, un correo sin forma y la falta del estado", async () => {
    const { app, sent } = await world();
    for (const payload of [
      { ...VALID, request_type: "SELL_EVERYTHING" },
      { ...VALID, email: "no-es-un-correo" },
      { ...VALID, state: "" },
    ]) {
      const response = await app.inject({ method: "POST", url: URL, payload });
      expect(response.statusCode).toBe(422);
    }
    expect(sent).toHaveLength(0);
    await app.close();
  });

  it("con anti-bots configurado: sin token o con token rechazado no se envia nada", async () => {
    const failing = await world({ botCheck: "fail" });
    const noToken = await failing.app.inject({ method: "POST", url: URL, payload: VALID });
    const badToken = await failing.app.inject({
      method: "POST",
      url: URL,
      payload: { ...VALID, bot_check_token: "x" },
    });
    expect(errorCode(noToken)).toBe("BOT_CHECK_FAILED");
    expect(errorCode(badToken)).toBe("BOT_CHECK_FAILED");
    expect(failing.sent).toHaveLength(0);
    await failing.app.close();

    const passing = await world({ botCheck: "pass" });
    const ok = await passing.app.inject({
      method: "POST",
      url: URL,
      payload: { ...VALID, bot_check_token: "x" },
    });
    expect(ok.statusCode).toBe(202);
    await passing.app.close();
  });
});
