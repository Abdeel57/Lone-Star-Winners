/**
 * Verificacion de correo y restablecimiento de contrasena (DEC-058).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que "olvide mi contrasena" NO revele si un correo tiene cuenta: misma
 *      respuesta, y el envio fuera del camino de la respuesta;
 *   2. que un enlace valga UNA vez, para UN proposito, y no despues de caducar;
 *   3. que restablecer revoque las sesiones abiertas y no queme el enlace con
 *      una contrasena que no cumple la politica;
 *   4. que el enlace del correo apunte al portal, en el idioma de quien lo
 *      pidio, y que el token viaje solo en el correo: a la base de datos llega
 *      su hash.
 *
 * Repositorios falsos y en memoria. La atomicidad del consumo vive en el motor
 * (`UPDATE ... WHERE consumed_at IS NULL`) y no se simula aqui (DEC-018).
 */

import { describe, expect, it, vi } from "vitest";
import { generateSessionToken, hashSessionToken, verifyPassword } from "@lsw/security";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { cookieNameFor } from "../src/http/session-cookie.js";
import type { EmailMessage, EmailSender } from "../src/services/email.js";
import type {
  EmailTokenPurpose,
  IdentityRecord,
  IdentityRepositories,
  IssueEmailTokenInput,
} from "../src/services/identity-ports.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const IDENTITY_ID = "55555555-5555-4555-8555-555555555555";
const ADDRESS = "persona@example.invalid";
const FAKE_PASSWORD = "FAKE-restablecida-2026";
const PARTICIPANT_COOKIE = cookieNameFor(
  CONTRACT_GENERATION_CONFIG.session.cookieName,
  "PARTICIPANT",
);

interface StoredToken extends IssueEmailTokenInput {
  consumedAt: Date | null;
  createdAt: Date;
}

interface WorldOptions {
  readonly identity?: Partial<IdentityRecord> | null;
  readonly hasCredential?: boolean;
  readonly failSend?: boolean;
}

function world(options: WorldOptions = {}) {
  const record: IdentityRecord | null =
    options.identity === null
      ? null
      : {
          id: IDENTITY_ID,
          email: ADDRESS,
          emailVerifiedAt: null,
          status: "ACTIVE",
          phoneE164: null,
          ...options.identity,
        };

  const tokens: StoredToken[] = [];
  const sent: EmailMessage[] = [];
  const passwordsSet: string[] = [];
  const revokedFor: string[] = [];
  let verifiedAt: Date | null = record?.emailVerifiedAt ?? null;

  const email: EmailSender = {
    provider: "fake",
    send: (message) => {
      if (options.failSend === true) return Promise.reject(new Error("proveedor caido"));
      sent.push(message);
      return Promise.resolve();
    },
  };

  const identity = {
    identities: {
      findByEmail: (address: string) =>
        Promise.resolve(
          record !== null && address.trim().toLowerCase() === record.email?.toLowerCase()
            ? record
            : null,
        ),
      findById: (id: string) =>
        Promise.resolve(record?.id === id ? { ...record, emailVerifiedAt: verifiedAt } : null),
      findCredential: (id: string) =>
        Promise.resolve(
          options.hasCredential === false
            ? null
            : { identityId: id, passwordHash: "x", failedAttempts: 0, lockedUntil: null },
        ),
      setPasswordAfterReset: (_id: string, hash: string) => {
        passwordsSet.push(hash);
        return Promise.resolve();
      },
      markEmailVerified: (id: string, address: string, now: Date) => {
        const sameIdentity = record?.id === id;
        const sameAddress = address.trim().toLowerCase() === record?.email?.toLowerCase();
        if (!sameIdentity || !sameAddress) return Promise.resolve(false);
        verifiedAt ??= now;
        return Promise.resolve(true);
      },
    },
    sessions: {
      findByTokenHash: () =>
        Promise.resolve({
          id: "66666666-6666-4666-8666-666666666666",
          identityId: IDENTITY_ID,
          scope: "PARTICIPANT",
          mfaVerifiedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          lastSeenAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        }),
      revokeAllForIdentity: (id: string) => {
        revokedFor.push(id);
        return Promise.resolve(1);
      },
    },
    emailTokens: {
      issue: (input: IssueEmailTokenInput) => {
        tokens.push({ ...input, consumedAt: null, createdAt: new Date() });
        return Promise.resolve();
      },
      consume: (tokenHash: string, purpose: EmailTokenPurpose, now: Date) => {
        const row = tokens.find((t) => t.tokenHash === tokenHash && t.purpose === purpose);
        if (row?.consumedAt !== null) return Promise.resolve({ status: "INVALID" as const });
        if (row.expiresAt <= now) return Promise.resolve({ status: "EXPIRED" as const });
        row.consumedAt = now;
        return Promise.resolve({
          status: "CONSUMED" as const,
          identityId: row.identityId,
          email: row.email,
        });
      },
      countIssuedSince: (id: string, purpose: EmailTokenPurpose, since: Date) =>
        Promise.resolve(
          tokens.filter((t) => t.identityId === id && t.purpose === purpose && t.createdAt >= since)
            .length,
        ),
      invalidateOutstanding: (id: string, purpose: EmailTokenPurpose, now: Date) => {
        for (const t of tokens) {
          if (t.identityId === id && t.purpose === purpose && t.consumedAt === null) {
            t.consumedAt = now;
          }
        }
        return Promise.resolve();
      },
    },
  } as unknown as IdentityRepositories;

  /** Siembra un enlace como lo haria la API y devuelve el token en claro. */
  function seedToken(purpose: EmailTokenPurpose, overrides: Partial<StoredToken> = {}): string {
    const token = generateSessionToken();
    tokens.push({
      identityId: IDENTITY_ID,
      purpose,
      tokenHash: hashSessionToken(token),
      email: ADDRESS,
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: new Date(),
      ...overrides,
    });
    return token;
  }

  async function app() {
    const instance = await createApp({
      config: CONTRACT_GENERATION_CONFIG,
      database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
      paymentProvider: { name: "none" },
      repositories: createFakeRepositories(),
      identity,
      email,
    } as unknown as AppDependencies);

    // La puerta real necesita la base de datos; aqui se deja pasar a toda ruta
    // de participante y lo que se prueba es el handler.
    instance.lswAuthorizer = ({ authorization }) =>
      authorization.kind === "PERMISSION"
        ? { allowed: false, reason: "FORBIDDEN" }
        : { allowed: true };

    return instance;
  }

  return {
    app,
    seedToken,
    tokens,
    sent,
    passwordsSet,
    revokedFor,
    verifiedAt: () => verifiedAt,
  };
}

function errorCode(response: { json: () => unknown }): string {
  return (response.json() as { error: { code: string } }).error.code;
}

/** El token que viaja en el enlace de un correo capturado. */
function tokenFromMessage(message: EmailMessage | undefined): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/u.exec(message?.text ?? "");
  return match?.[1] ?? "";
}

// ---------------------------------------------------------------------------

describe("POST /auth/password/forgot", () => {
  it("responde lo mismo exista o no la cuenta", async () => {
    const existing = world();
    const missing = world({ identity: null });

    const a = await existing.app();
    const b = await missing.app();

    const withAccount = await a.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: ADDRESS },
    });
    const withoutAccount = await b.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "nadie@example.invalid" },
    });

    expect(withAccount.statusCode).toBe(200);
    expect(withoutAccount.statusCode).toBe(200);
    expect(withAccount.body).toBe(withoutAccount.body);
    expect(withAccount.json()).toEqual({ acknowledged: true });

    await vi.waitFor(() => {
      expect(existing.sent).toHaveLength(1);
    });
    expect(missing.sent).toHaveLength(0);

    await a.close();
    await b.close();
  });

  it("envia un enlace al portal, en el idioma pedido, y a la base de datos solo llega el hash", async () => {
    const w = world();
    const app = await w.app();

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      headers: { "accept-language": "es-US" },
      payload: { email: `  ${ADDRESS.toUpperCase()}  ` },
    });

    await vi.waitFor(() => {
      expect(w.sent).toHaveLength(1);
    });

    const message = w.sent[0];
    expect(message?.to).toBe(ADDRESS);
    expect(message?.kind).toBe("password_reset");
    expect(message?.subject).toContain("contraseña");
    expect(message?.text).toContain("http://localhost:3000/es/account/reset-password?token=");

    const token = tokenFromMessage(message);
    expect(w.tokens).toHaveLength(1);
    expect(w.tokens[0]?.purpose).toBe("PASSWORD_RESET");
    expect(w.tokens[0]?.tokenHash).toBe(hashSessionToken(token));
    expect(w.tokens[0]?.tokenHash).not.toBe(token);

    await app.close();
  });

  it("no envia a una cuenta sin contrasena (expediente postal) ni a una suspendida", async () => {
    const postal = world({ hasCredential: false });
    const suspended = world({ identity: { status: "SUSPENDED" } });

    for (const w of [postal, suspended]) {
      const app = await w.app();
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/forgot",
        payload: { email: ADDRESS },
      });
      expect(response.statusCode).toBe(200);
      await app.close();
    }

    // Da tiempo a que terminen las tareas de fondo antes de afirmar que no enviaron.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(postal.sent).toHaveLength(0);
    expect(suspended.sent).toHaveLength(0);
  });

  it("deja de enviar al llegar al tope de la ventana, sin cambiar la respuesta", async () => {
    const w = world();
    const app = await w.app();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/forgot",
        payload: { email: ADDRESS },
      });
      expect(response.statusCode).toBe(200);
      await vi.waitFor(() => {
        expect(w.sent.length).toBeGreaterThanOrEqual(Math.min(attempt + 1, 3));
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.sent).toHaveLength(3);

    await app.close();
  });

  it("un fallo del proveedor no cambia la respuesta", async () => {
    const w = world({ failSend: true });
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: ADDRESS },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acknowledged: true });

    await app.close();
  });
});

describe("POST /auth/password/reset", () => {
  it("fija la contrasena, revoca las sesiones y gasta los demas enlaces", async () => {
    const w = world();
    const token = w.seedToken("PASSWORD_RESET");
    w.seedToken("PASSWORD_RESET");
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: FAKE_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acknowledged: true });

    expect(w.passwordsSet).toHaveLength(1);
    const stored = w.passwordsSet[0] ?? "";
    expect(stored.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(FAKE_PASSWORD, stored)).resolves.toBe(true);

    expect(w.revokedFor).toEqual([IDENTITY_ID]);
    expect(w.tokens.every((t) => t.consumedAt !== null)).toBe(true);

    await app.close();
  });

  it("el mismo enlace no sirve dos veces", async () => {
    const w = world();
    const token = w.seedToken("PASSWORD_RESET");
    const app = await w.app();

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: FAKE_PASSWORD },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: FAKE_PASSWORD },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(422);
    expect(errorCode(second)).toBe("RESET_TOKEN_INVALID");
    expect(w.passwordsSet).toHaveLength(1);

    await app.close();
  });

  it("una contrasena corta es WEAK_PASSWORD y NO quema el enlace", async () => {
    const w = world();
    const token = w.seedToken("PASSWORD_RESET");
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: "corta-2026" },
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("WEAK_PASSWORD");
    expect(w.tokens[0]?.consumedAt).toBeNull();
    expect(w.passwordsSet).toHaveLength(0);

    await app.close();
  });

  it("un enlace caducado es 410 RESET_TOKEN_EXPIRED", async () => {
    const w = world();
    const token = w.seedToken("PASSWORD_RESET", { expiresAt: new Date(Date.now() - 1_000) });
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: FAKE_PASSWORD },
    });

    expect(response.statusCode).toBe(410);
    expect(errorCode(response)).toBe("RESET_TOKEN_EXPIRED");
    expect(w.revokedFor).toHaveLength(0);

    await app.close();
  });

  it("un enlace de VERIFICACION no restablece contrasenas", async () => {
    const w = world();
    const token = w.seedToken("EMAIL_VERIFICATION");
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: FAKE_PASSWORD },
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("RESET_TOKEN_INVALID");
    expect(w.passwordsSet).toHaveLength(0);

    await app.close();
  });

  it("un token con forma imposible se rechaza sin consultar", async () => {
    const w = world();
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token: "no-es-un-token", password: FAKE_PASSWORD },
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("RESET_TOKEN_INVALID");

    await app.close();
  });
});

describe("POST /auth/verify-email", () => {
  it("marca el correo como verificado sin exigir sesion", async () => {
    const w = world();
    const token = w.seedToken("EMAIL_VERIFICATION");
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acknowledged: true });
    expect(w.verifiedAt()).not.toBeNull();

    await app.close();
  });

  it("un enlace enviado a una direccion anterior no verifica la actual", async () => {
    const w = world();
    const token = w.seedToken("EMAIL_VERIFICATION", { email: "anterior@example.invalid" });
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token },
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("VERIFICATION_TOKEN_INVALID");
    expect(w.verifiedAt()).toBeNull();

    await app.close();
  });

  it("caducado es 410 y de restablecimiento es 422", async () => {
    const w = world();
    const expired = w.seedToken("EMAIL_VERIFICATION", { expiresAt: new Date(Date.now() - 1_000) });
    const reset = w.seedToken("PASSWORD_RESET");
    const app = await w.app();

    const a = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: expired },
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: reset },
    });

    expect(a.statusCode).toBe(410);
    expect(errorCode(a)).toBe("VERIFICATION_TOKEN_EXPIRED");
    expect(b.statusCode).toBe(422);
    expect(errorCode(b)).toBe("VERIFICATION_TOKEN_INVALID");
    expect(w.verifiedAt()).toBeNull();

    await app.close();
  });
});

describe("POST /auth/verify-email/resend", () => {
  const sessionCookie = { [PARTICIPANT_COOKIE]: generateSessionToken() };

  it("envia un enlace nuevo a la direccion de la cuenta, en el idioma de la peticion", async () => {
    const w = world();
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email/resend",
      headers: { "accept-language": "en-US" },
      cookies: sessionCookie,
    });

    expect(response.statusCode).toBe(200);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]?.to).toBe(ADDRESS);
    expect(w.sent[0]?.kind).toBe("email_verification");
    expect(w.sent[0]?.text).toContain("http://localhost:3000/en/account/verify-email?token=");

    await app.close();
  });

  it("no envia nada si el correo ya esta verificado", async () => {
    const w = world({ identity: { emailVerifiedAt: new Date("2026-09-01T00:00:00Z") } });
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email/resend",
      cookies: sessionCookie,
    });

    expect(response.statusCode).toBe(200);
    expect(w.sent).toHaveLength(0);

    await app.close();
  });

  it("si el proveedor falla lo dice (503) en vez de fingir el envio", async () => {
    const w = world({ failSend: true });
    const app = await w.app();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email/resend",
      cookies: sessionCookie,
    });

    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe("SERVICE_UNAVAILABLE");

    await app.close();
  });

  it("el enlace reenviado verifica el correo de punta a punta", async () => {
    const w = world();
    const app = await w.app();

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email/resend",
      cookies: sessionCookie,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: tokenFromMessage(w.sent[0]) },
    });

    expect(response.statusCode).toBe(200);
    expect(w.verifiedAt()).not.toBeNull();

    await app.close();
  });
});
