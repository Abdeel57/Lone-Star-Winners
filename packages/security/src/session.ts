/**
 * Politica de sesion, MFA, step-up y rate limiting (DEC-006).
 *
 * Este modulo es una LIBRERIA DE DECISION: no habla con la base de datos, no
 * emite cookies y no lee el reloj. Recibe hechos y devuelve un veredicto. Esa
 * restriccion no es purismo -es lo que permite que la politica de sesion sea
 * comprobable exhaustivamente en un test, incluidos los limites, en vez de solo
 * observable en produccion.
 *
 * EL RELOJ LLEGA COMO PARAMETRO, SIEMPRE
 *   No hay ninguna llamada a `Date.now()` aqui, y la regla de lint de DEC-017
 *   lo impide ademas a nivel de paquete. Una funcion que lee el reloj por su
 *   cuenta no se puede probar en el borde, y el borde es justamente donde una
 *   sesion caduca o no caduca. Los instantes viajan como milisegundos desde
 *   epoch UTC.
 *
 * DOS AUDIENCIAS, UN SOLO SISTEMA DE IDENTIDAD
 *   DEC-006 prohibe expresamente dos sistemas de autenticacion. Lo que cambia
 *   entre un participante y el personal no es el mecanismo, sino la POLITICA:
 *   scope de cookie, `SameSite`, TTL absoluto, timeout de inactividad y MFA.
 *   Modelarlo como dos politicas del mismo motor es lo que evita que "el login
 *   de admin" acabe siendo una segunda superficie de escalada de privilegios.
 *
 * TOPES DUROS
 *   Cada valor configurable tiene un maximo que la configuracion no puede
 *   superar, y se recorta en silencio hacia el lado seguro. Un `.env` mal
 *   escrito puede degradar el servicio; no debe poder ampliar una ventana de
 *   privilegio.
 */

import { ROLES, type RoleId } from "./roles.js";

/** Milisegundos desde epoch, UTC. Nunca una hora local. */
export type EpochMillis = number;

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/**
 * Audiencia de la sesion. No es el rol: es el scope de la cookie y la politica
 * que se le aplica. Una misma persona con rol de personal navega el storefront
 * con una sesion `PARTICIPANT` y el panel con una sesion `STAFF`.
 */
export type SessionAudience = "PARTICIPANT" | "STAFF";

export interface SessionCookiePolicy {
  readonly httpOnly: true;
  readonly secure: true;
  /**
   * DEC-006: `Lax` para el participante, `Strict` en el scope admin.
   * `Lax` en el storefront porque un enlace entrante desde un correo debe
   * conservar la sesion; `Strict` en el panel porque ahi no existe ningun
   * flujo legitimo de navegacion entrante desde un tercero.
   */
  readonly sameSite: "lax" | "strict";
  readonly path: string;
}

export interface SessionPolicy {
  readonly audience: SessionAudience;
  readonly cookie: SessionCookiePolicy;
  /** Vida maxima de la sesion aunque haya actividad continua. */
  readonly absoluteTtlMinutes: number;
  /** Inactividad tras la cual la sesion muere. `null` = sin timeout de inactividad. */
  readonly idleTimeoutMinutes: number | null;
  /** DEC-006: MFA/TOTP obligatorio para todo rol administrativo. */
  readonly requiresMfa: boolean;
  /**
   * Al elevar privilegios se emite un identificador de sesion nuevo. Sin esto,
   * un identificador capturado antes del login sigue siendo valido despues
   * (fijacion de sesion).
   */
  readonly rotateOnPrivilegeChange: true;
}

/**
 * Topes duros. La configuracion puede endurecer, nunca relajar.
 *
 * Los valores no salen de ninguna norma legal -no la hay para esto- sino de la
 * asimetria de consecuencias: una sesion de personal robada llega a PII, al
 * ledger y a los exports.
 */
export const SESSION_LIMITS = Object.freeze({
  PARTICIPANT: Object.freeze({
    maxAbsoluteTtlMinutes: 60 * 24 * 30,
    maxIdleTimeoutMinutes: null,
  }),
  STAFF: Object.freeze({
    maxAbsoluteTtlMinutes: 60 * 12,
    maxIdleTimeoutMinutes: 30,
  }),
} as const);

export const SESSION_POLICIES: Readonly<Record<SessionAudience, SessionPolicy>> = Object.freeze({
  PARTICIPANT: Object.freeze({
    audience: "PARTICIPANT",
    cookie: Object.freeze({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }),
    absoluteTtlMinutes: 60 * 24 * 14,
    idleTimeoutMinutes: null,
    requiresMfa: false,
    rotateOnPrivilegeChange: true,
  }),
  STAFF: Object.freeze({
    audience: "STAFF",
    cookie: Object.freeze({ httpOnly: true, secure: true, sameSite: "strict", path: "/admin" }),
    absoluteTtlMinutes: 60 * 8,
    idleTimeoutMinutes: 15,
    requiresMfa: true,
    rotateOnPrivilegeChange: true,
  }),
});

/** Audiencia que corresponde a un conjunto de roles. Un solo rol de personal basta. */
export function audienceForRoles(roles: readonly RoleId[]): SessionAudience {
  return roles.some((role) => ROLES[role].kind === "STAFF") ? "STAFF" : "PARTICIPANT";
}

/** DEC-006: MFA obligatorio en cuanto haya un rol administrativo. */
export function requiresMfa(roles: readonly RoleId[]): boolean {
  return roles.some((role) => ROLES[role].requiresMfa);
}

/**
 * Aplica los topes duros a una politica que venga de configuracion.
 *
 * Recorta, no lanza. Un proceso que se niega a arrancar por un TTL demasiado
 * generoso acaba con alguien subiendo el tope; uno que lo recorta y sigue, no.
 */
export function clampSessionPolicy(policy: SessionPolicy): SessionPolicy {
  const limits = SESSION_LIMITS[policy.audience];
  const absoluteTtlMinutes = Math.min(policy.absoluteTtlMinutes, limits.maxAbsoluteTtlMinutes);

  const maxIdle: number | null = limits.maxIdleTimeoutMinutes;
  const idleTimeoutMinutes =
    maxIdle === null
      ? policy.idleTimeoutMinutes
      : policy.idleTimeoutMinutes === null
        ? maxIdle
        : Math.min(policy.idleTimeoutMinutes, maxIdle);

  return { ...policy, absoluteTtlMinutes, idleTimeoutMinutes };
}

export type SessionState =
  "ACTIVE" | "EXPIRED_ABSOLUTE" | "EXPIRED_IDLE" | "REVOKED" | "MFA_PENDING";

export interface SessionFacts {
  readonly audience: SessionAudience;
  readonly createdAt: EpochMillis;
  readonly lastSeenAt: EpochMillis;
  /** Instante de revocacion explicita, o `null`. DEC-006: sesiones revocables. */
  readonly revokedAt: EpochMillis | null;
  /**
   * `true` cuando la sesion ya ha superado el segundo factor. Una sesion de
   * personal con la contrasena correcta y sin TOTP NO esta autenticada: esta a
   * medias, y a medias significa que no pasa.
   */
  readonly mfaSatisfied: boolean;
}

/**
 * Estado de una sesion en un instante dado.
 *
 * El orden de las comprobaciones es deliberado y es lo que hace que esto sea un
 * control: revocacion, luego caducidad absoluta, luego inactividad, y solo al
 * final MFA. Si MFA se comprobara primero, una sesion revocada con MFA
 * pendiente se reportaria como `MFA_PENDING` e invitaria a "completar" el
 * segundo factor sobre una sesion que ya no debe existir.
 */
export function evaluateSession(
  facts: SessionFacts,
  now: EpochMillis,
  policy: SessionPolicy = SESSION_POLICIES[facts.audience],
): SessionState {
  const effective = clampSessionPolicy(policy);

  if (facts.revokedAt !== null && facts.revokedAt <= now) {
    return "REVOKED";
  }

  if (now - facts.createdAt >= effective.absoluteTtlMinutes * MINUTE_MS) {
    return "EXPIRED_ABSOLUTE";
  }

  if (
    effective.idleTimeoutMinutes !== null &&
    now - facts.lastSeenAt >= effective.idleTimeoutMinutes * MINUTE_MS
  ) {
    return "EXPIRED_IDLE";
  }

  if (effective.requiresMfa && !facts.mfaSatisfied) {
    return "MFA_PENDING";
  }

  return "ACTIVE";
}

/**
 * Antiguedad del ultimo MFA, para el step-up de DEC-006.
 *
 * Devuelve `null` -que `authorize()` interpreta como "no hay MFA reciente", y
 * por tanto deniega- tambien cuando el instante es futuro. Un MFA con fecha
 * posterior a ahora significa reloj desajustado o dato manipulado, y ninguna de
 * las dos cosas debe abrir una ventana de privilegio.
 */
export function secondsSinceMfa(lastMfaAt: EpochMillis | null, now: EpochMillis): number | null {
  if (lastMfaAt === null || lastMfaAt > now) {
    return null;
  }
  return Math.floor((now - lastMfaAt) / SECOND_MS);
}

// ---------------------------------------------------------------------------
// Rate limiting
//
// El limite protege del abuso automatizado. NO es un mecanismo para racionar
// derechos: un limite sobre AMOE que sea mas estrecho que el que se aplica a la
// via de compra convertiria la via gratuita en la via peor, que es exactamente
// lo que un esquema con AMOE no debe hacer. Por eso la lista lleva un campo
// explicito y hay un test que lo comprueba.
// ---------------------------------------------------------------------------

export type RateLimitScope = "IP" | "IDENTITY" | "IP_AND_IDENTITY";

export interface RateLimitBucket {
  readonly id: string;
  readonly scope: RateLimitScope;
  readonly windowSeconds: number;
  readonly maxRequests: number;
  /**
   * `true` si el limite recae sobre la via sin compra. Estos limites existen
   * contra los bots, y su calibrado no puede dejar la via AMOE por debajo de la
   * via de compra.
   */
  readonly appliesToFreeEntryPath: boolean;
  /**
   * Que pasa si el contador no se puede leer (almacen caido).
   * `CLOSED` deniega. Es la opcion correcta para credenciales: preferimos un
   * login caido a un login sin limite. Para navegacion ordinaria seria un
   * autosabotaje, y ahi se abre.
   */
  readonly onStoreFailure: "OPEN" | "CLOSED";
  readonly notes: string;
}

export const RATE_LIMIT_BUCKETS: readonly RateLimitBucket[] = Object.freeze([
  {
    id: "auth.login",
    scope: "IP_AND_IDENTITY",
    windowSeconds: 900,
    maxRequests: 10,
    appliesToFreeEntryPath: false,
    onStoreFailure: "CLOSED",
    notes:
      "Por IP y por identidad a la vez: solo por IP no frena el relleno de credenciales distribuido, y solo por identidad permite barrer muchas cuentas desde un mismo origen.",
  },
  {
    id: "auth.mfa.verify",
    scope: "IDENTITY",
    windowSeconds: 300,
    maxRequests: 5,
    appliesToFreeEntryPath: false,
    onStoreFailure: "CLOSED",
    notes:
      "Un TOTP son seis digitos. Sin limite estricto, la fuerza bruta sobre el segundo factor es viable dentro de la ventana de validez.",
  },
  {
    id: "auth.password.reset",
    scope: "IP_AND_IDENTITY",
    windowSeconds: 3600,
    maxRequests: 5,
    appliesToFreeEntryPath: false,
    onStoreFailure: "CLOSED",
    notes:
      "La respuesta debe ser identica exista o no la cuenta; el limite evita ademas usar el flujo para enumerar correos.",
  },
  {
    id: "auth.step_up",
    scope: "IDENTITY",
    windowSeconds: 300,
    maxRequests: 5,
    appliesToFreeEntryPath: false,
    onStoreFailure: "CLOSED",
    notes: "Step-up de DEC-006. Reintentos ilimitados anularian el segundo factor.",
  },
  {
    id: "amoe.submit",
    scope: "IP_AND_IDENTITY",
    // Deliberadamente NO menor que el de `checkout.create`. Calibrar la via
    // gratuita por debajo de la via de pago convierte un control anti-bot en un
    // racionamiento de la participacion sin compra. Hay un test que lo impide.
    windowSeconds: 3600,
    maxRequests: 60,
    appliesToFreeEntryPath: true,
    onStoreFailure: "OPEN",
    notes:
      "Anti-bot, NO racionamiento de participaciones. El limite de entries lo fijan las Official Rules a traves de `entry_caps_enabled`, jamas este contador. Falla en ABIERTO a proposito: un almacen de contadores caido no puede convertirse en el motivo por el que alguien no pudo participar gratis.",
  },
  {
    id: "checkout.create",
    scope: "IDENTITY",
    windowSeconds: 3600,
    maxRequests: 60,
    appliesToFreeEntryPath: false,
    onStoreFailure: "OPEN",
    notes: "Referencia de comparacion para el calibrado de `amoe.submit`.",
  },
  {
    id: "export.download",
    scope: "IDENTITY",
    windowSeconds: 3600,
    maxRequests: 10,
    appliesToFreeEntryPath: false,
    onStoreFailure: "CLOSED",
    notes:
      "Cada descarga deja AuditEvent. Un limite bajo hace que la exfiltracion masiva tenga que ser tambien lenta y ruidosa.",
  },
  {
    id: "api.default",
    scope: "IP",
    windowSeconds: 60,
    maxRequests: 300,
    appliesToFreeEntryPath: false,
    onStoreFailure: "OPEN",
    notes: "Suelo general de la API. Se endurece por ruta, nunca se relaja.",
  },
]);

export function getRateLimitBucket(id: string): RateLimitBucket | undefined {
  return RATE_LIMIT_BUCKETS.find((bucket) => bucket.id === id);
}
