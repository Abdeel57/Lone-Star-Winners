/**
 * El carrito sin cuenta pasa a la cuenta al registrarse (DEC-079).
 *
 * Lo que se protege, por orden de lo que costaria equivocarse:
 *
 *   1. que lo que el visitante lleno sin cuenta NO se pierda al crearla;
 *   2. que la sesion anonima quede REVOCADA y su cookie borrada: despues del
 *      alta, ese token no debe servir para nada;
 *   3. que un fallo al pasar el carrito NO tumbe el alta: la cuenta ya existe y
 *      la persona tiene que poder entrar.
 *
 * Repositorios en memoria. La transaccion, el `FOR UPDATE` y el tope de la
 * CHECK se prueban contra PostgreSQL real en la integracion (DEC-018).
 */

import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { REQUIRED_CONSENTS } from "../src/config/consents.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { CreateSessionInput, IdentityRepositories } from "../src/services/identity-ports.js";
import {
  createFakeRepositories,
  PARTICIPANT_ID,
  VARIANT_ID,
  type FakeRepositories,
} from "./support/in-memory-repositories.js";

const NEW_IDENTITY = "33333333-3333-4333-8333-333333333333";
const CART_COOKIE = `${CONTRACT_GENERATION_CONFIG.session.cookieName}_cart`;

const REGISTER_BODY = {
  email: "nueva.persona@example.invalid",
  password: "FAKE-registro-prueba-2026",
  display_name: "Persona Nueva",
  language_preference: "es-US",
  consents: REQUIRED_CONSENTS.map((consent) => ({ key: consent.key, version: consent.version })),
  date_of_birth: "1990-05-05",
  residence_state: "TX",
} as const;

function setup(options: { adoptionFails?: boolean } = {}) {
  const repositories: FakeRepositories = createFakeRepositories({
    participantByIdentity: { [NEW_IDENTITY]: PARTICIPANT_ID },
  });
  if (options.adoptionFails === true) {
    (repositories.carts as { adoptSessionCart: unknown }).adoptSessionCart = () =>
      Promise.reject(new Error("base de datos caida a mitad"));
  }

  const cartRows = new Map<
    string,
    { id: string; createdAt: Date; revokedAt: Date | null; expiresAt: Date }
  >();
  const revoked: { id: string; reason: string }[] = [];

  const identity = {
    identities: {
      registerParticipant: () =>
        Promise.resolve({
          id: NEW_IDENTITY,
          email: REGISTER_BODY.email,
          emailVerifiedAt: null,
          status: "ACTIVE",
        }),
    },
    sessions: {
      create: (input: CreateSessionInput) => {
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
      findByTokenHash: () => Promise.resolve(null),
    },
    cartSessions: {
      create: (input: { tokenHash: string; expiresAt: Date }) => {
        const row = {
          id: `cccccccc-0000-4000-8000-${String(cartRows.size + 1).padStart(12, "0")}`,
          createdAt: new Date(),
          revokedAt: null,
          expiresAt: input.expiresAt,
        };
        cartRows.set(input.tokenHash, row);
        return Promise.resolve(row);
      },
      findByTokenHash: (hash: string) => Promise.resolve(cartRows.get(hash) ?? null),
      revoke: (id: string, reason: string) => {
        revoked.push({ id, reason });
        return Promise.resolve();
      },
    },
    emailTokens: {
      countIssuedSince: () => Promise.resolve(0),
      issue: () => Promise.resolve(),
    },
  } as unknown as IdentityRepositories;

  const dependencies = {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories,
    identity,
    email: { provider: "fake", send: () => Promise.resolve() },
  } as unknown as AppDependencies;

  return { dependencies, repositories, revoked };
}

/** Anade como visitante y devuelve el token de la cookie de carrito. */
async function addAsGuest(app: Awaited<ReturnType<typeof createApp>>): Promise<string> {
  const added = await app.inject({
    method: "POST",
    url: "/api/v1/cart/items",
    payload: { variant_id: VARIANT_ID, quantity: 3 },
  });
  expect(added.statusCode).toBe(200);
  const cookie = added.cookies.find((candidate) => candidate.name === CART_COOKIE);
  expect(cookie).toBeDefined();
  return cookie?.value ?? "";
}

describe("al registrarse, el carrito sin cuenta pasa a la cuenta (DEC-079)", () => {
  it("lo que se lleno sin cuenta esta en el carrito de la cuenta nueva", async () => {
    const { dependencies, repositories } = setup();
    const app = await createApp(dependencies);
    const token = await addAsGuest(app);

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: REGISTER_BODY,
      cookies: { [CART_COOKIE]: token },
    });
    await app.close();

    expect(registered.statusCode).toBe(201);
    const account = await repositories.carts.findOpen({
      kind: "PARTICIPANT",
      participantId: PARTICIPANT_ID,
    });
    expect(account?.lines.map((line) => [line.productVariantId, line.quantity])).toEqual([
      [VARIANT_ID, 3],
    ]);
  });

  it("la sesion anonima queda revocada y su cookie se borra", async () => {
    const { dependencies, revoked } = setup();
    const app = await createApp(dependencies);
    const token = await addAsGuest(app);

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: REGISTER_BODY,
      cookies: { [CART_COOKIE]: token },
    });
    await app.close();

    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.reason).toBe("adopted_by_account");

    const cleared = registered.cookies.find((cookie) => cookie.name === CART_COOKIE);
    expect(cleared).toBeDefined();
    expect(cleared?.maxAge).toBe(0);
    expect(cleared?.value ?? "").toBe("");
  });

  it("sin cookie de carrito no se toca ningun carrito ni se borra nada", async () => {
    const { dependencies, revoked, repositories } = setup();
    const app = await createApp(dependencies);

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: REGISTER_BODY,
    });
    await app.close();

    expect(registered.statusCode).toBe(201);
    expect(revoked).toEqual([]);
    expect(registered.cookies.find((cookie) => cookie.name === CART_COOKIE)).toBeUndefined();
    expect(repositories._carts.size).toBe(0);
  });

  it("si pasar el carrito falla, el alta sigue: la cuenta ya existe", async () => {
    const { dependencies, revoked } = setup({ adoptionFails: true });
    const app = await createApp(dependencies);
    const token = await addAsGuest(app);

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: REGISTER_BODY,
      cookies: { [CART_COOKIE]: token },
    });
    await app.close();

    expect(registered.statusCode).toBe(201);
    // Y la sesion anonima NO se revoca: su carrito sigue donde estaba.
    expect(revoked).toEqual([]);
  });
});
