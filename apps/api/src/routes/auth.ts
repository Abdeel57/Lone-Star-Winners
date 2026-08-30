/**
 * Autenticacion (DEC-006, DEC-045).
 *
 * UN SOLO SISTEMA, DOS POLITICAS
 *   `CLAUDE.md` seccion 4 prohibe dos sistemas de autenticacion, y DEC-006 lo
 *   repite. Por eso participante y personal comparten estas rutas: lo que
 *   cambia entre ellos es la POLITICA -audiencia de la cookie, `SameSite`, TTL,
 *   timeout de inactividad y MFA-, que decide `audienceForRoles` a partir de
 *   los roles. No hay un `/admin/login`.
 *
 * EL LOGIN NO TERMINA DE AUTENTICAR AL PERSONAL
 *   Para una audiencia `STAFF`, `POST /auth/login` crea la sesion con
 *   `mfa_verified_at` a null. En ese estado `evaluateSession` la califica de
 *   `MFA_PENDING` y no sirve para nada salvo para completar el segundo factor.
 *   Es la traduccion literal de "MFA obligatorio para todo rol administrativo":
 *   no es una pantalla que se pueda saltar, es una sesion que aun no vale.
 *
 * POR QUE ESTAS RUTAS SON `PUBLIC`
 *   Porque son las que se usan ANTES de tener sesion. Que sean publicas no
 *   significa que sean laxas: el rate limiting las cubre y ninguna revela si
 *   una cuenta existe.
 *
 * NO SE DISTINGUE "NO EXISTE" DE "CONTRASENA INCORRECTA"
 *   Ambos producen el mismo error y, en la medida de lo posible, el mismo
 *   tiempo de respuesta. Si difirieran, esta ruta seria un oraculo para
 *   enumerar direcciones de correo registradas, que en un sweepstakes es una
 *   lista de participantes.
 */

import {
  audienceForRoles,
  capabilitiesForRoles,
  decodeSecretBoxKey,
  decryptSecret,
  evaluateSession,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  looksLikeSessionToken,
  needsRehash,
  requiresMfa,
  SESSION_POLICIES,
  verifyPassword,
  verifyTotp,
  type RoleId,
  type SessionAudience,
} from "@lsw/security";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  clearCookieOptionsFor,
  cookieNameFor,
  cookieOptionsFor,
  type SessionCookieConfig,
} from "../http/session-cookie.js";

/**
 * Umbral de bloqueo por intentos fallidos y duracion.
 *
 * Cinco intentos es suficientemente permisivo para quien se equivoca de verdad
 * y suficientemente estrecho para que probar contrasenas por fuerza bruta deje
 * de ser practico. El bloqueo es TEMPORAL a proposito: uno permanente convierte
 * el formulario de login en una forma de dejar fuera a cualquiera cuyo correo
 * se conozca.
 */
const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

const loginBodySchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1_024),
});

const mfaBodySchema = z.object({
  code: z.string().min(6).max(16),
});

const sessionResponseSchema = z.object({
  authenticated: z.boolean(),
  /** `MFA_PENDING` para personal que aun no ha completado el segundo factor. */
  state: z.enum(["ANONYMOUS", "ACTIVE", "MFA_PENDING"]),
  scope: z.enum(["PARTICIPANT", "STAFF"]).nullable(),
  email: z.string().nullable(),
  email_verified: z.boolean(),
  roles: z.array(z.string()),
  /**
   * Capacidades EFECTIVAS de la sesion, resueltas por el servidor con el mismo
   * catalogo que usa el autorizador (DEC-027). El panel las usaba desde un
   * espejo local de la matriz mientras esto no existia, con un aviso en
   * pantalla; publicarlas es lo que hace desaparecer ese aviso y el espejo.
   *
   * Vacias mientras la sesion no autentique (ANONYMOUS, MFA_PENDING): una
   * sesion que "todavia no vale para nada" no puede anunciar que puede.
   */
  capabilities: z.array(z.string()),
});

type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * Las capacidades que se publican, calculadas como las ve el AUTORIZADOR.
 *
 * Los roles efectivos salen del scope, no de la persona (ver
 * `session-authorizer.ts`): una sesion de escaparate lleva solo PARTICIPANT
 * aunque la persona tenga roles administrativos. Publicar aqui otra cosa haria
 * que el panel pintara enlaces que la puerta iba a denegar.
 */
function publishedCapabilities(
  state: SessionResponse["state"],
  scope: SessionAudience,
  adminRoles: readonly RoleId[],
): string[] {
  if (state !== "ACTIVE") return [];
  const roles: readonly RoleId[] = scope === "STAFF" ? adminRoles : ["PARTICIPANT"];
  return [...capabilitiesForRoles(roles)].sort();
}

const ANONYMOUS: SessionResponse = {
  authenticated: false,
  state: "ANONYMOUS",
  scope: null,
  email: null,
  email_verified: false,
  roles: [],
  capabilities: [],
};

export function buildAuthRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { identity, config } = dependencies;

  const cookieConfig: SessionCookieConfig = {
    name: config.session.cookieName,
    secure: config.session.cookieSecure,
    domain: config.session.cookieDomain,
  };

  /**
   * Lee la sesion presentada por la peticion, si la hay.
   *
   * Prueba ambas cookies -personal y participante- porque el navegador puede
   * llevar las dos. Gana la de personal: si alguien tiene sesion administrativa
   * viva, es la que describe con mas precision quien esta preguntando.
   */
  function readSession(request: {
    cookies: Record<string, string | undefined>;
  }): { token: string; audience: SessionAudience } | null {
    for (const audience of ["STAFF", "PARTICIPANT"] as const) {
      const raw = request.cookies[cookieNameFor(cookieConfig.name, audience)];

      // La forma se comprueba antes de consultar: filtra ruido sin gastar una
      // consulta, aunque no prueba nada por si sola.
      if (raw !== undefined && looksLikeSessionToken(raw)) {
        return { token: raw, audience };
      }
    }

    return null;
  }

  return [
    {
      method: "POST",
      url: "/api/v1/auth/login",
      operationId: "login",
      summary: "Iniciar sesion con correo y contrasena.",
      description:
        "Crea una sesion opaca. Para roles administrativos la sesion nace en MFA_PENDING y no sirve hasta completar el segundo factor (DEC-006).",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Es la ruta que se usa antes de tener sesion. No revela si una cuenta existe: credenciales invalidas y cuenta inexistente producen la misma respuesta.",
      },
      schema: {
        body: loginBodySchema,
        response: {
          200: sessionResponseSchema,
          401: errorEnvelopeSchema,
          423: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const body = request.body as z.infer<typeof loginBodySchema>;
        const now = new Date();

        const found = await identity.identities.findByEmail(body.email);
        const credential =
          found === null ? null : await identity.identities.findCredential(found.id);

        // Se hashea SIEMPRE, exista la cuenta o no. Sin este trabajo ficticio,
        // una cuenta inexistente responderia en microsegundos y una existente
        // en decenas de milisegundos: la diferencia es medible desde fuera y
        // convierte el login en un enumerador de correos registrados.
        if (found === null || credential === null) {
          await hashPassword("contrasena-ficticia-para-igualar-el-tiempo");
          throw ApiErrors.unauthenticated();
        }

        if (credential.lockedUntil !== null && credential.lockedUntil > now) {
          throw ApiErrors.accountLocked(
            Math.ceil((credential.lockedUntil.getTime() - now.getTime()) / 1_000),
          );
        }

        const ok = await verifyPassword(body.password, credential.passwordHash);

        await identity.identities.recordLoginAttempt({
          identityId: found.id,
          succeeded: ok,
          now,
          lockThreshold: LOCK_THRESHOLD,
          lockMinutes: LOCK_MINUTES,
        });

        if (!ok) {
          throw ApiErrors.unauthenticated();
        }

        // Subir el coste de Argon2 no invalida los hashes viejos, pero este es
        // el unico momento en que se tiene la contrasena en claro para poder
        // regenerarlos.
        if (needsRehash(credential.passwordHash)) {
          await identity.identities.updatePasswordHash(found.id, await hashPassword(body.password));
        }

        // La identidad tiene que estar viva. SUSPENDED o CLOSED no entran,
        // aunque la contrasena sea correcta.
        if (found.status !== "ACTIVE") {
          throw ApiErrors.unauthenticated();
        }

        const roles = (await identity.identities.listAdminRoles(found.id)) as readonly RoleId[];

        // Y si es personal, su cuenta administrativa tambien.
        //
        // Estado y roles son cosas distintas y se revocan en momentos
        // distintos: desactivar la cuenta de quien se va no borra sus
        // asignaciones. Sin esta comprobacion, una cuenta DEACTIVATED que
        // conserve sus roles seguiria iniciando sesion con normalidad, y el
        // panel de administracion la trataria como personal en activo.
        if (roles.length > 0) {
          const adminUser = await identity.identities.findAdminUser(found.id);

          // Aqui SI se usa encadenamiento opcional, al contrario que en la
          // comprobacion de sesion revocada de mas abajo. La diferencia esta en
          // contra que se compara: `adminUser?.status !== "ACTIVE"` con la
          // cuenta a null da `undefined !== "ACTIVE"`, es decir `true`, y
          // rechaza -que es lo correcto-. Cuando la comparacion es contra
          // `null`, el mismo patron se invierte y deja pasar. La regla es
          // segura en un caso y peligrosa en el otro.
          if (adminUser?.status !== "ACTIVE") {
            throw ApiErrors.unauthenticated();
          }
        }

        const audience = audienceForRoles(roles);
        const policy = SESSION_POLICIES[audience];

        const token = generateSessionToken();
        const expiresAt = new Date(now.getTime() + policy.absoluteTtlMinutes * 60_000);

        await identity.sessions.create({
          tokenHash: hashSessionToken(token),
          identityId: found.id,
          scope: audience,
          expiresAt,
          ipAddress: request.ip ?? null,
          userAgent: request.headers["user-agent"] ?? null,
        });

        void reply.setCookie(
          cookieNameFor(cookieConfig.name, audience),
          token,
          cookieOptionsFor(audience, cookieConfig, policy.absoluteTtlMinutes * 60),
        );

        const pending = requiresMfa(roles);
        const state = pending ? ("MFA_PENDING" as const) : ("ACTIVE" as const);

        return {
          authenticated: !pending,
          state,
          scope: audience,
          email: found.email,
          email_verified: found.emailVerifiedAt !== null,
          roles: [...roles],
          capabilities: publishedCapabilities(state, audience, roles),
        } satisfies SessionResponse;
      },
    },

    {
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      operationId: "verifyMfa",
      summary: "Completar el segundo factor de una sesion en MFA_PENDING.",
      description:
        "Consume la ventana TOTP: un codigo no vale dos veces, ni siquiera dentro de su periodo de validez.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "La sesion existe pero todavia NO autentica: esta en MFA_PENDING. Exigir sesion valida aqui seria circular, porque es esta ruta la que la vuelve valida.",
      },
      schema: {
        body: mfaBodySchema,
        response: {
          200: sessionResponseSchema,
          401: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const body = request.body as z.infer<typeof mfaBodySchema>;
        const presented = readSession(request);

        if (presented === null) {
          throw ApiErrors.unauthenticated();
        }

        const session = await identity.sessions.findByTokenHash(hashSessionToken(presented.token));

        // Sesion inexistente y sesion revocada se tratan igual y responden
        // igual: distinguirlas le diria a quien presenta un token robado si
        // alguna vez fue valido.
        //
        // Se escribe en positivo -"utilizable"- y no como
        // `session === null || session.revokedAt !== null` porque esa forma
        // dispara `prefer-optional-chain`, y la reescritura que propone la
        // regla (`session?.revokedAt != null`) NO es equivalente: con la sesion
        // a null daria `undefined != null`, es decir `false`, y dejaria pasar
        // justo el caso que hay que rechazar.
        const usable = session !== null && session.revokedAt === null;

        if (!usable) {
          throw ApiErrors.unauthenticated();
        }

        const now = new Date();

        if (session.expiresAt <= now) {
          throw ApiErrors.unauthenticated();
        }

        const factor = await identity.identities.findActiveMfaFactor(session.identityId);

        if (factor === null) {
          throw ApiErrors.unauthenticated();
        }

        const key = decodeSecretBoxKey(config.mfa.encryptionKey);
        const secret = decryptSecret(factor.secretCiphertext, key);

        const result = verifyTotp({
          code: body.code,
          secretBase32: secret,
          nowMillis: now.getTime(),
          lastUsedCounter: factor.lastUsedCounter,
        });

        if (!result.valid || result.counter === null) {
          throw ApiErrors.unauthenticated();
        }

        // El consumo es atomico en el motor. Si otra peticion gano la carrera
        // con el mismo codigo, aqui se rechaza: es lo que impide que un codigo
        // interceptado sirva dos veces dentro de su ventana.
        const consumed = await identity.identities.consumeMfaCounter(factor.id, result.counter);

        if (!consumed) {
          throw ApiErrors.unauthenticated();
        }

        await identity.sessions.markMfaVerified(session.id, now);

        const record = await identity.identities.findById(session.identityId);
        const roles = await identity.identities.listAdminRoles(session.identityId);

        return {
          authenticated: true,
          state: "ACTIVE" as const,
          scope: session.scope,
          email: record?.email ?? null,
          email_verified: record?.emailVerifiedAt != null,
          roles: [...roles],
          capabilities: publishedCapabilities("ACTIVE", session.scope, roles as readonly RoleId[]),
        } satisfies SessionResponse;
      },
    },

    {
      method: "GET",
      url: "/api/v1/auth/session",
      operationId: "getSession",
      summary: "Estado de la sesion actual.",
      description:
        "Devuelve el estado sin exigirla: sin sesion responde `ANONYMOUS` con 200, no 401. Es lo que consulta el frontend en cada render.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Responde sobre la sesion de quien pregunta y solo sobre ella. Sin cookie devuelve el estado anonimo, que no es informacion de nadie.",
      },
      schema: { response: { 200: sessionResponseSchema } },
      handler: async (request) => {
        const presented = readSession(request);

        if (presented === null) {
          return ANONYMOUS;
        }

        const session = await identity.sessions.findByTokenHash(hashSessionToken(presented.token));

        if (session === null) {
          return ANONYMOUS;
        }

        const now = new Date();
        const roles = await identity.identities.listAdminRoles(session.identityId);

        // La politica la evalua `packages/security`, no este handler: expirada,
        // inactiva, revocada o pendiente de MFA son estados con reglas que ya
        // estan probadas alli.
        const state = evaluateSession(
          {
            audience: session.scope,
            createdAt: session.createdAt.getTime(),
            lastSeenAt: session.lastSeenAt.getTime(),
            revokedAt: session.revokedAt?.getTime() ?? null,
            // `mfaSatisfied` combina las dos preguntas: si la audiencia exige
            // segundo factor y si esta sesion lo ha superado. Una sesion de
            // personal con la contrasena correcta y sin TOTP no esta a medias
            // autenticada: no pasa.
            mfaSatisfied:
              !requiresMfa(roles as readonly RoleId[]) || session.mfaVerifiedAt !== null,
          },
          now.getTime(),
        );

        if (state === "REVOKED" || state === "EXPIRED_ABSOLUTE" || state === "EXPIRED_IDLE") {
          return ANONYMOUS;
        }

        await identity.sessions.touch(session.id, now);

        const record = await identity.identities.findById(session.identityId);

        const published = state === "ACTIVE" ? ("ACTIVE" as const) : ("MFA_PENDING" as const);

        return {
          authenticated: state === "ACTIVE",
          state: published,
          scope: session.scope,
          email: record?.email ?? null,
          email_verified: record?.emailVerifiedAt != null,
          roles: [...roles],
          capabilities: publishedCapabilities(published, session.scope, roles as readonly RoleId[]),
        } satisfies SessionResponse;
      },
    },

    {
      method: "POST",
      url: "/api/v1/auth/logout",
      operationId: "logout",
      summary: "Cerrar la sesion actual.",
      description:
        "Revoca la sesion en base de datos ADEMAS de borrar la cookie. Borrar solo la cookie dejaria el token vivo para quien lo hubiera copiado.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Idempotente y solo actua sobre la sesion presentada en la propia peticion. Sin cookie no hace nada y responde igual.",
      },
      schema: { response: { 200: z.object({ ok: z.literal(true) }) } },
      handler: async (request, reply) => {
        const presented = readSession(request);

        if (presented !== null) {
          const session = await identity.sessions.findByTokenHash(
            hashSessionToken(presented.token),
          );

          if (session !== null) {
            await identity.sessions.revoke(session.id, "user_logout", new Date());
          }

          void reply.clearCookie(
            cookieNameFor(cookieConfig.name, presented.audience),
            clearCookieOptionsFor(presented.audience, cookieConfig),
          );
        }

        // Siempre 200. Un 401 al cerrar sesion no le sirve a nadie y ademas
        // revelaria si la cookie presentada era valida.
        return { ok: true as const };
      },
    },
  ];
}
