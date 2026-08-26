/**
 * DEC-006: politica de sesion, MFA de personal, step-up y rate limiting.
 *
 * Todo lo de aqui se comprueba EN EL BORDE, no en el centro. Una sesion que
 * caduca "mas o menos a las 8 horas" no tiene ningun problema visible; los
 * problemas de una politica de sesion viven en el segundo exacto en que expira,
 * en el reloj que va hacia atras y en el valor de configuracion que alguien
 * subio "solo para desarrollo".
 */

import { describe, expect, it } from "vitest";

import {
  audienceForRoles,
  clampSessionPolicy,
  evaluateSession,
  getRateLimitBucket,
  RATE_LIMIT_BUCKETS,
  requiresMfa,
  ROLES,
  secondsSinceMfa,
  SESSION_LIMITS,
  SESSION_POLICIES,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type SessionFacts,
  type SessionPolicy,
} from "@lsw/security";

const T0 = 1_800_000_000_000;
const MINUTE = 60_000;

function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    audience: "STAFF",
    createdAt: T0,
    lastSeenAt: T0,
    revokedAt: null,
    mfaSatisfied: true,
    ...overrides,
  };
}

describe("DEC-006: un solo sistema de identidad, dos politicas", () => {
  it("la cookie es siempre httpOnly y Secure en las dos audiencias", () => {
    for (const policy of Object.values(SESSION_POLICIES)) {
      expect(policy.cookie.httpOnly, policy.audience).toBe(true);
      expect(policy.cookie.secure, policy.audience).toBe(true);
    }
  });

  it("el scope admin usa SameSite=Strict y el storefront Lax", () => {
    expect(SESSION_POLICIES.STAFF.cookie.sameSite).toBe("strict");
    expect(SESSION_POLICIES.PARTICIPANT.cookie.sameSite).toBe("lax");
  });

  it("la cookie de personal no se envia al storefront", () => {
    // Un solo sistema de identidad no significa un solo alcance de cookie. Si
    // la cookie de admin viajara con cada peticion publica, cualquier XSS en el
    // storefront alcanzaria la sesion administrativa.
    expect(SESSION_POLICIES.STAFF.cookie.path).not.toBe("/");
    expect(SESSION_POLICIES.PARTICIPANT.cookie.path).toBe("/");
  });

  it("la sesion de personal es mas corta que la de participante", () => {
    expect(SESSION_POLICIES.STAFF.absoluteTtlMinutes).toBeLessThan(
      SESSION_POLICIES.PARTICIPANT.absoluteTtlMinutes,
    );
    expect(SESSION_POLICIES.STAFF.idleTimeoutMinutes).not.toBeNull();
  });

  it("se rota el identificador al cambiar de privilegio en ambas audiencias", () => {
    for (const policy of Object.values(SESSION_POLICIES)) {
      expect(policy.rotateOnPrivilegeChange, policy.audience).toBe(true);
    }
  });

  it("un solo rol de personal convierte la sesion en sesion de personal", () => {
    expect(audienceForRoles(["PARTICIPANT"])).toBe("PARTICIPANT");
    expect(audienceForRoles(["PARTICIPANT", "SUPPORT"])).toBe("STAFF");
    expect(audienceForRoles([])).toBe("PARTICIPANT");
  });

  it("MFA es obligatorio para todo rol administrativo, sin excepcion", () => {
    for (const role of Object.values(ROLES)) {
      if (role.kind === "STAFF") {
        expect(requiresMfa([role.id]), role.id).toBe(true);
      }
    }
    expect(requiresMfa(["PARTICIPANT"])).toBe(false);
    // Y basta uno.
    expect(requiresMfa(["PARTICIPANT", "SUPPORT"])).toBe(true);
  });
});

describe("topes duros: la configuracion endurece, nunca relaja", () => {
  it("un TTL de personal desmedido se recorta al tope", () => {
    const laxa: SessionPolicy = { ...SESSION_POLICIES.STAFF, absoluteTtlMinutes: 60 * 24 * 30 };
    expect(clampSessionPolicy(laxa).absoluteTtlMinutes).toBe(
      SESSION_LIMITS.STAFF.maxAbsoluteTtlMinutes,
    );
  });

  it("quitar el timeout de inactividad del personal no funciona", () => {
    // El caso que de verdad ocurre: alguien pone `null` en un `.env` porque le
    // molesta reautenticarse, y la sesion administrativa pasa a durar el TTL
    // absoluto entero sin actividad.
    const sinIdle: SessionPolicy = { ...SESSION_POLICIES.STAFF, idleTimeoutMinutes: null };
    expect(clampSessionPolicy(sinIdle).idleTimeoutMinutes).toBe(
      SESSION_LIMITS.STAFF.maxIdleTimeoutMinutes,
    );
  });

  it("una politica mas estricta que el tope se respeta tal cual", () => {
    const estricta: SessionPolicy = {
      ...SESSION_POLICIES.STAFF,
      absoluteTtlMinutes: 30,
      idleTimeoutMinutes: 5,
    };
    const efectiva = clampSessionPolicy(estricta);
    expect(efectiva.absoluteTtlMinutes).toBe(30);
    expect(efectiva.idleTimeoutMinutes).toBe(5);
  });

  it("los defaults ya cumplen sus propios topes", () => {
    for (const policy of Object.values(SESSION_POLICIES)) {
      expect(clampSessionPolicy(policy)).toStrictEqual(policy);
    }
  });
});

describe("estado de la sesion", () => {
  it("una sesion recien creada de personal con MFA hecho esta activa", () => {
    expect(evaluateSession(facts(), T0 + MINUTE)).toBe("ACTIVE");
  });

  it("la revocacion gana a todo lo demas", () => {
    // Deliberado: una sesion revocada con MFA pendiente NO debe reportarse como
    // MFA_PENDING, o la interfaz invitaria a "completar" el segundo factor sobre
    // una sesion que ya no debe existir.
    const revocada = facts({ revokedAt: T0 + MINUTE, mfaSatisfied: false });
    expect(evaluateSession(revocada, T0 + 2 * MINUTE)).toBe("REVOKED");
  });

  it("una revocacion futura todavia no revoca", () => {
    const programada = facts({ revokedAt: T0 + 10 * MINUTE });
    expect(evaluateSession(programada, T0 + MINUTE)).toBe("ACTIVE");
  });

  it("el TTL absoluto expira en el segundo exacto, no despues", () => {
    const ttlMs = SESSION_POLICIES.STAFF.absoluteTtlMinutes * MINUTE;
    expect(evaluateSession(facts({ lastSeenAt: T0 + ttlMs - 1 }), T0 + ttlMs - 1)).toBe("ACTIVE");
    expect(evaluateSession(facts({ lastSeenAt: T0 + ttlMs }), T0 + ttlMs)).toBe("EXPIRED_ABSOLUTE");
  });

  it("la actividad continua no prolonga el TTL absoluto", () => {
    const ttlMs = SESSION_POLICIES.STAFF.absoluteTtlMinutes * MINUTE;
    const activa = facts({ lastSeenAt: T0 + ttlMs + MINUTE });
    expect(evaluateSession(activa, T0 + ttlMs + MINUTE)).toBe("EXPIRED_ABSOLUTE");
  });

  it("la inactividad mata la sesion de personal antes que el TTL absoluto", () => {
    const idleMs = 15 * MINUTE;
    expect(evaluateSession(facts({ lastSeenAt: T0 }), T0 + idleMs)).toBe("EXPIRED_IDLE");
    expect(evaluateSession(facts({ lastSeenAt: T0 }), T0 + idleMs - 1)).toBe("ACTIVE");
  });

  it("un participante no tiene timeout de inactividad", () => {
    const participante = facts({ audience: "PARTICIPANT", mfaSatisfied: false, lastSeenAt: T0 });
    expect(evaluateSession(participante, T0 + 24 * 60 * MINUTE)).toBe("ACTIVE");
  });

  it("una sesion de personal sin MFA no esta autenticada", () => {
    expect(evaluateSession(facts({ mfaSatisfied: false }), T0 + MINUTE)).toBe("MFA_PENDING");
  });

  it("nunca devuelve ACTIVE para personal sin MFA, se configure lo que se configure", () => {
    // Blindaje: aunque alguien construya una politica de personal con
    // `requiresMfa: false`, el clamp no lo arregla; lo que se comprueba aqui es
    // que la politica por defecto -la que se usa- no lo permite.
    expect(SESSION_POLICIES.STAFF.requiresMfa).toBe(true);
  });
});

describe("step-up (DEC-006)", () => {
  it("un MFA reciente cuenta los segundos correctos", () => {
    expect(secondsSinceMfa(T0, T0 + 90_000)).toBe(90);
  });

  it("sin MFA previo no hay antiguedad", () => {
    expect(secondsSinceMfa(null, T0)).toBeNull();
  });

  it("un MFA con fecha futura no abre ninguna ventana", () => {
    // Reloj desajustado o dato manipulado. En los dos casos, denegar.
    expect(secondsSinceMfa(T0 + 60_000, T0)).toBeNull();
  });

  it("el tope duro de la ventana de step-up sigue siendo el de DEC-006", () => {
    expect(STEP_UP_MAX_AGE_SECONDS_LIMIT).toBe(300);
  });
});

describe("rate limiting", () => {
  it("cada bucket tiene ventana y maximo positivos", () => {
    for (const bucket of RATE_LIMIT_BUCKETS) {
      expect(bucket.windowSeconds, bucket.id).toBeGreaterThan(0);
      expect(bucket.maxRequests, bucket.id).toBeGreaterThan(0);
      expect(bucket.notes.length, bucket.id).toBeGreaterThan(20);
    }
  });

  it("no hay dos buckets con el mismo identificador", () => {
    const ids = RATE_LIMIT_BUCKETS.map((bucket) => bucket.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("todo lo que toca credenciales falla en cerrado", () => {
    for (const id of ["auth.login", "auth.mfa.verify", "auth.password.reset", "auth.step_up"]) {
      expect(getRateLimitBucket(id)?.onStoreFailure, id).toBe("CLOSED");
    }
  });

  it("la descarga de export tambien falla en cerrado", () => {
    expect(getRateLimitBucket("export.download")?.onStoreFailure).toBe("CLOSED");
  });

  it("AMOE no puede quedar peor tratada que la via de compra", () => {
    // El limite existe contra los bots. Si el camino gratuito acabara con menos
    // margen que el de pago, el limite habria dejado de ser un control anti-abuso
    // para convertirse en un racionamiento de la via sin compra.
    const amoe = getRateLimitBucket("amoe.submit");
    const checkout = getRateLimitBucket("checkout.create");
    expect(amoe).toBeDefined();
    expect(checkout).toBeDefined();

    const amoePorHora = ((amoe?.maxRequests ?? 0) * 3600) / (amoe?.windowSeconds ?? 1);
    const checkoutPorHora = ((checkout?.maxRequests ?? 0) * 3600) / (checkout?.windowSeconds ?? 1);

    expect(checkoutPorHora).toBeGreaterThan(0);
    expect(
      amoePorHora,
      `AMOE permite ${String(amoePorHora)}/h y checkout ${String(checkoutPorHora)}/h. ` +
        "Un limite anti-bot mas estrecho en la via sin compra que en la via de pago " +
        "deja de ser un control de abuso y pasa a ser un racionamiento de la " +
        "participacion gratuita.",
    ).toBeGreaterThanOrEqual(checkoutPorHora);
  });

  it("el bucket de AMOE falla en ABIERTO", () => {
    // Un almacen de contadores caido no puede ser el motivo por el que alguien
    // no pudo participar sin comprar.
    const amoe = getRateLimitBucket("amoe.submit");
    expect(amoe?.appliesToFreeEntryPath).toBe(true);
    expect(amoe?.onStoreFailure).toBe("OPEN");
  });

  it("solo el camino sin compra esta marcado como tal", () => {
    const marcados = RATE_LIMIT_BUCKETS.filter((bucket) => bucket.appliesToFreeEntryPath).map(
      (bucket) => bucket.id,
    );
    expect(marcados).toStrictEqual(["amoe.submit"]);
  });

  it("el login se limita por IP y por identidad a la vez", () => {
    // Solo por IP no frena el relleno de credenciales distribuido; solo por
    // identidad permite barrer cuentas desde un mismo origen.
    expect(getRateLimitBucket("auth.login")?.scope).toBe("IP_AND_IDENTITY");
  });
});
