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

function capturingFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("Resend", () => {
  it("envia a la API de Resend con la clave en la cabecera y el remitente con nombre", async () => {
    const { calls, fetchImpl } = capturingFetch();
    const sender = createResendEmailSender({
      apiKey: "re_prueba",
      fromAddress: "no-reply@lsw-pruebas.com",
      fromName: "Lone Star Winners",
      fetchImpl,
    });

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
    const sender = createResendEmailSender({
      apiKey: "re_prueba",
      fromAddress: "no-reply@lsw-pruebas.com",
      fromName: "Lone Star Winners",
      fetchImpl,
    });

    const failure = await sender.send(MESSAGE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect((failure as EmailDeliveryError).status).toBe(403);
    expect(String((failure as Error).message)).not.toContain("persona@");
    expect(String((failure as Error).message)).not.toContain("re_prueba");
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
