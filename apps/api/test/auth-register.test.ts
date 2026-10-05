/**
 * Alta de participante (`POST /api/v1/auth/register`, contrato seccion 10).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que el alta NUNCA produzca una sesion de personal ni entregue una cuenta
 *      ajena: un correo ya registrado es 409, sin cookie y sin sesion;
 *   2. que la contrasena no llegue al repositorio en claro;
 *   3. que lo que el motor rechazaria con un 500 -correo mal formado, idioma
 *      desconocido- se rechace antes con un 422;
 *   4. que una lista de consentimientos NO se acepte y se tire: mientras no
 *      exista donde guardarla, se rechaza.
 *
 * El repositorio es falso y en memoria. La atomicidad de la transaccion y el
 * indice unico viven en el motor y no se simulan aqui (DEC-018): lo que se
 * prueba es lo que decide el handler.
 */

import { describe, expect, it, vi } from "vitest";
import { hashSessionToken, looksLikeSessionToken, verifyPassword } from "@lsw/security";

import { createApp, type AppDependencies } from "../src/app.js";
import { REQUIRED_CONSENTS } from "../src/config/consents.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { cookieNameFor } from "../src/http/session-cookie.js";
import type { EmailMessage, EmailSender } from "../src/services/email.js";
import type {
  CreateSessionInput,
  IdentityRepositories,
  IssueEmailTokenInput,
  RegisterParticipantInput,
} from "../src/services/identity-ports.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const COOKIE_BASE = CONTRACT_GENERATION_CONFIG.session.cookieName;
const PARTICIPANT_COOKIE = cookieNameFor(COOKIE_BASE, "PARTICIPANT");
const STAFF_COOKIE = cookieNameFor(COOKIE_BASE, "STAFF");

const NEW_IDENTITY = "33333333-3333-4333-8333-333333333333";
const TAKEN_EMAIL = "ya.existe@example.invalid";

/** Doce caracteres o mas: el suelo de `MINIMUM_PASSWORD_LENGTH`. */
const FAKE_PASSWORD = "FAKE-registro-prueba-2026";

/** DEC-067: los documentos de `GET /config`, con su version vigente. */
const ACCEPTED_CONSENTS = REQUIRED_CONSENTS.map((consent) => ({
  key: consent.key,
  version: consent.version,
}));

const VALID_BODY = {
  email: "nueva.persona@example.invalid",
  password: FAKE_PASSWORD,
  display_name: "Persona Nueva",
  language_preference: "es-US",
  consents: ACCEPTED_CONSENTS,
  date_of_birth: "1990-05-05",
  residence_state: "TX",
} as const;

/**
 * Repositorios falsos. Solo se implementa lo que el alta usa; el resto lanza,
 * para que un cambio que empiece a llamarlos se note en vez de recibir un
 * `undefined` silencioso.
 */
function fakeIdentity() {
  const registrations: RegisterParticipantInput[] = [];
  const sessions: CreateSessionInput[] = [];
  const issued: IssueEmailTokenInput[] = [];
  const sent: EmailMessage[] = [];

  const email: EmailSender = {
    provider: "fake",
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };

  const unused = (): never => {
    throw new Error("no deberia llamarse desde el alta");
  };

  const identity = {
    identities: {
      registerParticipant: (input: RegisterParticipantInput) => {
        registrations.push(input);

        // El falso imita al indice unico: compara normalizado, como el motor.
        if (input.email.trim().toLowerCase() === TAKEN_EMAIL) {
          return Promise.resolve(null);
        }

        return Promise.resolve({
          id: NEW_IDENTITY,
          email: input.email,
          emailVerifiedAt: null,
          status: "ACTIVE",
        });
      },
      findByEmail: unused,
      findById: unused,
      findCredential: unused,
      findActiveMfaFactor: unused,
      listAdminRoles: unused,
      findAdminUser: unused,
      recordLoginAttempt: unused,
      updatePasswordHash: unused,
      consumeMfaCounter: unused,
    },
    sessions: {
      create: (input: CreateSessionInput) => {
        sessions.push(input);
        const now = new Date();
        return Promise.resolve({
          id: "44444444-4444-4444-8444-444444444444",
          identityId: input.identityId,
          scope: input.scope,
          mfaVerifiedAt: null,
          expiresAt: input.expiresAt,
          lastSeenAt: now,
          revokedAt: null,
          createdAt: now,
        });
      },
      findByTokenHash: unused,
      touch: unused,
      markMfaVerified: unused,
      revoke: unused,
      revokeAllForIdentity: unused,
    },
    // DEC-058: el alta emite el enlace de verificacion.
    emailTokens: {
      countIssuedSince: () => Promise.resolve(0),
      issue: (input: IssueEmailTokenInput) => {
        issued.push(input);
        return Promise.resolve();
      },
      consume: unused,
      invalidateOutstanding: unused,
    },
  } as unknown as IdentityRepositories;

  return { identity, email, registrations, sessions, issued, sent };
}

async function register(payload: unknown) {
  const fake = fakeIdentity();

  const dependencies = {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    identity: fake.identity,
    email: fake.email,
  } as unknown as AppDependencies;

  const app = await createApp(dependencies);

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: payload as Record<string, unknown>,
  });

  await app.close();

  return { response, ...fake };
}

function errorCode(response: { json: () => unknown }): string {
  return (response.json() as { error: { code: string } }).error.code;
}

describe("alta correcta", () => {
  it("responde 201 con una sesion ACTIVE de participante y el correo sin verificar", async () => {
    const { response } = await register(VALID_BODY);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      authenticated: true,
      state: "ACTIVE",
      scope: "PARTICIPANT",
      email: VALID_BODY.email,
      // Nadie ha verificado nada todavia, y publicarlo como verificado seria
      // fabricar procedencia.
      email_verified: false,
      roles: [],
    });
  });

  it("emite la cookie del escaparate, httpOnly, y NUNCA la de personal", async () => {
    const { response } = await register(VALID_BODY);

    const session = response.cookies.find((cookie) => cookie.name === PARTICIPANT_COOKIE);

    expect(session).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(session?.path).toBe("/");
    expect(looksLikeSessionToken(session?.value ?? "")).toBe(true);

    expect(response.cookies.find((cookie) => cookie.name === STAFF_COOKIE)).toBeUndefined();
  });

  it("la sesion se guarda con scope PARTICIPANT y por el HASH del token", async () => {
    const { response, sessions } = await register(VALID_BODY);

    const token = response.cookies.find((cookie) => cookie.name === PARTICIPANT_COOKIE)?.value;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.identityId).toBe(NEW_IDENTITY);
    expect(sessions[0]?.scope).toBe("PARTICIPANT");
    expect(sessions[0]?.tokenHash).toBe(hashSessionToken(token ?? ""));
    expect(sessions[0]?.tokenHash).not.toBe(token);
  });

  it("al repositorio llega un hash Argon2id, no la contrasena", async () => {
    const { registrations } = await register(VALID_BODY);

    expect(registrations).toHaveLength(1);

    const stored = registrations[0]?.passwordHash ?? "";
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(stored).not.toContain(FAKE_PASSWORD);
    // Y ese hash es el de ESA contrasena: es lo que hara que el login funcione.
    await expect(verifyPassword(FAKE_PASSWORD, stored)).resolves.toBe(true);
  });

  it("pasa el idioma y el nombre tal como llegaron, y el correo recortado", async () => {
    const { registrations } = await register({
      ...VALID_BODY,
      email: "  con.espacios@example.invalid  ",
      language_preference: "en-US",
    });

    expect(registrations[0]).toMatchObject({
      email: "con.espacios@example.invalid",
      displayName: "Persona Nueva",
      preferredLocale: "en-US",
    });
  });

  it("envia el enlace de verificacion en el idioma del alta, y guarda solo su hash (DEC-058)", async () => {
    const { sent, issued } = await register(VALID_BODY);

    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });

    expect(sent[0]?.to).toBe(VALID_BODY.email);
    expect(sent[0]?.kind).toBe("email_verification");
    expect(sent[0]?.text).toContain("/es/account/verify-email?token=");

    const token = /token=([A-Za-z0-9_-]+)/u.exec(sent[0]?.text ?? "")?.[1] ?? "";
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ identityId: NEW_IDENTITY, purpose: "EMAIL_VERIFICATION" });
    expect(issued[0]?.tokenHash).toBe(hashSessionToken(token));
  });

  it("un correo ya registrado no recibe ningun enlace", async () => {
    const { sent } = await register({ ...VALID_BODY, email: TAKEN_EMAIL });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
  });

  it("el nombre es opcional: ausente o null llega como null", async () => {
    const { display_name: _omitted, ...withoutName } = VALID_BODY;

    const absent = await register(withoutName);
    const explicit = await register({ ...VALID_BODY, display_name: null });

    expect(absent.response.statusCode).toBe(201);
    expect(absent.registrations[0]?.displayName).toBeNull();
    expect(explicit.response.statusCode).toBe(201);
    expect(explicit.registrations[0]?.displayName).toBeNull();
  });
});

describe("correo ya registrado", () => {
  it("es 409 EMAIL_ALREADY_REGISTERED, sin cookie y sin sesion", async () => {
    const { response, sessions } = await register({ ...VALID_BODY, email: TAKEN_EMAIL });

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("EMAIL_ALREADY_REGISTERED");

    // El caso que no puede fallar: si aqui se abriera sesion, registrarse con
    // el correo de otra persona seria una forma de entrar en su cuenta.
    expect(sessions).toHaveLength(0);
    expect(response.cookies).toHaveLength(0);
  });

  it("no distingue mayusculas: es el mismo correo", async () => {
    const { response, sessions } = await register({
      ...VALID_BODY,
      email: TAKEN_EMAIL.toUpperCase(),
    });

    expect(response.statusCode).toBe(409);
    expect(sessions).toHaveLength(0);
  });

  it("el error no repite el correo", async () => {
    const { response } = await register({ ...VALID_BODY, email: TAKEN_EMAIL });

    expect(response.body).not.toContain(TAKEN_EMAIL);
  });
});

describe("contrasena que no cumple la politica", () => {
  it("es 422 WEAK_PASSWORD con los limites en `details`, y no se crea nada", async () => {
    const { response, registrations, sessions } = await register({
      ...VALID_BODY,
      password: "corta-2026",
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("WEAK_PASSWORD");
    expect(response.json()).toMatchObject({
      error: { details: { reason: "too_short", minimum_length: 12 } },
    });

    expect(registrations).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });
});

describe("cuerpo invalido: 422 antes de tocar el repositorio", () => {
  const cases: readonly (readonly [string, Record<string, unknown>])[] = [
    ["correo sin arroba", { ...VALID_BODY, email: "no-es-un-correo" }],
    ["correo sin dominio con punto", { ...VALID_BODY, email: "alguien@localhost" }],
    ["correo con espacios dentro", { ...VALID_BODY, email: "al guien@example.invalid" }],
    ["correo de mas de 254 caracteres", { ...VALID_BODY, email: `${"a".repeat(250)}@e.invalid` }],
    ["idioma que no es una etiqueta admitida", { ...VALID_BODY, language_preference: "es" }],
    ["idioma ausente", { ...VALID_BODY, language_preference: undefined }],
    ["nombre de mas de 120 caracteres", { ...VALID_BODY, display_name: "n".repeat(121) }],
    ["contrasena ausente", { ...VALID_BODY, password: undefined }],
    ["fecha de nacimiento ausente", { ...VALID_BODY, date_of_birth: undefined }],
    ["fecha de nacimiento sin forma de fecha", { ...VALID_BODY, date_of_birth: "05/05/1990" }],
    ["fecha de nacimiento en el futuro", { ...VALID_BODY, date_of_birth: "2999-01-01" }],
    ["estado ausente", { ...VALID_BODY, residence_state: undefined }],
    ["estado que no es de EE. UU.", { ...VALID_BODY, residence_state: "PR" }],
    ["estado en minusculas", { ...VALID_BODY, residence_state: "tx" }],
  ];

  it.each(cases)("%s", async (_name, payload) => {
    const { response, registrations } = await register(payload);

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("VALIDATION_FAILED");
    expect(registrations).toHaveLength(0);
  });
});

describe("declaracion y consentimientos (DEC-067)", () => {
  it("la fecha, el estado y los consentimientos llegan al repositorio en la misma alta", async () => {
    const { response, registrations } = await register(VALID_BODY);

    expect(response.statusCode).toBe(201);
    expect(registrations[0]?.eligibility).toMatchObject({
      dateOfBirth: "1990-05-05",
      residenceState: "TX",
    });
    expect(registrations[0]?.eligibility.declaredAt).toBeInstanceOf(Date);
    expect(registrations[0]?.consents).toEqual(ACCEPTED_CONSENTS);
  });

  it("si falta un documento es 422 CONSENT_REQUIRED, dice cual, y no crea nada", async () => {
    const { response, registrations } = await register({
      ...VALID_BODY,
      consents: ACCEPTED_CONSENTS.filter((consent) => consent.key !== "PRIVACY"),
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("CONSENT_REQUIRED");
    expect(response.json()).toMatchObject({ error: { details: { missing: ["PRIVACY"] } } });
    expect(registrations).toHaveLength(0);
  });

  it("aceptar una version que ya no es la vigente no cuenta", async () => {
    const { response, registrations } = await register({
      ...VALID_BODY,
      consents: ACCEPTED_CONSENTS.map((consent) =>
        consent.key === "OFFICIAL_RULES" ? { ...consent, version: "2026-09-30" } : consent,
      ),
    });

    expect(errorCode(response)).toBe("CONSENT_REQUIRED");
    expect(registrations).toHaveLength(0);
  });

  it("una clave que no se pidio no se guarda", async () => {
    const { response, registrations } = await register({
      ...VALID_BODY,
      consents: [...ACCEPTED_CONSENTS, { key: "MARKETING", version: "x" }],
    });

    expect(response.statusCode).toBe(201);
    expect(registrations[0]?.consents).toEqual(ACCEPTED_CONSENTS);
  });

  it("un menor o alguien de un estado excluido SI puede darse de alta: comprar mercancia esta permitido", async () => {
    // La elegibilidad se evalua al otorgar participaciones, no aqui.
    const minor = await register({ ...VALID_BODY, date_of_birth: "2015-01-01" });
    const florida = await register({ ...VALID_BODY, residence_state: "FL" });

    expect(minor.response.statusCode).toBe(201);
    expect(florida.response.statusCode).toBe(201);
  });
});
