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

export interface IdentityRepository {
  findByEmail(email: string): Promise<IdentityRecord | null>;
  findById(identityId: string): Promise<IdentityRecord | null>;
  findCredential(identityId: string): Promise<CredentialRecord | null>;
  /** Solo el factor ACTIVE. Un PENDING no autentica a nadie. */
  findActiveMfaFactor(identityId: string): Promise<MfaFactorRecord | null>;
  /** Roles administrativos de la identidad. Vacio si no es personal. */
  listAdminRoles(identityId: string): Promise<readonly string[]>;

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
}
