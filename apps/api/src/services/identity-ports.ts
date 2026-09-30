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

export interface RegisterParticipantInput {
  readonly email: string;
  /** Cadena PHC ya calculada. La contrasena en claro no llega nunca aqui. */
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly preferredLocale: "en-US" | "es-US";
}

export interface RegisterParticipantWithPhoneInput {
  /** E.164, ya normalizado y ya verificado por SMS. */
  readonly phoneE164: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly preferredLocale: "en-US" | "es-US";
  /** Instante de la verificacion: pasa a `phone_verified_at`. */
  readonly verifiedAt: Date;
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

  /** DEC-060: la cuenta cuyo participante tiene ese celular VERIFICADO. */
  findByVerifiedPhone(phoneE164: string): Promise<IdentityRecord | null>;

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

export interface IdentityRepositories {
  readonly identities: IdentityRepository;
  readonly sessions: SessionRepository;
  /** DEC-058: enlaces de verificacion y de restablecimiento. */
  readonly emailTokens: EmailTokenRepository;
}
