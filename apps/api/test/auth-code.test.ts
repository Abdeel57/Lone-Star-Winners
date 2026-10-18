/**
 * Entrar y darse de alta con un codigo, sin contrasena (DEC-089).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que sin el codigo correcto de ESE contacto no se abra ninguna sesion ni
 *      se cree ninguna cuenta, y que el codigo no se pueda adivinar (cinco
 *      intentos, se gasta al acertar, caduca);
 *   2. que un codigo nunca abra una sesion de personal;
 *   3. que pedir un codigo no revele si el contacto tiene cuenta;
 *   4. que el permiso de alta sirva para UNA cuenta, con ese contacto;
 *   5. que la base de datos solo guarde el HMAC del codigo.
 *
 * El correo, Twilio y Cloudflare son falsos; los codigos y permisos viven en un
 * repositorio en memoria con la misma semantica que el de Drizzle.
 */

import { describe, expect, it } from "vitest";
import { hashSessionToken, hashSignInCode, looksLikeSessionToken } from "@lsw/security";

import { createApp, type AppDependencies } from "../src/app.js";
import { REQUIRED_CONSENTS } from "../src/config/consents.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { BotCheck } from "../src/services/bot-check.js";
import type { EmailMessage } from "../src/services/email.js";
import type {
  IdentityRecord,
  IdentityRepositories,
  RegisterVerifiedParticipantInput,
  SignInChannel,
} from "../src/services/identity-ports.js";
import type { SmsVerifier } from "../src/services/sms.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const SECRET = CONTRACT_GENERATION_CONFIG.session.secret;
const PARTICIPANT_COOKIE = CONTRACT_GENERATION_CONFIG.session.cookieName;
const STAFF_COOKIE = `${PARTICIPANT_COOKIE}_staff`;
const SIGNUP_COOKIE = `${PARTICIPANT_COOKIE}_signup`;

const EXISTING_EMAIL = "ana@example.invalid";
const STAFF_EMAIL = "staff@example.invalid";
const SUSPENDED_EMAIL = "suspendida@example.invalid";
const NEW_EMAIL = "nueva@example.invalid";
const EXISTING_PHONE = "+15125550100";
const NEW_PHONE = "+15125550199";
const SMS_CODE = "123456";

const ACCEPTED_CONSENTS = REQUIRED_CONSENTS.map((consent) => ({
  key: consent.key,
  version: consent.version,
}));

const PROFILE = {
  display_name: "Ana Nueva",
  residence_state: "TX",
  consents: ACCEPTED_CONSENTS,
  language_preference: "es-US",
};

interface CodeRow {
  id: string;
  channel: SignInChannel;
  contact: string;
  codeHash: string | null;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  signupTokenHash: string | null;
  signupExpiresAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
}

function account(overrides: Partial<IdentityRecord>): IdentityRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: null,
    emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
    status: "ACTIVE",
    phoneE164: null,
    ...overrides,
  };
}

const ACCOUNTS: readonly IdentityRecord[] = [
  account({
    id: "11111111-1111-4111-8111-111111111111",
    email: EXISTING_EMAIL,
    emailVerifiedAt: null,
  }),
  account({ id: "22222222-2222-4222-8222-222222222222", email: STAFF_EMAIL }),
  account({
    id: "33333333-3333-4333-8333-333333333333",
    email: SUSPENDED_EMAIL,
    status: "SUSPENDED",
  }),
  account({ id: "44444444-4444-4444-8444-444444444444", phoneE164: EXISTING_PHONE }),
];

const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const NEW_IDENTITY = "55555555-5555-4555-8555-555555555555";

interface WorldOptions {
  readonly sms?: boolean;
  readonly botCheck?: "none" | "pass" | "fail";
  readonly emailFails?: boolean;
  readonly contactTakenOnInsert?: boolean;
}

function world(options: WorldOptions = {}) {
  const rows: CodeRow[] = [];
  const sent: EmailMessage[] = [];
  const smsStarted: string[] = [];
  const sessions: { identityId: string; scope: string; tokenHash: string }[] = [];
  const registrations: RegisterVerifiedParticipantInput[] = [];
  const verifiedEmails: string[] = [];
  const lookups: string[] = [];

  const sms: SmsVerifier = {
    provider: "fake",
    start: (phone) => {
      smsStarted.push(phone);
      return Promise.resolve("SENT");
    },
    check: (_phone, code) => Promise.resolve(code === SMS_CODE),
  };

  const botCheck: BotCheck = {
    verify: () => Promise.resolve(options.botCheck === "pass"),
  };

  const identity = {
    identities: {
      findByEmail: (email: string) => {
        lookups.push(email);
        return Promise.resolve(ACCOUNTS.find((entry) => entry.email === email) ?? null);
      },
      findByVerifiedPhone: (phone: string) => {
        lookups.push(phone);
        return Promise.resolve(ACCOUNTS.find((entry) => entry.phoneE164 === phone) ?? null);
      },
      listAdminRoles: (id: string) => Promise.resolve(id === STAFF_ID ? ["PROMOTION_MANAGER"] : []),
      findAdminUser: (id: string) => Promise.resolve(id === STAFF_ID ? { status: "ACTIVE" } : null),
      markEmailVerified: (_id: string, email: string) => {
        verifiedEmails.push(email);
        return Promise.resolve(true);
      },
      registerVerifiedParticipant: (input: RegisterVerifiedParticipantInput) => {
        registrations.push(input);
        if (options.contactTakenOnInsert === true) return Promise.resolve(null);
        return Promise.resolve(
          account({
            id: NEW_IDENTITY,
            email: input.channel === "EMAIL" ? input.contact : null,
            emailVerifiedAt: input.channel === "EMAIL" ? input.verifiedAt : null,
            phoneE164: input.channel === "SMS" ? input.contact : null,
          }),
        );
      },
    },
    sessions: {
      create: (input: {
        identityId: string;
        scope: string;
        tokenHash: string;
        expiresAt: Date;
      }) => {
        sessions.push(input);
        return Promise.resolve({
          id: "99999999-9999-4999-8999-999999999999",
          identityId: input.identityId,
          scope: input.scope,
          mfaVerifiedAt: null,
          expiresAt: input.expiresAt,
          lastSeenAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        });
      },
    },
    signInCodes: {
      countUnverifiedSince: (channel: SignInChannel, contact: string, since: Date) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              row.channel === channel &&
              row.contact === contact &&
              row.createdAt >= since &&
              row.verifiedAt === null,
          ).length,
        ),
      issue: (input: {
        id: string;
        channel: SignInChannel;
        contact: string;
        codeHash: string | null;
        expiresAt: Date;
      }) => {
        rows.push({
          ...input,
          attempts: 0,
          verifiedAt: null,
          signupTokenHash: null,
          signupExpiresAt: null,
          consumedAt: null,
          createdAt: new Date(),
        });
        return Promise.resolve();
      },
      findLatestOpen: (channel: SignInChannel, contact: string) => {
        const open = rows
          .filter(
            (row) =>
              row.channel === channel &&
              row.contact === contact &&
              row.verifiedAt === null &&
              row.consumedAt === null,
          )
          .at(-1);
        return Promise.resolve(
          open === undefined
            ? null
            : {
                id: open.id,
                codeHash: open.codeHash,
                attempts: open.attempts,
                expiresAt: open.expiresAt,
              },
        );
      },
      registerAttempt: (id: string, maxAttempts: number) => {
        const row = rows.find((entry) => entry.id === id);
        if (row === undefined || row.attempts >= maxAttempts) return Promise.resolve(null);
        row.attempts += 1;
        return Promise.resolve(row.attempts);
      },
      markVerified: (
        id: string,
        now: Date,
        signup: { tokenHash: string; expiresAt: Date } | null,
      ) => {
        // Como el WHERE de Drizzle: solo una fila ni acertada ni gastada.
        const row = rows.find(
          (entry) => entry.id === id && entry.verifiedAt === null && entry.consumedAt === null,
        );
        if (row === undefined) return Promise.resolve(false);
        row.verifiedAt = now;
        if (signup === null) {
          row.consumedAt = now;
        } else {
          row.signupTokenHash = signup.tokenHash;
          row.signupExpiresAt = signup.expiresAt;
        }
        return Promise.resolve(true);
      },
      consumeSignupTicket: (tokenHash: string, now: Date) => {
        const row = rows.find(
          (entry) => entry.signupTokenHash === tokenHash && entry.consumedAt === null,
        );
        if (row === undefined) return Promise.resolve({ status: "INVALID" as const });
        if (row.signupExpiresAt === null || row.signupExpiresAt <= now) {
          return Promise.resolve({ status: "EXPIRED" as const });
        }
        row.consumedAt = now;
        return Promise.resolve({
          status: "CONSUMED" as const,
          channel: row.channel,
          contact: row.contact,
          verifiedAt: row.verifiedAt ?? now,
        });
      },
    },
  } as unknown as IdentityRepositories;

  const appPromise = createApp({
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    identity,
    email: {
      provider: "fake",
      send: (message: EmailMessage) => {
        if (options.emailFails === true) return Promise.reject(new Error("proveedor caido"));
        sent.push(message);
        return Promise.resolve();
      },
    },
    sms: options.sms === false ? null : sms,
    botCheck: (options.botCheck ?? "none") === "none" ? null : botCheck,
  } as unknown as AppDependencies);

  async function start(contact: string, extra: Record<string, unknown> = {}) {
    const app = await appPromise;
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/code/start",
      headers: { "accept-language": "es-US" },
      payload: { contact, ...extra },
    });
  }

  async function verify(contact: string, code: string) {
    const app = await appPromise;
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/code/verify",
      payload: { contact, code },
    });
  }

  async function register(body: Record<string, unknown>, ticket: string | null) {
    const app = await appPromise;
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/code/register",
      payload: body,
      ...(ticket === null ? {} : { cookies: { [SIGNUP_COOKIE]: ticket } }),
    });
  }

  /** El codigo del ultimo correo enviado. */
  function lastEmailCode(): string {
    const text = sent.at(-1)?.text ?? "";
    return /\b(\d{6})\b/u.exec(text)?.[1] ?? "";
  }

  /** Pide y acierta el codigo de un contacto sin cuenta; devuelve el permiso de alta. */
  async function signupTicketFor(contact: string): Promise<string> {
    await start(contact);
    const response = await verify(contact, contact.includes("@") ? lastEmailCode() : SMS_CODE);
    return response.cookies.find((cookie) => cookie.name === SIGNUP_COOKIE)?.value ?? "";
  }

  return {
    rows,
    sent,
    smsStarted,
    sessions,
    registrations,
    verifiedEmails,
    lookups,
    start,
    verify,
    register,
    lastEmailCode,
    signupTicketFor,
  };
}

function errorCode(response: { json: () => unknown }): string {
  return (response.json() as { error: { code: string } }).error.code;
}

// ---------------------------------------------------------------------------

describe("POST /auth/code/start", () => {
  it("por correo: envia seis digitos al correo normalizado y guarda solo su HMAC", async () => {
    const w = world();
    const response = await w.start("  Ana@Example.INVALID ");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ acknowledged: true, channel: "EMAIL" });

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]?.to).toBe(EXISTING_EMAIL);
    expect(w.sent[0]?.kind).toBe("sign_in_code");
    // El correo va en el idioma de la pagina, y el codigo tambien en el asunto.
    const code = w.lastEmailCode();
    expect(code).toMatch(/^\d{6}$/u);
    expect(w.sent[0]?.subject).toContain(code);
    expect(w.sent[0]?.subject).toContain("código");

    const row = w.rows[0];
    expect(row?.contact).toBe(EXISTING_EMAIL);
    expect(row?.codeHash).toBe(hashSignInCode(code, row?.id ?? "", SECRET));
    expect(row?.codeHash).not.toContain(code);
  });

  it("no mira si el contacto tiene cuenta: misma respuesta para uno conocido y uno nuevo", async () => {
    const w = world();
    const known = await w.start(EXISTING_EMAIL);
    const unknown = await w.start(NEW_EMAIL);

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.json()).toStrictEqual(unknown.json());
    expect(w.lookups).toHaveLength(0);
    expect(w.sent).toHaveLength(2);
  });

  it("por celular: normaliza el numero y lo pide a Twilio sin guardar ningun codigo", async () => {
    const w = world();
    const response = await w.start("(512) 555-0199");

    expect(response.json()).toStrictEqual({ acknowledged: true, channel: "SMS" });
    expect(w.smsStarted).toStrictEqual([NEW_PHONE]);
    expect(w.rows[0]?.codeHash).toBeNull();
    expect(w.sent).toHaveLength(0);
  });

  it("sin proveedor de SMS, el celular es 503 SMS_NOT_CONFIGURED", async () => {
    const w = world({ sms: false });
    const response = await w.start("512-555-0199");

    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe("SMS_NOT_CONFIGURED");
    expect(w.rows).toHaveLength(0);
  });

  it("un correo mal escrito es CONTACT_INVALID y un numero imposible PHONE_INVALID", async () => {
    const w = world();

    const email = await w.start("ana@sin-punto");
    expect(email.statusCode).toBe(422);
    expect(errorCode(email)).toBe("CONTACT_INVALID");

    const phone = await w.start("555-0100");
    expect(phone.statusCode).toBe(422);
    expect(errorCode(phone)).toBe("PHONE_INVALID");

    expect(w.sent).toHaveLength(0);
    expect(w.smsStarted).toHaveLength(0);
  });

  it("con anti-bots configurado, sin pasarlo no sale nada", async () => {
    const w = world({ botCheck: "fail" });
    const response = await w.start(NEW_EMAIL, { bot_check_token: "FAKE-token" });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("BOT_CHECK_FAILED");
    expect(w.sent).toHaveLength(0);
    expect(w.rows).toHaveLength(0);
  });

  it("entrar y salir varias veces no agota el tope: solo cuentan los codigos sin acertar", async () => {
    const w = world();
    for (let i = 0; i < 5; i += 1) {
      expect((await w.start(EXISTING_EMAIL)).statusCode).toBe(200);
      expect((await w.verify(EXISTING_EMAIL, w.lastEmailCode())).statusCode).toBe(200);
    }
    expect(w.sessions).toHaveLength(5);
  });

  it("tres codigos sin usar por destinatario; el cuarto es 429 y no sale", async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) {
      expect((await w.start(NEW_EMAIL)).statusCode).toBe(200);
    }

    const fourth = await w.start(NEW_EMAIL);
    expect(fourth.statusCode).toBe(429);
    expect(errorCode(fourth)).toBe("RATE_LIMITED");
    expect(w.sent).toHaveLength(3);

    // El tope es por destinatario: otro contacto no lo hereda.
    expect((await w.start(EXISTING_EMAIL)).statusCode).toBe(200);
  });

  it("si el proveedor de correo falla, se dice: 503", async () => {
    const w = world({ emailFails: true });
    const response = await w.start(NEW_EMAIL);

    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("POST /auth/code/verify", () => {
  it("con cuenta: entra como PARTICIPANTE, con cookie del escaparate y nunca la de personal", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const response = await w.verify(EXISTING_EMAIL, w.lastEmailCode());

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; session: { scope: string; email: string } }>();
    expect(body.status).toBe("SIGNED_IN");
    expect(body.session.scope).toBe("PARTICIPANT");
    expect(body.session.email).toBe(EXISTING_EMAIL);

    const cookie = response.cookies.find((entry) => entry.name === PARTICIPANT_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(looksLikeSessionToken(cookie?.value ?? "")).toBe(true);
    expect(response.cookies.find((entry) => entry.name === STAFF_COOKIE)).toBeUndefined();
    expect(w.sessions[0]?.scope).toBe("PARTICIPANT");
    expect(w.sessions[0]?.tokenHash).toBe(hashSessionToken(cookie?.value ?? ""));
  });

  it("acertar el codigo del correo lo da por verificado", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const response = await w.verify(EXISTING_EMAIL, w.lastEmailCode());

    expect(w.verifiedEmails).toStrictEqual([EXISTING_EMAIL]);
    expect(response.json<{ session: { email_verified: boolean } }>().session.email_verified).toBe(
      true,
    );
  });

  it("el codigo se gasta al acertarlo: el mismo dos veces no entra", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const code = w.lastEmailCode();

    expect((await w.verify(EXISTING_EMAIL, code)).statusCode).toBe(200);
    const again = await w.verify(EXISTING_EMAIL, code);
    expect(again.statusCode).toBe(410);
    expect(errorCode(again)).toBe("SIGN_IN_CODE_EXPIRED");
    expect(w.sessions).toHaveLength(1);
  });

  it("acepta el codigo con espacios, como lo copia la gente", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const code = w.lastEmailCode();

    const response = await w.verify(EXISTING_EMAIL, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(response.statusCode).toBe(200);
  });

  it("un codigo incorrecto es 422; al quinto fallo el codigo muere, aunque luego llegue el bueno", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const code = w.lastEmailCode();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 4; i += 1) {
      const response = await w.verify(EXISTING_EMAIL, wrong);
      expect(response.statusCode).toBe(422);
      expect(errorCode(response)).toBe("SIGN_IN_CODE_INVALID");
    }

    const fifth = await w.verify(EXISTING_EMAIL, wrong);
    expect(fifth.statusCode).toBe(410);
    expect(errorCode(fifth)).toBe("SIGN_IN_CODE_EXPIRED");

    const right = await w.verify(EXISTING_EMAIL, code);
    expect(right.statusCode).toBe(410);
    expect(w.sessions).toHaveLength(0);
  });

  it("un codigo caducado es 410 SIGN_IN_CODE_EXPIRED", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const row = w.rows[0];
    if (row !== undefined) row.expiresAt = new Date(Date.now() - 1_000);

    const response = await w.verify(EXISTING_EMAIL, w.lastEmailCode());
    expect(response.statusCode).toBe(410);
    expect(errorCode(response)).toBe("SIGN_IN_CODE_EXPIRED");
  });

  it("solo vale el codigo mas reciente", async () => {
    const w = world();
    await w.start(EXISTING_EMAIL);
    const first = w.lastEmailCode();
    await w.start(EXISTING_EMAIL);
    const second = w.lastEmailCode();

    if (first !== second) {
      expect((await w.verify(EXISTING_EMAIL, first)).statusCode).toBe(422);
    }
    expect((await w.verify(EXISTING_EMAIL, second)).statusCode).toBe(200);
  });

  it("sin cuenta: PROFILE_REQUIRED y una cookie de alta httpOnly, sin sesion", async () => {
    const w = world();
    await w.start(NEW_EMAIL);
    const response = await w.verify(NEW_EMAIL, w.lastEmailCode());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ status: "PROFILE_REQUIRED", session: null });

    const ticket = response.cookies.find((entry) => entry.name === SIGNUP_COOKIE);
    expect(ticket?.httpOnly).toBe(true);
    expect(ticket?.sameSite).toBe("Lax");
    expect(ticket?.path).toBe("/");
    expect(ticket?.maxAge).toBe(30 * 60);
    expect(looksLikeSessionToken(ticket?.value ?? "")).toBe(true);
    // En la base de datos, solo su hash.
    expect(w.rows[0]?.signupTokenHash).toBe(hashSessionToken(ticket?.value ?? ""));

    expect(response.cookies.find((entry) => entry.name === PARTICIPANT_COOKIE)).toBeUndefined();
    expect(w.sessions).toHaveLength(0);
  });

  it("un codigo nunca abre una sesion de personal", async () => {
    const w = world();
    await w.start(STAFF_EMAIL);
    const response = await w.verify(STAFF_EMAIL, w.lastEmailCode());

    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe("STAFF_ACCOUNT_USE_PANEL");
    expect(response.cookies).toHaveLength(0);
    expect(w.sessions).toHaveLength(0);
  });

  it("una cuenta que no esta activa no entra", async () => {
    const w = world();
    await w.start(SUSPENDED_EMAIL);
    const response = await w.verify(SUSPENDED_EMAIL, w.lastEmailCode());

    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe("ACCOUNT_UNAVAILABLE");
    expect(w.sessions).toHaveLength(0);
  });

  it("por celular: lo comprueba Twilio; con el bueno entra, con otro es 422", async () => {
    const w = world();
    await w.start("512 555 0100");

    const wrong = await w.verify("512 555 0100", "999999");
    expect(wrong.statusCode).toBe(422);
    expect(errorCode(wrong)).toBe("SIGN_IN_CODE_INVALID");

    const right = await w.verify("512 555 0100", SMS_CODE);
    expect(right.statusCode).toBe(200);
    expect(right.json<{ status: string; session: { phone: string } }>().session.phone).toBe(
      EXISTING_PHONE,
    );
  });

  it("pedir codigo nunca, y teclear uno, no entra", async () => {
    const w = world();
    const response = await w.verify(EXISTING_EMAIL, "123456");

    expect(response.statusCode).toBe(410);
    expect(errorCode(response)).toBe("SIGN_IN_CODE_EXPIRED");
  });
});

describe("POST /auth/code/register", () => {
  it("crea la cuenta SIN contrasena con el contacto verificado, nombre, estado y documentos", async () => {
    const w = world();
    const ticket = await w.signupTicketFor(NEW_EMAIL);
    const response = await w.register(PROFILE, ticket);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      authenticated: true,
      state: "ACTIVE",
      scope: "PARTICIPANT",
      email: NEW_EMAIL,
      email_verified: true,
      roles: [],
    });

    const created = w.registrations[0];
    expect(created).toMatchObject({
      channel: "EMAIL",
      contact: NEW_EMAIL,
      displayName: "Ana Nueva",
      residenceState: "TX",
      preferredLocale: "es-US",
    });
    expect(created?.consents).toStrictEqual(ACCEPTED_CONSENTS);
    expect(Object.keys(created ?? {})).not.toContain("passwordHash");
    expect(Object.keys(created ?? {})).not.toContain("dateOfBirth");

    expect(response.cookies.find((entry) => entry.name === PARTICIPANT_COOKIE)).toBeDefined();
    // La cookie de alta se retira.
    const cleared = response.cookies.find((entry) => entry.name === SIGNUP_COOKIE);
    expect(cleared?.maxAge).toBe(0);
  });

  it("con celular, la cuenta queda con ese celular", async () => {
    const w = world();
    const ticket = await w.signupTicketFor(NEW_PHONE);
    const response = await w.register(PROFILE, ticket);

    expect(response.statusCode).toBe(201);
    expect(w.registrations[0]).toMatchObject({ channel: "SMS", contact: NEW_PHONE });
  });

  it("sin cookie de alta es 410 SIGNUP_EXPIRED y no se crea nada", async () => {
    const w = world();
    const response = await w.register(PROFILE, null);

    expect(response.statusCode).toBe(410);
    expect(errorCode(response)).toBe("SIGNUP_EXPIRED");
    expect(w.registrations).toHaveLength(0);
  });

  it("el permiso de alta sirve una sola vez", async () => {
    const w = world();
    const ticket = await w.signupTicketFor(NEW_EMAIL);

    expect((await w.register(PROFILE, ticket)).statusCode).toBe(201);
    const again = await w.register(PROFILE, ticket);
    expect(again.statusCode).toBe(410);
    expect(w.registrations).toHaveLength(1);
  });

  it("faltan documentos: 422 CONSENT_REQUIRED, y el permiso NO se quema", async () => {
    const w = world();
    const ticket = await w.signupTicketFor(NEW_EMAIL);

    const missing = await w.register({ ...PROFILE, consents: [] }, ticket);
    expect(missing.statusCode).toBe(422);
    expect(errorCode(missing)).toBe("CONSENT_REQUIRED");

    expect((await w.register(PROFILE, ticket)).statusCode).toBe(201);
  });

  it("nombre y estado son obligatorios", async () => {
    const w = world();
    const ticket = await w.signupTicketFor(NEW_EMAIL);

    const { display_name: _name, ...withoutName } = PROFILE;
    expect((await w.register(withoutName, ticket)).statusCode).toBe(422);
    expect((await w.register({ ...PROFILE, residence_state: "PR" }, ticket)).statusCode).toBe(422);
    expect(w.registrations).toHaveLength(0);
  });

  it("si otra alta gano la carrera con ese contacto, 409", async () => {
    const w = world({ contactTakenOnInsert: true });
    const ticket = await w.signupTicketFor(NEW_EMAIL);
    const response = await w.register(PROFILE, ticket);

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("EMAIL_ALREADY_REGISTERED");
    expect(w.sessions).toHaveLength(0);
  });
});
