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
 *   `PERMISSION`  - exige ademas que `authorize()` conceda la capacidad con los
 *                   roles EFECTIVOS de la sesion.
 *
 * DONDE SE SEPARAN ESCAPARATE Y PANEL
 *   En `resolveSession`, al decidir los roles efectivos, y NO con un corte por
 *   scope delante de `authorize()`. Una sesion `PARTICIPANT` lleva el rol
 *   `PARTICIPANT` y nada mas, aunque la persona tenga roles administrativos;
 *   una sesion `STAFF` lleva los suyos.
 *
 *   La primera version cortaba aqui por scope, y tenia dos problemas. Uno
 *   visible: dejaba inalcanzables las siete capacidades del rol `PARTICIPANT`,
 *   y con ellas el portal entero. Otro invisible: no impedia la escalada que
 *   pretendia impedir, porque los roles seguian saliendo de la persona y no de
 *   la sesion, asi que bastaba con que una ruta de participante consultara algo
 *   para que los roles de personal viajaran con ella.
 *
 *   Con los roles derivados del scope, `authorize()` deniega por si solo
 *   cualquier capacidad de personal a una sesion de escaparate, con el catalogo
 *   en la mano y sin que este fichero opine. Una decision, un sitio.
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

  const adminRoles = (await deps.identity.identities.listAdminRoles(
    session.identityId,
  )) as RoleId[];

  /**
   * Los roles EFECTIVOS los decide el scope de la sesion, no solo quien eres.
   *
   * Una sesion `PARTICIPANT` lleva el rol `PARTICIPANT` y nada mas, aunque la
   * persona tenga roles administrativos. Una sesion `STAFF` lleva los suyos.
   *
   * POR QUE NO BASTA CON MIRAR LOS ROLES DE LA PERSONA
   *   `audienceForRoles` hace que quien tiene roles de personal reciba siempre
   *   una sesion STAFF al iniciar sesion, asi que en el camino normal esto no
   *   cambia nada. Lo que cubre es el camino que SI ocurre: alguien inicia
   *   sesion como participante y DESPUES se le conceden roles de personal. Su
   *   sesion de escaparate sigue viva, con cookie `SameSite=Lax` y scope `/`,
   *   y sin esta linea pasaria a conceder capacidades de personal sin que nadie
   *   volviera a autenticarse ni pasara por MFA.
   *
   *   `SESSION_POLICIES` declara `rotateOnPrivilegeChange: true` para ese caso,
   *   pero esa rotacion NO esta implementada todavia (comprobado: la propiedad
   *   no se lee en ningun sitio). Hasta que lo este, esto es lo unico que
   *   separa las dos audiencias, y aun despues seguira siendo la defensa que no
   *   depende de que la rotacion funcione.
   *
   * El rol `PARTICIPANT` concede exactamente sus siete capacidades propias
   * (`entry.self.read`, `order.self.read`, `amoe.self.submit`...), que es lo
   * que el portal del participante necesita.
   */
  const roles: readonly RoleId[] = session.scope === "STAFF" ? adminRoles : ["PARTICIPANT"];

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

    /**
     * A partir de aqui, `PERMISSION`. NO hay corte por scope.
     *
     * Lo hubo, y estaba mal: cortaba toda sesion que no fuera STAFF antes de
     * preguntar nada, y con eso dejaba inalcanzables las siete capacidades del
     * rol `PARTICIPANT` -y con ellas el portal entero, que es contrato
     * publicado en las secciones 6 y 11.2-. Lo detecto la sesion paralela al
     * integrar sus rutas.
     *
     * El corte sobra porque la separacion ya esta hecha aguas arriba: los roles
     * efectivos salen del scope de la sesion (ver `resolveSession`), asi que
     * una sesion de escaparate llega aqui con `["PARTICIPANT"]` y `authorize()`
     * le deniega cualquier capacidad de personal por si misma, con el catalogo
     * en la mano.
     *
     * Es mejor asi: la decision la toma el catalogo una sola vez, en vez de
     * tomarla dos veces -aqui por scope y alli por capacidad- con el riesgo de
     * que un dia digan cosas distintas.
     */
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
