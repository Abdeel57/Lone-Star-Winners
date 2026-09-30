/**
 * Adaptador de Resend y plantillas (DEC-058).
 *
 * No se llama a Resend: `fetch` es un falso que captura la peticion. Lo que se
 * prueba es la FORMA de lo que saldria y lo que pasa cuando el proveedor dice
 * que no.
 */

import { describe, expect, it } from "vitest";

import {
  createConsoleEmailSender,
  createResendEmailSender,
  EmailDeliveryError,
  maskEmail,
} from "../src/services/email.js";
import {
  emailLocaleFrom,
  renderPasswordResetEmail,
  renderVerificationEmail,
  webLink,
} from "../src/services/email-templates.js";

const MESSAGE = {
  to: "persona@example.invalid",
  subject: "Asunto",
  html: "<p>hola</p>",
  text: "hola",
  kind: "email_verification",
} as const;

function capturingFetch(status = 200, body = "{}") {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Logger falso: guarda cada registro, sin mensaje. */
function capturingLogger() {
  const entries: { level: "info" | "error"; payload: Record<string, unknown> }[] = [];
  const logger = {
    info: (payload: Record<string, unknown>) => entries.push({ level: "info", payload }),
    error: (payload: Record<string, unknown>) => entries.push({ level: "error", payload }),
  } as never;
  return { entries, logger };
}

function resendSender(fetchImpl: typeof fetch, logger: never) {
  return createResendEmailSender({
    apiKey: "re_prueba",
    fromAddress: "no-reply@lsw-pruebas.com",
    fromName: "Lone Star Winners",
    logger,
    fetchImpl,
  });
}

describe("Resend", () => {
  it("envia a la API de Resend con la clave en la cabecera y el remitente con nombre", async () => {
    const { calls, fetchImpl } = capturingFetch();
    const sender = resendSender(fetchImpl, capturingLogger().logger);

    await sender.send(MESSAGE);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      "Bearer re_prueba",
    );

    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: "Lone Star Winners <no-reply@lsw-pruebas.com>",
      to: ["persona@example.invalid"],
      subject: "Asunto",
      html: "<p>hola</p>",
      text: "hola",
    });
  });

  it("un rechazo del proveedor lanza con el status y sin el contenido", async () => {
    const { fetchImpl } = capturingFetch(403);
    const sender = resendSender(fetchImpl, capturingLogger().logger);

    const failure = await sender.send(MESSAGE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect((failure as EmailDeliveryError).status).toBe(403);
    expect(String((failure as Error).message)).not.toContain("persona@");
    expect(String((failure as Error).message)).not.toContain("re_prueba");
  });

  it("registra email.send.start y email.send.ok con el id que devuelve Resend", async () => {
    const { fetchImpl } = capturingFetch(200, '{"id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c"}');
    const { entries, logger } = capturingLogger();

    await resendSender(fetchImpl, logger).send(MESSAGE);

    expect(entries.map((entry) => entry.payload.event)).toEqual([
      "email.send.start",
      "email.send.ok",
    ]);
    expect(entries[1]?.payload).toMatchObject({
      provider: "resend",
      kind: "email_verification",
      to: "p***@example.invalid",
      provider_message_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    });
  });

  it("un rechazo registra email.send.error con el motivo de Resend y la direccion enmascarada", async () => {
    const { fetchImpl } = capturingFetch(
      422,
      '{"statusCode":422,"name":"validation_error","message":"Invalid `to` field: persona@example.invalid"}',
    );
    const { entries, logger } = capturingLogger();

    await resendSender(fetchImpl, logger)
      .send(MESSAGE)
      .catch(() => undefined);

    const failure = entries.find((entry) => entry.payload.event === "email.send.error");
    expect(failure?.level).toBe("error");
    expect(failure?.payload).toMatchObject({
      status: 422,
      provider_error: "validation_error",
      provider_message: "Invalid `to` field: p***@example.invalid",
    });
    expect(entries.some((entry) => entry.payload.event === "email.send.ok")).toBe(false);
  });

  it("si Resend no responde registra email.send.error y lanza", async () => {
    const fetchImpl = (() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch;
    const { entries, logger } = capturingLogger();

    const failure = await resendSender(fetchImpl, logger)
      .send(MESSAGE)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect(entries.at(-1)?.payload).toMatchObject({ event: "email.send.error", status: null });
  });

  it("nunca registra el cuerpo, el asunto ni la clave", async () => {
    const { fetchImpl } = capturingFetch(200, '{"id":"x"}');
    const { entries, logger } = capturingLogger();

    await resendSender(fetchImpl, logger).send({ ...MESSAGE, text: "token=SECRETO" });

    const logged = JSON.stringify(entries);
    expect(logged).not.toContain("SECRETO");
    expect(logged).not.toContain("Asunto");
    expect(logged).not.toContain("re_prueba");
    expect(logged).not.toContain("persona@example.invalid");
  });
});

describe("console", () => {
  it("en produccion NO imprime el texto: lleva el enlace, que es una credencial", async () => {
    const logged: unknown[] = [];
    const sender = createConsoleEmailSender(
      { info: (payload: unknown) => logged.push(payload) } as never,
      { revealContent: false },
    );

    await sender.send({ ...MESSAGE, text: "https://x/reset?token=SECRETO" });

    expect(JSON.stringify(logged)).not.toContain("SECRETO");
    expect(JSON.stringify(logged)).not.toContain("persona@example.invalid");
  });
});

describe("plantillas", () => {
  it("elige el idioma por Accept-Language, con ingles como desempate", () => {
    expect(emailLocaleFrom("es-US")).toBe("es-US");
    expect(emailLocaleFrom("es-MX,es;q=0.9")).toBe("es-US");
    expect(emailLocaleFrom("en-US")).toBe("en-US");
    expect(emailLocaleFrom("fr-FR")).toBe("en-US");
    expect(emailLocaleFrom(undefined)).toBe("en-US");
  });

  it("el enlace va al portal, con prefijo de idioma y el token en la query", () => {
    expect(webLink("https://lonestarw1nners.com", "es-US", "/account/verify-email", "abc_-1")).toBe(
      "https://lonestarw1nners.com/es/account/verify-email?token=abc_-1",
    );
    expect(webLink("https://lonestarw1nners.com/", "en-US", "/account/reset-password", "abc")).toBe(
      "https://lonestarw1nners.com/en/account/reset-password?token=abc",
    );
  });

  it("cada correo lleva el enlace en HTML y en texto plano, en su idioma", () => {
    const link = "https://lonestarw1nners.com/es/account/verify-email?token=abc";

    const verification = renderVerificationEmail("es-US", link);
    expect(verification.subject).toBe("Confirma tu correo en Lone Star Winners");
    expect(verification.html).toContain(`href="${link}"`);
    expect(verification.html).toContain('lang="es"');
    expect(verification.text).toContain(link);

    const reset = renderPasswordResetEmail("en-US", link);
    expect(reset.subject).toBe("Reset your Lone Star Winners password");
    expect(reset.text).toContain("1 hour");
  });

  it("no promete consecuencias legales de verificar (CLAUDE.md #2)", () => {
    for (const locale of ["en-US", "es-US"] as const) {
      const { text } = renderVerificationEmail(locale, "https://x.invalid/?token=a");
      expect(text).not.toMatch(/entr(y|ies)|participa|sorteo|sweepstake|premio|prize/iu);
    }
  });
});

describe("maskEmail", () => {
  it("deja la primera letra y el dominio", () => {
    expect(maskEmail("ana.perez@example.com")).toBe("a***@example.com");
    expect(maskEmail("sin-arroba")).toBe("***");
  });
});
