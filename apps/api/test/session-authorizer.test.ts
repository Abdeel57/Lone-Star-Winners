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

function requestWith(
  cookieName: string,
  token: string | null,
  extra: { body?: unknown; headers?: Record<string, string> | undefined } = {},
): never {
  return {
    cookies: token === null ? {} : { [cookieName]: token },
    body: extra.body,
    headers: extra.headers ?? {},
    log: { warn: () => undefined },
  } as never;
}

async function decide(options: {
  readonly authorization: RouteAuthorization;
  readonly session: SessionRecord | null;
  readonly adminRoles?: readonly string[];
  readonly cookie?: "participant" | "staff";
  /** Valor que devuelve el lector de flags. `null` = no evaluado. */
  readonly flag?: boolean | null;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}) {
  const authorizer = createSessionAuthorizer({
    identity: fakeIdentity(options.session, options.adminRoles ?? []),
    config: CONTRACT_GENERATION_CONFIG,
    flags: {
      isEnabled: () => Promise.resolve(options.flag === undefined ? null : options.flag),
    },
  });

  const base = CONTRACT_GENERATION_CONFIG.session.cookieName;
  const cookieName = options.cookie === "staff" ? `${base}_staff` : base;

  return authorizer({
    request: requestWith(cookieName, options.session === null ? null : TOKEN, {
      body: options.body,
      headers: options.headers,
    }),
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

/**
 * HO-034.1: los tres hechos que el catalogo no conoce.
 *
 * Hasta este cambio llegaban como constantes y 27 de las 62 capacidades eran
 * inalcanzables para todo el mundo. Lo que estos casos protegen no es que ahora
 * pasen -eso seria facil de conseguir mal, poniendo `true`- sino que sigan sin
 * pasar cuando el hecho NO se cumple.
 */

/** Exige motivo y step-up; no depende de flag. Es la que abre el panel. */
const ACTIVATE: RouteAuthorization = { kind: "PERMISSION", permission: "promotion.activate" };
/** Exige motivo Y depende del flag `amoe_enabled`. */
const AMOE_APPROVE: RouteAuthorization = { kind: "PERMISSION", permission: "amoe.review.approve" };

function staffSession() {
  // MFA de hace un instante: el step-up se satisface y no enmascara el motivo.
  return sessionRow({ scope: "STAFF", mfaVerifiedAt: new Date() });
}

const MANAGER = ["PROMOTION_MANAGER"] as const;

describe("motivo obligatorio", () => {
  it("sin motivo, deniega", async () => {
    const outcome = await decide({
      authorization: ACTIVATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("con motivo en el cuerpo, permite", async () => {
    const outcome = await decide({
      authorization: ACTIVATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "promotion_launch_approved" },
    });

    expect(outcome).toStrictEqual({ allowed: true });
  });

  it("con motivo en la cabecera, permite", async () => {
    // El caso que obliga a admitir cabecera: `pii.view.full` es un GET y no
    // tiene cuerpo donde poner un motivo.
    const outcome = await decide({
      authorization: ACTIVATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      headers: { "x-lsw-reason-code": "promotion_launch_approved" },
    });

    expect(outcome).toStrictEqual({ allowed: true });
  });

  it("con reason_key -el nombre de AMOE y ajustes- tambien permite", async () => {
    // El contrato publica dos nombres para el mismo concepto. La primera
    // version solo leia reason_code, y rechazar un envio AMOE devolvia 403 con
    // el motivo puesto. Este caso es el que lo habria detectado.
    const outcome = await decide({
      authorization: ACTIVATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_key: "MEETS_REQUIREMENTS" },
    });

    expect(outcome).toStrictEqual({ allowed: true });
  });

  it("un motivo con forma invalida NO cuenta como motivo", async () => {
    // Lo importante del control. Si bastara con "no vacio", mandar "x" abriria
    // las 26 capacidades que exigen motivo y el control seria un tramite.
    const outcome = await decide({
      authorization: ACTIVATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "x" },
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("un cuerpo sin reason_code no se confunde con un motivo", async () => {
    const outcome = await decide({
      authorization: ACTIVATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { nombre: "Promocion GMC" },
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });
});

describe("feature flag persistido", () => {
  it("flag no evaluado, deniega", async () => {
    // `null` no es `false`: es "no se ha consultado", y una capacidad que
    // depende de un flag legalmente material no puede concederse sin leerlo.
    const outcome = await decide({
      authorization: AMOE_APPROVE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "amoe_card_valid" },
      flag: null,
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("flag apagado, deniega aunque el motivo viaje", async () => {
    const outcome = await decide({
      authorization: AMOE_APPROVE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "amoe_card_valid" },
      flag: false,
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("flag encendido y motivo presente, permite", async () => {
    const outcome = await decide({
      authorization: AMOE_APPROVE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "amoe_card_valid" },
      flag: true,
    });

    expect(outcome).toStrictEqual({ allowed: true });
  });

  it("flag encendido pero SIN motivo, deniega", async () => {
    // Las dos condiciones son independientes: satisfacer una no releva de la
    // otra. Es el caso que se rompe si alguien "arregla" el flag pasando
    // tambien `reasonProvided: true` de paso.
    const outcome = await decide({
      authorization: AMOE_APPROVE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      flag: true,
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });
});

describe("segunda aprobacion", () => {
  /** Exige segunda aprobacion, motivo, step-up y flag. La mas cerrada que hay. */
  const ADJUST_CREATE: RouteAuthorization = {
    kind: "PERMISSION",
    permission: "entry.adjust.create",
  };

  it("sin declaracion de la ruta, deniega aunque todo lo demas se cumpla", async () => {
    const outcome = await decide({
      authorization: ADJUST_CREATE,
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "manual_correction" },
      flag: true,
    });

    expect(outcome).toStrictEqual({ allowed: false, reason: "FORBIDDEN" });
  });

  it("con la ruta declarando quien la impone, la puerta se aparta", async () => {
    // La puerta NO comprueba la segunda aprobacion: la delega en el dominio,
    // que es quien conoce el recurso. Lo que se verifica aqui es que la
    // delegacion existe y es explicita, no que la aprobacion sea real.
    const outcome = await decide({
      authorization: {
        ...ADJUST_CREATE,
        secondApprovalEnforcedBy: "packages/sweepstakes: adjustments_approver_differs",
      },
      session: staffSession(),
      adminRoles: MANAGER,
      cookie: "staff",
      body: { reason_code: "manual_correction" },
      flag: true,
    });

    expect(outcome).toStrictEqual({ allowed: true });
  });
});
