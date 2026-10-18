/**
 * Puertos de identidad y sesion (DEC-006, DEC-045).
 *
 * Fichero aparte de `ports.ts` a proposito: aquel describe el escaparate, que
 * es de lectura publica, y este describe credenciales. Mezclarlos haria que
 * quien abre el fichero de puertos para anadir un listado de productos tenga
 * delante la superficie de autenticacion.
 *
 * Igual que el resto de puertos, aqui NO hay implementacion ni SQL: es la forma
 * de lo que `apps/api` necesita. La implementacion contra Drizzle vive en
 * `drizzle-identity.ts`.
 */

import type { SessionAudience } from "@lsw/security";

/** Lo minimo para autenticar. Nunca incluye el hash fuera de este puerto. */
export interface CredentialRecord {
  readonly identityId: string;
  readonly passwordHash: string;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

export interface IdentityRecord {
  readonly id: string;
  readonly email: string | null;
  /**
   * Instante de verificacion, no un booleano.
   *
   * Si las Official Rules acaban exigiendo "verificado ANTES de la compra", un
   * booleano no puede responder eso; ademas, el instante forma parte de la
   * procedencia de una participacion. Ver `docs/LEGAL_PENDING.md`, epigrafe
   * "Email verification before earning entries" (sigue TBD).
   */
  readonly emailVerifiedAt: Date | null;
  readonly status: string;
  /**
   * DEC-060: celular VERIFICADO del participante, en E.164, o `null`. Un
   * telefono sin verificar no aparece aqui: no sirve para iniciar sesion ni se
   * publica como dato de la cuenta.
   */
  readonly phoneE164: string | null;
}

export interface MfaFactorRecord {
  readonly id: string;
  readonly identityId: string;
  readonly secretCiphertext: string;
  readonly status: "PENDING" | "ACTIVE" | "REVOKED";
  /** Ultima ventana TOTP consumida. Impide reutilizar un codigo. */
  readonly lastUsedCounter: number | null;
}

export interface SessionRecord {
  readonly id: string;
  readonly identityId: string;
  readonly scope: SessionAudience;
  readonly mfaVerifiedAt: Date | null;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateSessionInput {
  readonly tokenHash: string;
  readonly identityId: string;
  readonly scope: SessionAudience;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** DEC-067: version de un documento que el participante acepto. */
export interface ConsentAcceptanceInput {
  readonly key: string;
  readonly version: string;
}

/** DEC-067: lo que se declara para evaluar la elegibilidad, y cuando. */
export interface EligibilityDeclarationInput {
  /** `YYYY-MM-DD`. */
  readonly dateOfBirth: string;
  /** Codigo USPS de dos letras. */
  readonly residenceState: string;
  readonly declaredAt: Date;
}

/**
 * DEC-067: la declaracion guardada de un participante.
 *
 * DEC-089: el estado y la fecha de nacimiento se declaran por separado. El alta
 * sin contrasena solo pregunta el estado, y la fecha se pide en el checkout
 * cuando la puerta de edad esta encendida; hasta entonces es `null`.
 */
export interface EligibilityDeclarationRecord {
  /** `YYYY-MM-DD`, o `null` si todavia no se declaro. */
  readonly dateOfBirth: string | null;
  readonly residenceState: string;
  /** Instante en que se declaro el estado. */
  readonly declaredAt: Date;
  /** Instante en que se declaro la fecha de nacimiento, o `null`. */
  readonly dateOfBirthDeclaredAt: Date | null;
}

/**
 * DEC-089: lo que se declara en `PUT /me/eligibility`. Cada mitad es opcional,
 * pero no se reescribe: una mitad ya declarada solo admite el mismo valor.
 */
export interface EligibilityDeclarationPatch {
  readonly participantId: string;
  readonly residenceState: string | null;
  readonly dateOfBirth: string | null;
  readonly declaredAt: Date;
  readonly consents: readonly ConsentAcceptanceInput[];
  readonly locale: "en-US" | "es-US";
}

/**
 * Resultado de declarar.
 *
 * `STATE_REQUIRED`: se mando la fecha sin estado a una cuenta que tampoco lo
 * tiene. La mayoria de edad depende del estado, y la CHECK de 0040 lo impone.
 */
export type DeclareEligibilityOutcome =
  "DECLARED" | "ALREADY_DECLARED" | "STATE_REQUIRED" | "NOT_FOUND";

/** DEC-089: contacto con el que se pidio un codigo. */
export type SignInChannel = "EMAIL" | "SMS";

/**
 * DEC-089: alta SIN contrasena de un contacto ya verificado con un codigo.
 *
 * El contacto llega normalizado (correo en minusculas o E.164) y verificado:
 * pasa a `email_verified_at` o a `phone_verified_at` con `verifiedAt`.
 */
export interface RegisterVerifiedParticipantInput {
  readonly channel: SignInChannel;
  readonly contact: string;
  readonly verifiedAt: Date;
  readonly displayName: string;
  readonly preferredLocale: "en-US" | "es-US";
  /** Codigo USPS. La fecha de nacimiento no se pregunta en el alta. */
  readonly residenceState: string;
  readonly consents: readonly ConsentAcceptanceInput[];
}

export interface RegisterParticipantInput {
  readonly email: string;
  /** Cadena PHC ya calculada. La contrasena en claro no llega nunca aqui. */
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly preferredLocale: "en-US" | "es-US";
  /** DEC-067: se guardan en la misma transaccion que la cuenta. */
  readonly eligibility: EligibilityDeclarationInput;
  readonly consents: readonly ConsentAcceptanceInput[];
}

export interface RegisterParticipantWithPhoneInput {
  /** E.164, ya normalizado y ya verificado por SMS. */
  readonly phoneE164: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly preferredLocale: "en-US" | "es-US";
  /** Instante de la verificacion: pasa a `phone_verified_at`. */
  readonly verifiedAt: Date;
  /** DEC-067: se guardan en la misma transaccion que la cuenta. */
  readonly eligibility: EligibilityDeclarationInput;
  readonly consents: readonly ConsentAcceptanceInput[];
}

export interface IdentityRepository {
  /**
   * Alta de participante: identidad, credencial y perfil en UNA transaccion.
   *
   * Devuelve `null` si el correo ya pertenece a una identidad, sea cual sea:
   * una cuenta normal, una de personal o el expediente `PENDING_VERIFICATION`
   * sin credenciales que deja una ficha postal transcrita. Este ultimo caso NO
   * se "reclama" aqui a proposito: sin verificacion de correo, bastaria con
   * teclear la direccion de otra persona para quedarse con sus participaciones.
   *
   * La unicidad la decide el indice sobre `email_normalized`, no una lectura
   * previa: dos altas simultaneas con el mismo correo pasarian las dos un
   * `findByEmail` y solo el motor puede desempatarlas.
   */
  registerParticipant(input: RegisterParticipantInput): Promise<IdentityRecord | null>;

  /**
   * DEC-060: alta con celular verificado y SIN correo, en UNA transaccion.
   * Devuelve `null` si ese celular ya identifica otra cuenta: lo decide el
   * indice unico `identities_phone_e164_key`, no una lectura previa.
   */
  registerParticipantWithPhone(
    input: RegisterParticipantWithPhoneInput,
  ): Promise<IdentityRecord | null>;

  /**
   * DEC-089: alta sin contrasena, en UNA transaccion: identidad con el contacto
   * ya verificado, perfil con nombre y estado, y consentimientos. Sin fila de
   * credencial: la cuenta entra con codigo.
   *
   * Devuelve `null` si el contacto ya pertenece a una identidad; lo deciden los
   * indices unicos, no una lectura previa.
   */
  registerVerifiedParticipant(
    input: RegisterVerifiedParticipantInput,
  ): Promise<IdentityRecord | null>;

  /** DEC-060: la cuenta cuyo participante tiene ese celular VERIFICADO. */
  findByVerifiedPhone(phoneE164: string): Promise<IdentityRecord | null>;

  /**
   * DEC-067: la declaracion de elegibilidad del participante, o `null` si no
   * declaro ni el estado. DEC-089: con el estado y sin fecha, `dateOfBirth` es
   * `null`.
   */
  findEligibilityDeclaration(participantId: string): Promise<EligibilityDeclarationRecord | null>;

  /**
   * DEC-067 y DEC-089: declara lo que falte, con sus consentimientos, en UNA
   * transaccion.
   *
   * No reescribe: una mitad ya declarada con otro valor es `ALREADY_DECLARED`,
   * porque cambiar la fecha o el estado despues de comprar seria volverse
   * elegible a posteriori. Las correcciones las hace una persona. Si no queda
   * nada nuevo que escribir, tambien es `ALREADY_DECLARED`.
   */
  declareEligibility(input: EligibilityDeclarationPatch): Promise<DeclareEligibilityOutcome>;

  findByEmail(email: string): Promise<IdentityRecord | null>;
  findById(identityId: string): Promise<IdentityRecord | null>;
  findCredential(identityId: string): Promise<CredentialRecord | null>;
  /** Solo el factor ACTIVE. Un PENDING no autentica a nadie. */
  findActiveMfaFactor(identityId: string): Promise<MfaFactorRecord | null>;
  /** Roles administrativos de la identidad. Vacio si no es personal. */
  listAdminRoles(identityId: string): Promise<readonly string[]>;

  /**
   * Cuenta administrativa de la identidad, si la tiene.
   *
   * Se consulta el ESTADO ademas de los roles porque son cosas distintas:
   * revocar los roles de alguien que se va es un acto aparte de desactivar su
   * cuenta, y en la practica se hacen en momentos distintos. Si el login solo
   * mirara los roles, una cuenta DEACTIVATED que conserve sus asignaciones
   * seguiria entrando.
   */
  findAdminUser(identityId: string): Promise<{ readonly status: string } | null>;

  /**
   * Registra el resultado de un intento. El exito reinicia el contador; el
   * fallo lo incrementa y, superado el umbral, fija `lockedUntil`.
   *
   * Vive en la base de datos y no en memoria del proceso porque con varias
   * replicas un contador en memoria no cuenta nada: bastaria con reintentar
   * hasta caer en otra instancia.
   */
  recordLoginAttempt(input: {
    readonly identityId: string;
    readonly succeeded: boolean;
    readonly now: Date;
    readonly lockThreshold: number;
    readonly lockMinutes: number;
  }): Promise<void>;

  /** Sustituye el hash tras un `needsRehash`. */
  updatePasswordHash(identityId: string, passwordHash: string): Promise<void>;

  /** Consume una ventana TOTP. Falla si otro proceso la consumio antes. */
  consumeMfaCounter(factorId: string, counter: number): Promise<boolean>;

  /**
   * Fija la contrasena tras un restablecimiento (DEC-058) y levanta el
   * bloqueo por intentos fallidos: quien demuestra que controla el correo no
   * tiene por que esperar a que caduque un bloqueo que quiza provoco otro.
   */
  setPasswordAfterReset(identityId: string, passwordHash: string): Promise<void>;

  /**
   * Marca el correo como verificado, SOLO si la identidad sigue teniendo la
   * direccion `email` (comparada normalizada). Devuelve `false` si ya no la
   * tiene: un enlace enviado a una direccion anterior no verifica la nueva.
   * Si ya estaba verificado, conserva el instante original y devuelve `true`.
   */
  markEmailVerified(identityId: string, email: string, now: Date): Promise<boolean>;
}

/** Para que sirve un enlace enviado por correo (DEC-058). */
export type EmailTokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface IssueEmailTokenInput {
  readonly identityId: string;
  readonly purpose: EmailTokenPurpose;
  /** SHA-256 del token. El token en claro solo existe en el correo. */
  readonly tokenHash: string;
  readonly email: string;
  readonly expiresAt: Date;
}

/**
 * Resultado de gastar un enlace.
 *
 * `EXPIRED` y `INVALID` se distinguen porque la pantalla dice cosas distintas
 * ("ha caducado, pide otro" frente a "no es valido"), y distinguirlos no
 * revela nada: quien presenta el token ya lo tiene.
 */
export type ConsumeEmailTokenResult =
  | {
      readonly status: "CONSUMED";
      readonly identityId: string;
      readonly email: string;
    }
  | { readonly status: "EXPIRED" }
  | { readonly status: "INVALID" };

export interface EmailTokenRepository {
  issue(input: IssueEmailTokenInput): Promise<void>;

  /**
   * Gasta el enlace en UNA sentencia: dos clics simultaneos compiten por la
   * misma fila y solo uno la consume. Un enlace ya consumido es `INVALID`.
   */
  consume(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
  ): Promise<ConsumeEmailTokenResult>;

  /** Enlaces de ese proposito emitidos para la identidad desde `since`. */
  countIssuedSince(identityId: string, purpose: EmailTokenPurpose, since: Date): Promise<number>;

  /** Gasta todos los enlaces vivos de ese proposito (tras un restablecimiento). */
  invalidateOutstanding(identityId: string, purpose: EmailTokenPurpose, now: Date): Promise<void>;
}

/**
 * DEC-089: un codigo pedido y todavia abierto (ni acertado ni gastado).
 *
 * `codeHash` es el HMAC del codigo en el correo y `null` en el celular, cuyo
 * codigo comprueba Twilio Verify.
 */
export interface OpenSignInCode {
  readonly id: string;
  readonly codeHash: string | null;
  readonly attempts: number;
  readonly expiresAt: Date;
}

/** DEC-089: resultado de gastar un permiso de alta. */
export type ConsumeSignupTicketResult =
  | {
      readonly status: "CONSUMED";
      readonly channel: SignInChannel;
      readonly contact: string;
      /** Cuando se acerto el codigo: es el instante de verificacion del contacto. */
      readonly verifiedAt: Date;
    }
  | { readonly status: "EXPIRED" }
  | { readonly status: "INVALID" };

export interface SignInCodeRepository {
  /**
   * Codigos pedidos para ese contacto desde `since` que NO se acertaron. Es el
   * tope por destinatario: frena llenar el buzon o el celular de otra persona
   * con codigos que nadie usa, sin frenar a quien entra y sale varias veces.
   */
  countUnverifiedSince(channel: SignInChannel, contact: string, since: Date): Promise<number>;

  issue(input: {
    /** Lo genera quien llama: entra en el HMAC del codigo. */
    readonly id: string;
    readonly channel: SignInChannel;
    readonly contact: string;
    readonly codeHash: string | null;
    readonly expiresAt: Date;
  }): Promise<void>;

  /** El codigo mas reciente de ese contacto que no se ha acertado ni gastado. */
  findLatestOpen(channel: SignInChannel, contact: string): Promise<OpenSignInCode | null>;

  /**
   * Cuenta un intento en UNA sentencia y devuelve los intentos tras contarlo, o
   * `null` si ya se habian agotado. Se cuenta ANTES de comparar: dos intentos
   * simultaneos no pueden saltarse el tope.
   */
  registerAttempt(id: string, maxAttempts: number): Promise<number | null>;

  /**
   * Marca el codigo como acertado. Con `signup`, deja en la fila el permiso de
   * alta; sin el, el codigo queda gastado. `false` si otra peticion lo acerto
   * antes: el motor decide la carrera.
   */
  markVerified(
    id: string,
    now: Date,
    signup: { readonly tokenHash: string; readonly expiresAt: Date } | null,
  ): Promise<boolean>;

  /** Gasta el permiso de alta en UNA sentencia: solo un alta por permiso. */
  consumeSignupTicket(tokenHash: string, now: Date): Promise<ConsumeSignupTicketResult>;
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  /** Busca por HASH del token. El token en claro no llega nunca aqui. */
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touch(sessionId: string, now: Date): Promise<void>;
  markMfaVerified(sessionId: string, now: Date): Promise<void>;
  /** Revoca. Nunca borra: una fila borrada no se puede auditar (DEC-006). */
  revoke(sessionId: string, reason: string, now: Date): Promise<void>;
  revokeAllForIdentity(identityId: string, reason: string, now: Date): Promise<number>;
}

/**
 * DEC-079: sesion ANONIMA que solo es duena de un carrito.
 *
 * No tiene identidad ni scope: no hay nada que autorizar con ella. Su `id` es lo
 * que guarda `carts.session_ref`.
 */
export interface CartSessionRecord {
  readonly id: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface CartSessionRepository {
  create(input: {
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<CartSessionRecord>;
  /** Busca por HASH del token. El token en claro no llega nunca aqui. */
  findByTokenHash(tokenHash: string): Promise<CartSessionRecord | null>;
  /** Revoca. Nunca borra: la fila revocada explica a donde fue su carrito. */
  revoke(sessionId: string, reason: string, now: Date): Promise<void>;
}

export interface IdentityRepositories {
  readonly identities: IdentityRepository;
  readonly sessions: SessionRepository;
  /** DEC-079: sesiones anonimas de carrito. */
  readonly cartSessions: CartSessionRepository;
  /** DEC-058: enlaces de verificacion y de restablecimiento. */
  readonly emailTokens: EmailTokenRepository;
  /** DEC-089: codigos para entrar sin contrasena y permisos de alta. */
  readonly signInCodes: SignInCodeRepository;
}
