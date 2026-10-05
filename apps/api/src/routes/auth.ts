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
import { clearCartSessionCookie, resolveCartSession } from "../http/cart-session.js";
import {
  assertDeclaration,
  consentsInputSchema,
  dateOfBirthSchema,
  residenceStateSchema,
} from "../http/eligibility-input.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  clearCookieOptionsFor,
  cookieNameFor,
  cookieOptionsFor,
  type SessionCookieConfig,
} from "../http/session-cookie.js";
import { maskEmail } from "../services/email.js";
import { maskPhone, normalizeUsPhone } from "../services/phone.js";
import type { SmsVerifier } from "../services/sms.js";
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

/**
 * Celular tal como lo teclea la persona. La forma la decide `normalizeUsPhone`
 * en el handler, con su propio codigo (PHONE_INVALID); aqui solo se acota.
 */
const phoneInputSchema = z.string().trim().min(7).max(32);

/** Codigo SMS de Twilio Verify: 4 a 10 digitos segun la configuracion del servicio. */
const smsCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/u);

/** Exactamente uno de los dos. Un cuerpo con ambos, o con ninguno, es ambiguo. */
function exactlyOneOf(body: { email?: unknown; phone?: unknown }): boolean {
  return (body.email === undefined) !== (body.phone === undefined);
}

const loginBodySchema = z
  .object({
    email: z.string().min(3).max(320).optional(),
    /** DEC-060: iniciar sesion con el celular verificado. */
    phone: phoneInputSchema.optional(),
    password: z.string().min(1).max(1_024),
  })
  .refine(exactlyOneOf, { error: "email_xor_phone", path: ["email"] });

const registerBodySchema = z
  .object({
    /**
     * La misma forma y el mismo tope que las CHECK de `identities`
     * (`identities_email_shape`, `identities_email_length`). Se repiten aqui
     * porque un correo que solo rechazara el motor saldria como 500, y a quien se
     * equivoca tecleando le corresponde un 422.
     *
     * DEC-060: opcional, porque el alta puede hacerse con celular. Exactamente
     * uno de `email` y `phone` (refinamiento de abajo).
     */
    email: z
      .string()
      .trim()
      .max(254)
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u)
      .optional(),
    /** DEC-060: celular, con el codigo que llego por SMS a ese numero. */
    phone: phoneInputSchema.optional(),
    sms_code: smsCodeSchema.optional(),
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
     * DEC-067: los documentos aceptados, con la version que se mostro. Tienen
     * que llegar TODOS los de `REQUIRED_CONSENTS` (`GET /config`); lo comprueba
     * el handler, que es quien conoce la version vigente.
     */
    consents: consentsInputSchema,
    /**
     * DEC-067: fecha de nacimiento y estado de residencia DECLARADOS. No se
     * decide aqui si la persona es elegible: eso se evalua al otorgar, contra
     * las reglas de cada promocion (`services/eligibility.ts`).
     */
    date_of_birth: dateOfBirthSchema,
    residence_state: residenceStateSchema,
  })
  .refine(exactlyOneOf, { error: "email_xor_phone", path: ["email"] })
  .refine((body) => body.phone === undefined || body.sms_code !== undefined, {
    error: "sms_code_required",
    path: ["sms_code"],
  });

/**
 * DEC-060: pedir un codigo por SMS.
 *
 * `purpose` separa los dos usos porque responden distinto: en el alta, un
 * numero ya registrado es 409 ANTES de enviar (no se cobra un codigo inutil);
 * en la recuperacion, la respuesta es la misma exista o no la cuenta.
 */
const phoneStartBodySchema = z.object({
  phone: phoneInputSchema,
  purpose: z.enum(["REGISTER", "PASSWORD_RESET"]),
  /** Token del widget de Cloudflare Turnstile. Obligatorio si esta configurado. */
  bot_check_token: z.string().min(1).max(2048).optional(),
});

const resetPasswordSmsBodySchema = z.object({
  phone: phoneInputSchema,
  code: smsCodeSchema,
  /** Solo el tope; la politica la decide `assertPasswordAcceptable`. */
  password: z.string().min(1).max(MAXIMUM_PASSWORD_LENGTH),
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
  /** `null` en una cuenta creada solo con celular (DEC-060). */
  email: z.string().nullable(),
  email_verified: z.boolean(),
  /**
   * DEC-060: celular VERIFICADO de la cuenta, en E.164, o `null`. Es un dato
   * de quien pregunta sobre si mismo; nunca el de otra persona.
   */
  phone: z.string().nullable(),
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
  phone: null,
  roles: [],
  capabilities: [],
};

export function buildAuthRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { identity, config, email, sms, botCheck, repositories } = dependencies;

  /** DEC-060: el verificador de SMS, o 503 si el registro con celular esta apagado. */
  function requireSms(): SmsVerifier {
    // `?? null`: el contrato se genera con dependencias vacias, y ahi `sms`
    // llega `undefined`. Para esta ruta es lo mismo que no tener proveedor.
    const verifier = sms ?? null;
    if (verifier === null) throw ApiErrors.smsNotConfigured();
    return verifier;
  }

  /** DEC-060: E.164 de EE. UU., o 422 PHONE_INVALID. */
  function requirePhone(input: string): string {
    const normalized = normalizeUsPhone(input);
    if (normalized === null) throw ApiErrors.phoneInvalid();
    return normalized;
  }

  /** La politica de contrasena, traducida a su codigo de error. */
  function assertPassword(password: string): void {
    try {
      assertPasswordAcceptable(password);
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
  }

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
   * DEC-079: el carrito que el visitante lleno SIN cuenta pasa a la cuenta.
   *
   * Se llama justo despues de abrir una sesion de PARTICIPANTE (alta o
   * login). Suma las lineas al carrito de la cuenta, revoca la sesion anonima y
   * borra su cookie: a partir de aqui el carrito es el de la cuenta y la sesion
   * anonima no vuelve a servir para nada. No se promueve: la sesion de
   * participante es nueva, asi que un token anonimo capturado antes del login
   * no da acceso a la cuenta (fijacion de sesion).
   *
   * NUNCA tumba el inicio de sesion. La persona ya demostro quien es; si la
   * adopcion falla, se registra y su carrito anonimo sigue donde estaba.
   */
  async function adoptGuestCart(
    request: FastifyRequest,
    reply: FastifyReply,
    identityId: string,
    now: Date,
  ): Promise<void> {
    const guest = await resolveCartSession(request, { identity, config }, now.getTime());
    if (guest === null) {
      return;
    }

    try {
      const promotion = await repositories.promotions.findActive();
      const { adoptedLines } = await repositories.carts.adoptSessionCart(
        guest.id,
        identityId,
        promotion?.id ?? null,
      );
      await identity.cartSessions.revoke(guest.id, "adopted_by_account", now);
      clearCartSessionCookie(reply, config);
      request.log.info(
        { event: "cart.guest_adopted", adopted_lines: adoptedLines },
        "carrito adoptado",
      );
    } catch (error) {
      request.log.warn(
        { event: "cart.guest_adoption_failed", err: error },
        "no se pudo pasar el carrito anonimo a la cuenta",
      );
    }
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
      request.log.error({ event, err: error }, "envio en segundo plano fallido");
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

        assertPassword(body.password);

        // DEC-067: antes del SMS y de Argon2, para no gastar un codigo ni un
        // hash en un alta que va a rechazarse por un dato que falta.
        const consents = assertDeclaration(body, now);

        // DEC-060: alta con celular. El codigo se comprueba ANTES de Argon2 y
        // de tocar la base de datos: sin un codigo valido para ese numero no
        // hay cuenta que crear, y un codigo inventado no cuesta un hash.
        let verifiedPhone: string | null = null;
        if (body.phone !== undefined) {
          const verifier = requireSms();
          const phone = requirePhone(body.phone);
          const approved = await verifier.check(phone, body.sms_code ?? "");
          if (!approved) throw ApiErrors.smsCodeInvalid();
          verifiedPhone = phone;
        }

        // Se hashea ANTES de saber si el correo esta libre. El 409 de abajo ya
        // dice que existe, asi que el tiempo no esconde nada; el orden esta
        // para que la transaccion del alta no tenga dentro decenas de
        // milisegundos de Argon2 con una conexion del pool cogida.
        const passwordHash = await hashPassword(body.password);

        const eligibility = {
          dateOfBirth: body.date_of_birth,
          residenceState: body.residence_state,
          declaredAt: now,
        };

        const created =
          verifiedPhone === null
            ? await identity.identities.registerParticipant({
                // El refinamiento del cuerpo garantiza correo si no hay celular.
                email: body.email ?? "",
                passwordHash,
                displayName: body.display_name ?? null,
                preferredLocale: body.language_preference,
                eligibility,
                consents,
              })
            : await identity.identities.registerParticipantWithPhone({
                phoneE164: verifiedPhone,
                passwordHash,
                displayName: body.display_name ?? null,
                preferredLocale: body.language_preference,
                verifiedAt: now,
                eligibility,
                consents,
              });

        if (created === null) {
          throw verifiedPhone === null
            ? ApiErrors.emailAlreadyRegistered()
            : ApiErrors.phoneAlreadyRegistered();
        }

        // Siempre `PARTICIPANT`, sin pasar por `audienceForRoles`: una
        // identidad recien creada no tiene roles, y si algun dia los tuviera
        // no seria por esta ruta.
        await openSession(request, reply, created.id, "PARTICIPANT", now);
        // DEC-079: lo que lleno sin cuenta, a la cuenta recien creada.
        await adoptGuestCart(request, reply, created.id, now);

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
          phone: created.phoneE164 ?? null,
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

        // DEC-060: por correo o por celular VERIFICADO. Un celular con forma
        // imposible se trata como cuenta inexistente: mismo 401 y mismo trabajo,
        // para que la forma del numero no sea otra pista.
        const phone = body.phone === undefined ? null : normalizeUsPhone(body.phone);
        const found =
          body.phone === undefined
            ? await identity.identities.findByEmail(body.email ?? "")
            : phone === null
              ? null
              : await identity.identities.findByVerifiedPhone(phone);
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

        // DEC-079: solo el escaparate tiene carrito. Una sesion de personal no
        // adopta nada, ni siquiera con la cookie de carrito presente.
        if (audience === "PARTICIPANT") {
          await adoptGuestCart(request, reply, found.id, now);
        }

        const pending = requiresMfa(roles);
        const state = pending ? ("MFA_PENDING" as const) : ("ACTIVE" as const);

        return {
          authenticated: !pending,
          state,
          scope: audience,
          email: found.email,
          email_verified: found.emailVerifiedAt !== null,
          phone: found.phoneE164 ?? null,
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
          phone: record?.phoneE164 ?? null,
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
          phone: record?.phoneE164 ?? null,
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
          request.log.info(
            {
              event: "email.verification.skipped",
              reason: record?.email == null ? "no_email" : "already_verified",
            },
            "reenvio de verificacion sin envio",
          );
          return ACKNOWLEDGED;
        }

        try {
          const outcome = await deliverLink({
            identityId: record.id,
            address: record.email,
            purpose: "EMAIL_VERIFICATION",
            locale: emailLocaleFrom(request.headers["accept-language"]),
            now: new Date(),
          });

          if (outcome === "THROTTLED") {
            request.log.info(
              {
                event: "email.verification.skipped",
                reason: "throttled",
                to: maskEmail(record.email),
              },
              "reenvio de verificacion sin envio",
            );
          }
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

        // Cada salida sin envio deja su motivo en el log. La respuesta es la
        // misma en todos los casos -eso es lo que impide enumerar cuentas-, asi
        // que sin este registro una prueba que "no llega" no dice por que. El
        // log es interno; la direccion va enmascarada.
        const skipped = (reason: string): void => {
          request.log.info(
            { event: "email.password_reset.skipped", reason, to: maskEmail(body.email) },
            "restablecimiento sin envio",
          );
        };

        inBackground(request, "email.password_reset.failed", async () => {
          const found = await identity.identities.findByEmail(body.email);

          // El expediente postal sin credencial, una cuenta suspendida o una
          // identidad sin correo no reciben nada: restablecer supone que ya
          // habia una contrasena.
          if (found?.email == null) {
            skipped("no_account");
            return;
          }

          if (found.status !== "ACTIVE") {
            skipped("account_not_active");
            return;
          }

          const credential = await identity.identities.findCredential(found.id);

          if (credential === null) {
            skipped("no_password");
            return;
          }

          const outcome = await deliverLink({
            identityId: found.id,
            address: found.email,
            purpose: "PASSWORD_RESET",
            locale,
            now,
          });

          if (outcome === "THROTTLED") skipped("throttled");
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

    // -----------------------------------------------------------------------
    // DEC-060: celular verificado por SMS (Twilio Verify).
    // -----------------------------------------------------------------------

    {
      method: "POST",
      url: "/api/v1/auth/phone/start",
      operationId: "startPhoneVerification",
      summary: "Enviar un codigo por SMS al celular.",
      description:
        "`REGISTER`: responde 409 PHONE_ALREADY_REGISTERED si el numero ya tiene cuenta, ANTES de enviar. `PASSWORD_RESET`: responde siempre 200 y solo envia si el numero es el celular verificado de una cuenta ACTIVE; el envio va en segundo plano para que el tiempo de respuesta no lo delate. Solo numeros de EE. UU. Si hay comprobacion anti-bots configurada, `bot_check_token` es obligatorio.",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Se usa sin cuenta (alta) o sin poder entrar (recuperacion). Cada envio cuesta dinero: lo protegen la comprobacion anti-bots de Cloudflare Turnstile, los limites por numero y la deteccion de fraude de Twilio Verify, y la restriccion a numeros de EE. UU.",
      },
      schema: {
        body: phoneStartBodySchema,
        response: {
          200: acknowledgedResponseSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const body = request.body as z.infer<typeof phoneStartBodySchema>;
        const verifier = requireSms();
        const phone = requirePhone(body.phone);
        const locale = emailLocaleFrom(request.headers["accept-language"]);

        const checker = botCheck ?? null;
        if (checker !== null) {
          // Sin IP: la que ve la API es la del servidor de `apps/web` (DEC-057),
          // y mandarle a Cloudflare una IP que no es la del visitante empeora
          // la comprobacion en vez de reforzarla.
          const human =
            body.bot_check_token !== undefined &&
            (await checker.verify(body.bot_check_token, null));
          if (!human) throw ApiErrors.botCheckFailed();
        }

        if (body.purpose === "PASSWORD_RESET") {
          inBackground(request, "sms.password_reset.failed", async () => {
            const found = await identity.identities.findByVerifiedPhone(phone);
            if (found?.status !== "ACTIVE") {
              request.log.info(
                {
                  event: "sms.password_reset.skipped",
                  reason: found === null ? "no_account" : "account_not_active",
                  to: maskPhone(phone),
                },
                "recuperacion por SMS sin envio",
              );
              return;
            }
            await verifier.start(phone, locale);
          });
          return ACKNOWLEDGED;
        }

        // REGISTER. Se comprueba antes de enviar: un codigo para un numero que
        // ya tiene cuenta se cobraria y no serviria para nada.
        if ((await identity.identities.findByVerifiedPhone(phone)) !== null) {
          throw ApiErrors.phoneAlreadyRegistered();
        }

        let outcome;
        try {
          outcome = await verifier.start(phone, locale);
        } catch {
          // El detalle ya lo registro el adaptador; aqui solo se traduce.
          throw ApiErrors.serviceUnavailable();
        }

        if (outcome === "INVALID_NUMBER") throw ApiErrors.phoneInvalid();
        // Limite de Twilio para ese numero. El tiempo exacto no lo publica;
        // diez minutos es su ventana por defecto.
        if (outcome === "RATE_LIMITED") throw ApiErrors.rateLimited(600);

        return ACKNOWLEDGED;
      },
    },

    {
      method: "POST",
      url: "/api/v1/auth/password/reset-sms",
      operationId: "resetPasswordWithSms",
      summary: "Fijar una contrasena nueva con el codigo SMS.",
      description:
        "Para cuentas que se identifican con celular. Comprueba la politica de contrasena ANTES de gastar el codigo. Al fijarla: levanta el bloqueo por intentos y revoca TODAS las sesiones abiertas. Numero sin cuenta y codigo incorrecto responden igual (422 SMS_CODE_INVALID).",
      tags: ["auth"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Se usa sin poder entrar. El codigo SMS es la prueba de control del celular: lo genera y lo caduca Twilio Verify, y un codigo correcto se consume al comprobarlo. No distingue numero sin cuenta de codigo incorrecto.",
      },
      schema: {
        body: resetPasswordSmsBodySchema,
        response: {
          200: acknowledgedResponseSchema,
          422: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const body = request.body as z.infer<typeof resetPasswordSmsBodySchema>;
        const now = new Date();
        const verifier = requireSms();
        const phone = requirePhone(body.phone);

        assertPassword(body.password);

        const found = await identity.identities.findByVerifiedPhone(phone);
        // Sin cuenta no hubo codigo que enviar, asi que tampoco hay nada que
        // comprobar: misma respuesta que un codigo incorrecto.
        if (found === null) throw ApiErrors.smsCodeInvalid();

        const approved = await verifier.check(phone, body.code);
        if (!approved) throw ApiErrors.smsCodeInvalid();

        await identity.identities.setPasswordAfterReset(
          found.id,
          await hashPassword(body.password),
        );
        await identity.sessions.revokeAllForIdentity(found.id, "password_reset", now);

        return ACKNOWLEDGED;
      },
    },
  ];
}
