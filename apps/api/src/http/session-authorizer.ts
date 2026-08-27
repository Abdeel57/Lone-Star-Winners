/**
 * El autorizador de verdad (DEC-006, DEC-015, DEC-045).
 *
 * Sustituye a `denyAllAuthorizer`, que denegaba todo lo no publico porque la
 * identidad no existia. Ahora existe.
 *
 * QUE DECIDE AQUI Y QUE NO
 *   Aqui se resuelve QUIEN pregunta -leyendo la cookie, la fila de `sessions` y
 *   los roles- y se delega el "puede pasar?" en `authorize()` de
 *   `packages/security`, que ya conoce el catalogo, la separacion de funciones,
 *   el step-up y las dependencias de flag. No se reimplementa ni una de esas
 *   reglas: duplicarlas seria crear una segunda fuente de verdad sobre quien
 *   puede hacer que, que es justo lo que DEC-027 evita.
 *
 * TRES PUERTAS, NO UNA
 *   `PUBLIC`      - pasa siempre. La justificacion esta en la ruta.
 *   `PARTICIPANT` - exige sesion ACTIVA. Una sesion de personal con el segundo
 *                   factor pendiente NO sirve: no esta autenticada.
 *   `PERMISSION`  - exige ademas sesion de audiencia STAFF y que `authorize()`
 *                   conceda la capacidad.
 *
 * POR QUE UNA SESION `PARTICIPANT` NO ABRE UNA RUTA DE PERMISO
 *   Aunque la persona tuviera roles administrativos. El scope se fija al emitir
 *   la sesion y no se promociona: si alguien inicio sesion en el escaparate,
 *   esa sesion vale para el escaparate. Sin esto, la cookie `SameSite=Lax` del
 *   storefront podria usarse para operar el panel, y toda la politica reforzada
 *   de la sesion de personal -`Strict`, scope `/admin`, TTL corto, inactividad-
 *   dejaria de significar nada.
 */

import {
  authorize,
  evaluateSession,
  hashSessionToken,
  looksLikeSessionToken,
  requiresMfa,
  secondsSinceMfa,
  type RoleId,
  type SessionAudience,
} from "@lsw/security";
import type { FastifyRequest } from "fastify";

import type { ApiConfig } from "../config/env.js";
import type { IdentityRepositories } from "../services/identity-ports.js";

import { cookieNameFor } from "./session-cookie.js";
import type { AuthorizationOutcome, Authorizer } from "./route-registry.js";

/** Sesion ya resuelta y verificada como utilizable. */
export interface ResolvedSession {
  readonly sessionId: string;
  readonly identityId: string;
  readonly scope: SessionAudience;
  readonly roles: readonly RoleId[];
  readonly secondsSinceLastMfa: number | null;
}

export interface SessionAuthorizerDeps {
  readonly identity: IdentityRepositories;
  readonly config: ApiConfig;
}

function presentedToken(
  request: FastifyRequest,
  cookieBase: string,
): { token: string; audience: SessionAudience } | null {
  for (const audience of ["STAFF", "PARTICIPANT"] as const) {
    const cookies = request.cookies as Record<string, string | undefined>;
    const raw = cookies[cookieNameFor(cookieBase, audience)];

    if (raw !== undefined && looksLikeSessionToken(raw)) {
      return { token: raw, audience };
    }
  }

  return null;
}

/**
 * Resuelve la sesion de una peticion, o `null`.
 *
 * Devuelve `null` tanto si no hay cookie como si la sesion esta caducada,
 * revocada o pendiente de MFA. Desde fuera esos casos son indistinguibles a
 * proposito: quien presenta un token que ya no vale no tiene por que saber
 * cual de las tres cosas le paso.
 */
export async function resolveSession(
  request: FastifyRequest,
  deps: SessionAuthorizerDeps,
): Promise<ResolvedSession | null> {
  const presented = presentedToken(request, deps.config.session.cookieName);

  if (presented === null) {
    return null;
  }

  const session = await deps.identity.sessions.findByTokenHash(hashSessionToken(presented.token));

  if (session === null) {
    return null;
  }

  const roles = (await deps.identity.identities.listAdminRoles(session.identityId)) as RoleId[];
  const now = Date.now();

  // La politica la evalua `packages/security`. Aqui solo se traducen fechas.
  const state = evaluateSession(
    {
      audience: session.scope,
      createdAt: session.createdAt.getTime(),
      lastSeenAt: session.lastSeenAt.getTime(),
      revokedAt: session.revokedAt?.getTime() ?? null,
      mfaSatisfied: !requiresMfa(roles) || session.mfaVerifiedAt !== null,
    },
    now,
  );

  if (state !== "ACTIVE") {
    return null;
  }

  return {
    sessionId: session.id,
    identityId: session.identityId,
    scope: session.scope,
    roles,
    secondsSinceLastMfa: secondsSinceMfa(session.mfaVerifiedAt?.getTime() ?? null, now),
  };
}

export function createSessionAuthorizer(deps: SessionAuthorizerDeps): Authorizer {
  return async function sessionAuthorizer({
    request,
    authorization,
  }): Promise<AuthorizationOutcome> {
    if (authorization.kind === "PUBLIC") {
      return { allowed: true };
    }

    const session = await resolveSession(request, deps);

    if (session === null) {
      return { allowed: false, reason: "UNAUTHENTICATED" };
    }

    if (authorization.kind === "PARTICIPANT") {
      return { allowed: true };
    }

    // A partir de aqui, `PERMISSION`.
    if (session.scope !== "STAFF") {
      // No es UNAUTHENTICATED: la sesion es valida, simplemente no es del
      // alcance que esta ruta exige. Devolverlo como 401 mandaria al frontend a
      // pedir credenciales que ya tiene.
      return { allowed: false, reason: "FORBIDDEN" };
    }

    const decision = authorize({
      roles: session.roles,
      capability: authorization.permission,
      secondsSinceLastMfa: session.secondsSinceLastMfa,
      stepUpMaxAgeSeconds: deps.config.session.stepUpMaxAgeSeconds,
      // Las tres de abajo son `false`/`null` a proposito en esta fase.
      //
      // `reasonProvided` y `secondApprovalGranted` los aporta el flujo concreto
      // -un ajuste manual con motivo escrito, una segunda aprobacion viva- y
      // ninguna ruta de las que existen hoy los produce. Declararlos `true`
      // "para que funcionen" convertiria dos controles en decoracion.
      //
      // `featureFlagEnabled: null` significa "no consultado", y `authorize()`
      // DENIEGA en ese caso. Es lo correcto: una capacidad que depende de un
      // flag legalmente material no puede concederse sin haberlo leido. Las
      // rutas que dependan de flag tendran que resolverlo antes; hasta
      // entonces, fallan cerradas.
      reasonProvided: false,
      secondApprovalGranted: false,
      featureFlagEnabled: null,
    });

    if (decision.allowed) {
      return { allowed: true };
    }

    request.log.warn(
      {
        event: "authorization.denied",
        capability: decision.capability,
        reason: decision.reason,
      },
      "autorizacion denegada",
    );

    // El motivo se traduce a la forma que entiende el registro de rutas. Se
    // registra el detalle en el log del servidor y NO se devuelve al cliente:
    // "acumulas dos capacidades incompatibles" es un mapa del sistema.
    return {
      allowed: false,
      reason: decision.reason === "STEP_UP_REQUIRED" ? "STEP_UP_REQUIRED" : "FORBIDDEN",
    };
  };
}
