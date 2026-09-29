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
 *   una cuenta existe, con UNA excepcion declarada: el alta responde 409 ante
 *   un correo ya registrado (ver `ApiErrors.emailAlreadyRegistered`).
 *
 * NO SE DISTINGUE "NO EXISTE" DE "CONTRASENA INCORRECTA"
 *   Ambos producen el mismo error y, en la medida de lo posible, el mismo
 *   tiempo de respuesta. Si difirieran, esta ruta seria un oraculo para
 *   enumerar direcciones de correo registradas, que en un sweepstakes es una
 *   lista de participantes.
 */

import {
  assertPasswordAcceptable,
  audienceForRoles,
  capabilitiesForRoles,
  decodeSecretBoxKey,
  decryptSecret,
  evaluateSession,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  looksLikeSessionToken,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  needsRehash,
  PasswordPolicyError,
  requiresMfa,
  SESSION_POLICIES,
  verifyPassword,
  verifyTotp,
  type RoleId,
  type SessionAudience,
} from "@lsw/security";
import type { FastifyReply, FastifyRequest } from "fastify";
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
import { maskEmail } from "../services/email.js";
import {
  emailLocaleFrom,
  renderPasswordResetEmail,
  renderVerificationEmail,
  webLink,
  type EmailLocale,
} from "../services/email-templates.js";
import type { EmailTokenPurpose } from "../services/identity-ports.js";

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

const registerBodySchema = z.object({
  /**
   * La misma forma y el mismo tope que las CHECK de `identities`
   * (`identities_email_shape`, `identities_email_length`). Se repiten aqui
   * porque un correo que solo rechazara el motor saldria como 500, y a quien se
   * equivoca tecleando le corresponde un 422.
   */
  email: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u),
  /**
   * Solo el tope, para acotar el trabajo de Argon2. La politica -longitud
   * minima- la decide `assertPasswordAcceptable` en el handler, con su propio
   * codigo de error.
   */
  password: z.string().min(1).max(MAXIMUM_PASSWORD_LENGTH),
  /** Mismos limites que `participants_display_name_length`. */
  display_name: z.string().trim().min(1).max(120).nullable().optional(),
  /** Etiqueta BCP-47 completa (DEC-029). Sin default: DEC-021 no admite uno. */
  language_preference: z.enum(["en-US", "es-US"]),
  /**
   * VACIO O NADA, y no es un descuido.
   *
   * `GET /config` no publica `required_consents` y no existe tabla donde
   * guardar una aceptacion: que consentimientos hay que recoger es decision del
   * abogado del cliente y sigue pendiente. Aceptar aqui una lista y tirarla
   * seria perder en silencio una aceptacion legal; rechazarla obliga a que el
   * dia que se publiquen, la persistencia exista antes.
   */
  consents: z
    .array(z.object({ key: z.string().min(1).max(100), version: z.string().min(1).max(100) }))
    .max(0)
    .default([]),
});

const mfaBodySchema = z.object({
  code: z.string().min(6).max(16),
});

/**
 * Enlaces de correo (DEC-058).
 *
 * La verificacion dura 48 horas porque nadie tiene prisa por confirmar su
 * correo y un enlace que caduca antes de que la persona abra el mensaje solo
 * genera reenvios. El restablecimiento dura una hora: es una credencial que da
 * acceso a la cuenta entera, y cuanto menos viva, menos sirve si se filtra.
 */
const VERIFICATION_TTL_MINUTES = 48 * 60;
const RESET_TTL_MINUTES = 60;

/**
 * Tope de enlaces por identidad y proposito en la ventana.
 *
 * Vive en la base de datos y no en el rate limiting por IP porque la API ve la
 * IP del servidor de `apps/web`, no la del visitante (DEC-057): un limite por
 * IP frenaria a todo el publico a la vez. Este frena lo que importa: que
 * alguien use el formulario para inundar el buzon de otra persona o para
 * gastar la cuota del proveedor.
 */
const EMAIL_THROTTLE_WINDOW_MINUTES = 15;
const EMAIL_THROTTLE_MAX = 3;

/**
 * El token es opaco, pero tiene forma: 43 caracteres base64url, la misma que
 * el de sesion porque sale del mismo generador. Lo que no la tiene se rechaza
 * sin consultar la base de datos.
 */
const linkTokenSchema = z.string().min(1).max(256);

const verifyEmailBodySchema = z.object({ token: linkTokenSchema });

const forgotPasswordBodySchema = z.object({
  email: z.string().trim().min(3).max(320),
});

const resetPasswordBodySchema = z.object({
  token: linkTokenSchema,
  /** Solo el tope; la politica la decide `assertPasswordAcceptable`. */
  password: z.string().min(1).max(MAXIMUM_PASSWORD_LENGTH),
});

const acknowledgedResponseSchema = z.object({ acknowledged: z.literal(true) });

const ACKNOWLEDGED = { acknowledged: true as const };

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
  const { identity, config, email } = dependencies;

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

  /**
   * Abre una sesion y emite su cookie.
   *
   * Lo comparten el login y el alta para que las dos entradas no puedan
   * divergir en TTL, scope o atributos de cookie: son la misma operacion con
   * distinta forma de llegar a ella.
   */
  async function openSession(
    request: FastifyRequest,
    reply: FastifyReply,
    identityId: string,
    audience: SessionAudience,
    now: Date,
  ): Promise<void> {
    const policy = SESSION_POLICIES[audience];
    const token = generateSessionToken();

    await identity.sessions.create({
      tokenHash: hashSessionToken(token),
      identityId,
      scope: audience,
      expiresAt: new Date(now.getTime() + policy.absoluteTtlMinutes * 60_000),
      ipAddress: request.ip ?? null,
      userAgent: request.headers["user-agent"] ?? null,
    });

    void reply.setCookie(
      cookieNameFor(cookieConfig.name, audience),
      token,
      cookieOptionsFor(audience, cookieConfig, policy.absoluteTtlMinutes * 60),
    );
  }

  /**
   * Emite un enlace de un solo uso y lo envia por correo (DEC-058).
   *
   * Devuelve `THROTTLED` sin emitir nada si la identidad ya recibio
   * `EMAIL_THROTTLE_MAX` enlaces de ese proposito en la ventana. Quien llama
   * responde lo mismo en los dos casos: el tope protege el buzon de la
   * persona, no es informacion para quien pregunta.
   *
   * Lanza si el proveedor rechaza el envio. El enlace ya emitido queda en la
   * tabla sin usar y caduca solo.
   */
  async function deliverLink(input: {
    readonly identityId: string;
    readonly address: string;
    readonly purpose: EmailTokenPurpose;
    readonly locale: EmailLocale;
    readonly now: Date;
  }): Promise<"SENT" | "THROTTLED"> {
    const since = new Date(input.now.getTime() - EMAIL_THROTTLE_WINDOW_MINUTES * 60_000);
    const recent = await identity.emailTokens.countIssuedSince(
      input.identityId,
      input.purpose,
      since,
    );

    if (recent >= EMAIL_THROTTLE_MAX) {
      return "THROTTLED";
    }

    const verification = input.purpose === "EMAIL_VERIFICATION";
    const linkToken = generateSessionToken();
    const ttlMinutes = verification ? VERIFICATION_TTL_MINUTES : RESET_TTL_MINUTES;

    await identity.emailTokens.issue({
      identityId: input.identityId,
      purpose: input.purpose,
      tokenHash: hashSessionToken(linkToken),
      email: input.address,
      expiresAt: new Date(input.now.getTime() + ttlMinutes * 60_000),
    });

    const link = webLink(
      config.web.publicUrl,
      input.locale,
      verification ? "/account/verify-email" : "/account/reset-password",
      linkToken,
    );

    const rendered = verification
      ? renderVerificationEmail(input.locale, link)
      : renderPasswordResetEmail(input.locale, link);

    await email.send({
      to: input.address,
      ...rendered,
      kind: verification ? "email_verification" : "password_reset",
    });

    return "SENT";
  }

  /**
   * Ejecuta un envio SIN que la respuesta lo espere.
   *
   * Dos motivos. En el alta, un proveedor lento no puede retener la creacion
   * de la cuenta. En "olvide mi contrasena", el tiempo de respuesta no puede
   * depender de si el correo existe: si solo las cuentas reales esperaran al
   * proveedor, cronometrar la respuesta diria quien tiene cuenta.
   *
   * Un fallo se registra -sin la direccion completa ni el enlace- y no se
   * propaga: ya no hay respuesta a la que propagarlo.
   */
  function inBackground(
    request: FastifyRequest,
    event: string,
    task: () => Promise<unknown>,
  ): void {
    void task().catch((error: unknown) => {
      request.log.error({ event, err: error }, "envio de correo fallido");
    });
  }

  return [
    {
      method: "POST",
      url: "/api/v1/auth/register",
      operationId: "register",
      summary: "Alta de participante con correo y contrasena.",
      description:
        "Crea identidad, credencial Argon2id y perfil de participante en una transaccion, y abre sesion de escaparate en el acto. El correo nace SIN verificar (`email_verified: false`). Nunca crea personal: los roles administrativos no se conceden por aqui.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Es la ruta con la que se obtiene una cuenta, asi que no puede exigir una. Solo crea participantes -sin roles ni capacidades de personal- y el rate limiting la cubre. Revela si un correo ya esta registrado (409): ver `ApiErrors.emailAlreadyRegistered`.",
      },
      schema: {
        body: registerBodySchema,
        response: {
          201: sessionResponseSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const body = request.body as z.infer<typeof registerBodySchema>;
        const now = new Date();

        try {
          assertPasswordAcceptable(body.password);
        } catch (error) {
          if (error instanceof PasswordPolicyError) {
            throw ApiErrors.weakPassword({
              reason: error.reason,
              minimum_length: MINIMUM_PASSWORD_LENGTH,
              maximum_length: MAXIMUM_PASSWORD_LENGTH,
            });
          }
          throw error;
        }

        // Se hashea ANTES de saber si el correo esta libre. El 409 de abajo ya
        // dice que existe, asi que el tiempo no esconde nada; el orden esta
        // para que la transaccion del alta no tenga dentro decenas de
        // milisegundos de Argon2 con una conexion del pool cogida.
        const passwordHash = await hashPassword(body.password);

        const created = await identity.identities.registerParticipant({
          email: body.email,
          passwordHash,
          displayName: body.display_name ?? null,
          preferredLocale: body.language_preference,
        });

        if (created === null) {
          throw ApiErrors.emailAlreadyRegistered();
        }

        // Siempre `PARTICIPANT`, sin pasar por `audienceForRoles`: una
        // identidad recien creada no tiene roles, y si algun dia los tuviera
        // no seria por esta ruta.
        await openSession(request, reply, created.id, "PARTICIPANT", now);

        // DEC-058: el enlace de verificacion sale en segundo plano. La cuenta
        // ya existe y la sesion ya esta abierta; si el proveedor falla, la
        // persona puede pedir otro desde su cuenta.
        const address = created.email;
        if (address !== null) {
          inBackground(request, "email.verification.failed", () =>
            deliverLink({
              identityId: created.id,
              address,
              purpose: "EMAIL_VERIFICATION",
              locale: body.language_preference,
              now,
            }),
          );
        }

        void reply.code(201);

        return {
          authenticated: true,
          state: "ACTIVE" as const,
          scope: "PARTICIPANT" as const,
          email: created.email,
          email_verified: created.emailVerifiedAt !== null,
          roles: [],
          capabilities: publishedCapabilities("ACTIVE", "PARTICIPANT", []),
        } satisfies SessionResponse;
      },
    },

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
        await openSession(request, reply, found.id, audience, now);

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

    // -----------------------------------------------------------------------
    // DEC-058: verificacion de correo y restablecimiento de contrasena.
    // -----------------------------------------------------------------------

    {
      method: "POST",
      url: "/api/v1/auth/verify-email",
      operationId: "verifyEmail",
      summary: "Verificar el correo con el token del enlace.",
      description:
        "Gasta el enlace de un solo uso y fija `email_verified_at` si la identidad sigue teniendo la direccion a la que se envio. No exige sesion: el enlace puede abrirse en otro dispositivo. Idempotente sobre el resultado: un correo ya verificado conserva su instante original.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "El token del enlace ES la prueba: solo lo tiene quien recibe el correo. Exigir sesion impediria verificar desde el telefono un alta hecha en el ordenador. El token es de 256 bits, de un solo uso y caduca a las 48 horas.",
      },
      schema: {
        body: verifyEmailBodySchema,
        response: {
          200: acknowledgedResponseSchema,
          410: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const body = request.body as z.infer<typeof verifyEmailBodySchema>;
        const now = new Date();

        if (!looksLikeSessionToken(body.token)) {
          throw ApiErrors.verificationTokenInvalid();
        }

        const result = await identity.emailTokens.consume(
          hashSessionToken(body.token),
          "EMAIL_VERIFICATION",
          now,
        );

        if (result.status === "EXPIRED") throw ApiErrors.verificationTokenExpired();
        if (result.status === "INVALID") throw ApiErrors.verificationTokenInvalid();

        const verified = await identity.identities.markEmailVerified(
          result.identityId,
          result.email,
          now,
        );

        // La identidad ya no tiene esa direccion: el enlace era para otra.
        if (!verified) throw ApiErrors.verificationTokenInvalid();

        return ACKNOWLEDGED;
      },
    },

    {
      method: "POST",
      url: "/api/v1/auth/verify-email/resend",
      operationId: "resendEmailVerification",
      summary: "Reenviar el enlace de verificacion al correo de la sesion.",
      description:
        "Envia un enlace nuevo a la direccion de la cuenta que presenta la sesion; nunca a otra. Si el correo ya esta verificado, o si se alcanzo el tope de envios de la ventana, responde igual sin enviar.",
      tags: ["auth"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        response: {
          200: acknowledgedResponseSchema,
          401: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const presented = readSession(request);
        const session =
          presented === null
            ? null
            : await identity.sessions.findByTokenHash(hashSessionToken(presented.token));

        // La puerta ya exigio una sesion de participante valida; esto solo
        // recupera DE QUIEN es. Si no se encuentra, no se envia a nadie.
        // En positivo, como en `mfa/verify` y por el mismo motivo.
        const usable = session !== null && session.revokedAt === null;

        if (!usable) {
          throw ApiErrors.unauthenticated();
        }

        const record = await identity.identities.findById(session.identityId);

        if (record?.email == null || record.emailVerifiedAt !== null) {
          return ACKNOWLEDGED;
        }

        try {
          await deliverLink({
            identityId: record.id,
            address: record.email,
            purpose: "EMAIL_VERIFICATION",
            locale: emailLocaleFrom(request.headers["accept-language"]),
            now: new Date(),
          });
        } catch (error) {
          // Aqui SI hay a quien decirselo: la persona acaba de pulsar "reenviar"
          // y un "enviado" falso la dejaria esperando un correo que no llega.
          request.log.error(
            { event: "email.verification.failed", to: maskEmail(record.email), err: error },
            "reenvio de verificacion fallido",
          );
          throw ApiErrors.serviceUnavailable();
        }

        return ACKNOWLEDGED;
      },
    },

    {
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      operationId: "requestPasswordReset",
      summary: "Pedir un enlace para restablecer la contrasena.",
      description:
        "Responde SIEMPRE 200 `{ acknowledged: true }`, exista o no una cuenta con ese correo, y antes de buscarla: ni el cuerpo ni el tiempo de respuesta dicen si el correo esta registrado. Si existe una cuenta ACTIVE con contrasena, se le envia un enlace de una hora.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Se usa precisamente cuando no se puede iniciar sesion. No revela si una cuenta existe (misma respuesta y mismo tiempo), solo envia a la direccion ya registrada -nunca a una que elija quien pregunta- y un tope por identidad impide usarla para inundar un buzon.",
      },
      schema: {
        body: forgotPasswordBodySchema,
        response: {
          200: acknowledgedResponseSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: (request) => {
        const body = request.body as z.infer<typeof forgotPasswordBodySchema>;
        const locale = emailLocaleFrom(request.headers["accept-language"]);
        const now = new Date();

        inBackground(request, "email.password_reset.failed", async () => {
          const found = await identity.identities.findByEmail(body.email);

          // El expediente postal sin credencial, una cuenta suspendida o una
          // identidad sin correo no reciben nada: restablecer supone que ya
          // habia una contrasena.
          if (found?.email == null || found.status !== "ACTIVE") return;

          const credential = await identity.identities.findCredential(found.id);
          if (credential === null) return;

          await deliverLink({
            identityId: found.id,
            address: found.email,
            purpose: "PASSWORD_RESET",
            locale,
            now,
          });
        });

        return ACKNOWLEDGED;
      },
    },

    {
      method: "POST",
      url: "/api/v1/auth/password/reset",
      operationId: "resetPassword",
      summary: "Fijar una contrasena nueva con el token del enlace.",
      description:
        "Comprueba la politica de contrasena ANTES de gastar el enlace, para que una contrasena corta no lo queme. Al fijarla: levanta el bloqueo por intentos, invalida los demas enlaces de restablecimiento vivos y revoca TODAS las sesiones abiertas de la cuenta.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Se usa sin sesion, desde el enlace del correo. El token es la prueba de control del buzon: 256 bits, de un solo uso y valido una hora. El personal sigue necesitando su segundo factor para entrar despues.",
      },
      schema: {
        body: resetPasswordBodySchema,
        response: {
          200: acknowledgedResponseSchema,
          410: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const body = request.body as z.infer<typeof resetPasswordBodySchema>;
        const now = new Date();

        if (!looksLikeSessionToken(body.token)) {
          throw ApiErrors.resetTokenInvalid();
        }

        try {
          assertPasswordAcceptable(body.password);
        } catch (error) {
          if (error instanceof PasswordPolicyError) {
            throw ApiErrors.weakPassword({
              reason: error.reason,
              minimum_length: MINIMUM_PASSWORD_LENGTH,
              maximum_length: MAXIMUM_PASSWORD_LENGTH,
            });
          }
          throw error;
        }

        // Se gasta ANTES de Argon2: un token inventado no cuesta un hash.
        const result = await identity.emailTokens.consume(
          hashSessionToken(body.token),
          "PASSWORD_RESET",
          now,
        );

        if (result.status === "EXPIRED") throw ApiErrors.resetTokenExpired();
        if (result.status === "INVALID") throw ApiErrors.resetTokenInvalid();

        const passwordHash = await hashPassword(body.password);

        await identity.identities.setPasswordAfterReset(result.identityId, passwordHash);
        await identity.emailTokens.invalidateOutstanding(result.identityId, "PASSWORD_RESET", now);

        // Si alguien entro con la contrasena vieja, esa sesion muere aqui. Es
        // la razon mas comun para restablecer una contrasena.
        await identity.sessions.revokeAllForIdentity(result.identityId, "password_reset", now);

        return ACKNOWLEDGED;
      },
    },
  ];
}
