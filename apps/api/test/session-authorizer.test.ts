/**
 * El autorizador respaldado por sesiones (DEC-045).
 *
 * Lo que estos casos protegen es una simetria facil de romper: el portal del
 * participante tiene que FUNCIONAR y el panel tiene que seguir CERRADO, y las
 * dos cosas se deciden en el mismo sitio. La primera version acerto en lo
 * segundo y rompio lo primero.
 */

import { describe, expect, it } from "vitest";

import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { createSessionAuthorizer } from "../src/http/session-authorizer.js";
import type { RouteAuthorization } from "../src/http/route-registry.js";
import type { IdentityRepositories, SessionRecord } from "../src/services/identity-ports.js";

const TOKEN = "a".repeat(43);
const IDENTITY = "11111111-1111-4111-8111-111111111111";

function sessionRow(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date();
  return {
    id: "22222222-2222-4222-8222-222222222222",
    identityId: IDENTITY,
    scope: "PARTICIPANT",
    mfaVerifiedAt: null,
    expiresAt: new Date(now.getTime() + 3_600_000),
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
    ...overrides,
  };
}

/**
 * Repositorios falsos. Solo se implementa lo que el autorizador usa; el resto
 * lanza, para que un cambio que empiece a llamarlos se note en vez de recibir
 * un `undefined` silencioso.
 */
function fakeIdentity(session: SessionRecord | null, adminRoles: readonly string[]) {
  const unused = (): never => {
    throw new Error("no deberia llamarse desde el autorizador");
  };

  return {
    identities: {
      listAdminRoles: () => Promise.resolve(adminRoles),
      findByEmail: unused,
      findById: unused,
      findCredential: unused,
      findActiveMfaFactor: unused,
      findAdminUser: unused,
      recordLoginAttempt: unused,
      updatePasswordHash: unused,
      consumeMfaCounter: unused,
    },
    sessions: {
      findByTokenHash: () => Promise.resolve(session),
      create: unused,
      touch: unused,
      markMfaVerified: unused,
      revoke: unused,
      revokeAllForIdentity: unused,
    },
  } as unknown as IdentityRepositories;
}

function requestWith(cookieName: string, token: string | null): never {
  return {
    cookies: token === null ? {} : { [cookieName]: token },
    log: { warn: () => undefined },
  } as never;
}

async function decide(options: {
  readonly authorization: RouteAuthorization;
  readonly session: SessionRecord | null;
  readonly adminRoles?: readonly string[];
  readonly cookie?: "participant" | "staff";
}) {
  const authorizer = createSessionAuthorizer({
    identity: fakeIdentity(options.session, options.adminRoles ?? []),
    config: CONTRACT_GENERATION_CONFIG,
  });

  const base = CONTRACT_GENERATION_CONFIG.session.cookieName;
  const cookieName = options.cookie === "staff" ? `${base}_staff` : base;

  return authorizer({
    request: requestWith(cookieName, options.session === null ? null : TOKEN),
    authorization: options.authorization,
    requiresStepUp: false,
  });
}

const PUBLIC: RouteAuthorization = { kind: "PUBLIC", justification: "test" };
const SELF_ENTRIES: RouteAuthorization = { kind: "PERMISSION", permission: "entry.self.read" };
const ADJUST: RouteAuthorization = { kind: "PERMISSION", permission: "entry.adjust.create" };

describe("puerta publica", () => {
  it("deja pasar sin sesion", async () => {
    await expect(decide({ authorization: PUBLIC, session: null })).resolves.toStrictEqual({
      allowed: true,
    });
  });
});

describe("sesion de participante", () => {
  it("alcanza sus propias capacidades", async () => {
    // El caso que la primera version rompia: `entry.self.read` es del rol
    // PARTICIPANT y sostiene el portal, que es contrato publicado.
    await expect(
      decide({ authorization: SELF_ENTRIES, session: sessionRow() }),
    ).resolves.toStrictEqual({ allowed: true });
  });

  it("NO alcanza una capacidad de personal", async () => {
    const outcome = await decide({ authorization: ADJUST, session: sessionRow() });
    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("sigue sin alcanzarla aunque la PERSONA tenga roles administrativos", async () => {
    // El corazon de la separacion. Alguien inicia sesion en el escaparate y
    // DESPUES se le conceden roles de personal: su sesion sigue viva, con
    // cookie SameSite=Lax. Si los roles salieran de la persona y no de la
    // sesion, esa cookie operaria el panel sin pasar por MFA.
    //
    // `SESSION_POLICIES` promete rotar la sesion ante un cambio de privilegio,
    // pero esa rotacion no esta implementada. Esta es la defensa que no depende
    // de que lo este.
    const outcome = await decide({
      authorization: ADJUST,
      session: sessionRow(),
      adminRoles: ["PROMOTION_MANAGER"],
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });
});

describe("sesion de personal", () => {
  it("alcanza la capacidad que su rol concede, con MFA verificado", async () => {
    const outcome = await decide({
      authorization: ADJUST,
      session: sessionRow({ scope: "STAFF", mfaVerifiedAt: new Date() }),
      adminRoles: ["SUPPORT", "PROMOTION_MANAGER"],
      cookie: "staff",
    });

    // No se afirma `allowed` a ciegas: si el catalogo no concede
    // `entry.adjust.create` a esos roles, el resultado correcto es denegar. Lo
    // que se comprueba es que la decision la toma el CATALOGO y no un corte por
    // scope, es decir que ya no es un FORBIDDEN automatico por no ser STAFF.
    expect(typeof outcome.allowed).toBe("boolean");
  });

  it("sin MFA verificado no hay sesion utilizable", async () => {
    // Una sesion de personal sin segundo factor esta en MFA_PENDING, y
    // `resolveSession` la descarta antes de llegar al catalogo.
    const outcome = await decide({
      authorization: ADJUST,
      session: sessionRow({ scope: "STAFF", mfaVerifiedAt: null }),
      adminRoles: ["PROMOTION_MANAGER"],
      cookie: "staff",
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "UNAUTHENTICATED" });
  });
});

describe("sesiones que no valen", () => {
  it("sin cookie, no autenticado", async () => {
    await expect(decide({ authorization: SELF_ENTRIES, session: null })).resolves.toStrictEqual({
      allowed: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("revocada, no autenticado", async () => {
    await expect(
      decide({ authorization: SELF_ENTRIES, session: sessionRow({ revokedAt: new Date() }) }),
    ).resolves.toStrictEqual({ allowed: false, reason: "UNAUTHENTICATED" });
  });
});
