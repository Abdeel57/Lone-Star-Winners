/**
 * Implementacion de los puertos de identidad contra Drizzle (DEC-045).
 *
 * Lo que este modulo NO hace, y es deliberado:
 *   - no hashea ni verifica nada: eso es `packages/security/crypto`;
 *   - no decide si una sesion vale: eso es `evaluateSession`;
 *   - no lee el reloj: los instantes llegan como parametro, igual que en
 *     `packages/security`, para que las pruebas puedan situarse en el borde de
 *     una expiracion en vez de solo "ahora".
 *
 * Aqui solo hay traduccion entre filas y registros.
 */

import type { Database } from "@lsw/database";
import { schema } from "@lsw/database";
import type { SessionAudience } from "@lsw/security";
import { and, count, eq, gt, gte, isNull, sql } from "drizzle-orm";

import type {
  ConsumeEmailTokenResult,
  CreateSessionInput,
  CredentialRecord,
  IdentityRepositories,
  IdentityRecord,
  MfaFactorRecord,
  SessionRecord,
} from "./identity-ports.js";

const {
  identities,
  identityCredentials,
  identityEmailTokens,
  identityMfaFactors,
  participants,
  sessions,
  adminUserRoles,
  adminUsers,
} = schema;

function toIdentity(row: {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  status: string;
  phoneE164?: string | null;
}): IdentityRecord {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    status: row.status,
    phoneE164: row.phoneE164 ?? null,
  };
}

/**
 * Proyeccion comun de una identidad (DEC-060: con su celular verificado).
 *
 * `identities.phone_e164`, NO `participants.phone_e164`: el segundo es un dato
 * de contacto sin verificar -el de una ficha postal transcrita, por ejemplo- y
 * no puede servir para entrar en una cuenta.
 */
const identityProjection = {
  id: identities.id,
  email: identities.email,
  emailVerifiedAt: identities.emailVerifiedAt,
  status: identities.status,
  phoneE164: identities.phoneE164,
};

/** Indice unico de `0031_verified_phone.sql`. */
const PHONE_UNIQUE_INDEX = "identities_phone_e164_key";

function toSession(row: {
  id: string;
  identityId: string;
  scope: string;
  mfaVerifiedAt: Date | null;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}): SessionRecord {
  return {
    id: row.id,
    identityId: row.identityId,
    scope: row.scope as SessionAudience,
    mfaVerifiedAt: row.mfaVerifiedAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/** Indice unico de `0001_identity_and_rbac.sql` sobre `email_normalized`. */
const EMAIL_UNIQUE_INDEX = "identities_email_normalized_key";

/**
 * `true` solo si el motor rechazo la fila por el indice unico del correo.
 *
 * Se recorre la cadena de `cause` porque drizzle envuelve el error real de
 * `pg`. Y se exige el NOMBRE del indice ademas del `23505`: cualquier otra
 * violacion de unicidad traducida a "ese correo ya existe" mandaria a alguien a
 * iniciar sesion en una cuenta que no tiene.
 */
function isEmailTaken(error: unknown): boolean {
  return violatedUniqueIndex(error) === EMAIL_UNIQUE_INDEX;
}

/** Nombre del indice unico que rechazo la fila, o `null` si no fue eso. */
function violatedUniqueIndex(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };

    if (candidate.code === "23505") {
      return typeof candidate.constraint === "string" ? candidate.constraint : null;
    }

    current = candidate.cause;
  }

  return null;
}

export function createIdentityRepositories(db: Database): IdentityRepositories {
  return {
    identities: {
      async registerParticipant(input): Promise<IdentityRecord | null> {
        try {
          return await db.transaction(async (tx) => {
            const [identity] = await tx
              .insert(identities)
              .values({
                // Se guarda recortado y tal como se tecleo. La normalizacion a
                // minusculas la hace la columna generada, no esta linea.
                email: input.email.trim(),
                // `ACTIVE` con `email_verified_at` a null: el login exige
                // `ACTIVE`, y todavia no existe verificacion de correo con la
                // que salir de `PENDING_VERIFICATION`. Que un correo sin
                // verificar tenga consecuencias es una decision legal pendiente
                // (`docs/LEGAL_PENDING.md`), no algo que decidir aqui cerrando
                // la puerta a todo el mundo.
                status: "ACTIVE",
              })
              .returning({
                id: identities.id,
                email: identities.email,
                emailVerifiedAt: identities.emailVerifiedAt,
                status: identities.status,
              });

            if (identity === undefined) throw new Error("identity_insert_returned_no_row");

            await tx
              .insert(identityCredentials)
              .values({ identityId: identity.id, passwordHash: input.passwordHash });

            await tx.insert(participants).values({
              identityId: identity.id,
              displayName: input.displayName,
              preferredLocale: input.preferredLocale,
            });

            return toIdentity(identity);
          });
        } catch (error) {
          if (isEmailTaken(error)) return null;
          throw error;
        }
      },

      async registerParticipantWithPhone(input): Promise<IdentityRecord | null> {
        try {
          return await db.transaction(async (tx) => {
            const [identity] = await tx
              .insert(identities)
              .values({
                // Sin correo: DEC-060 admite cuentas solo con celular. `ACTIVE`
                // porque el celular YA esta verificado al llegar aqui, y la
                // CHECK de 0031 exige correo O celular.
                email: null,
                phoneE164: input.phoneE164,
                phoneVerifiedAt: input.verifiedAt,
                status: "ACTIVE",
              })
              .returning(identityProjection);

            if (identity === undefined) throw new Error("identity_insert_returned_no_row");

            await tx
              .insert(identityCredentials)
              .values({ identityId: identity.id, passwordHash: input.passwordHash });

            await tx.insert(participants).values({
              identityId: identity.id,
              displayName: input.displayName,
              preferredLocale: input.preferredLocale,
              // Tambien como dato de contacto: es el que ve el panel.
              phoneE164: input.phoneE164,
            });

            return toIdentity(identity);
          });
        } catch (error) {
          if (violatedUniqueIndex(error) === PHONE_UNIQUE_INDEX) return null;
          throw error;
        }
      },

      async findByVerifiedPhone(phoneE164: string): Promise<IdentityRecord | null> {
        const rows = await db
          .select(identityProjection)
          .from(identities)
          .where(eq(identities.phoneE164, phoneE164))
          .limit(1);

        const row = rows[0];
        return row === undefined ? null : toIdentity(row);
      },

      async findByEmail(email: string): Promise<IdentityRecord | null> {
        // Se compara contra la columna GENERADA `email_normalized`
        // (`lower(btrim(email))`), no contra `email`. Comparar contra la cruda
        // haria que `Admin@x.com` y `admin@x.com` fueran cuentas distintas, y
        // el indice unico esta sobre la normalizada.
        const normalized = email.trim().toLowerCase();

        const rows = await db
          .select(identityProjection)
          .from(identities)
          .where(eq(identities.emailNormalized, normalized))
          .limit(1);

        const row = rows[0];
        return row === undefined ? null : toIdentity(row);
      },

      async findById(identityId: string): Promise<IdentityRecord | null> {
        const rows = await db
          .select(identityProjection)
          .from(identities)
          .where(eq(identities.id, identityId))
          .limit(1);

        const row = rows[0];
        return row === undefined ? null : toIdentity(row);
      },

      async findCredential(identityId: string): Promise<CredentialRecord | null> {
        const rows = await db
          .select({
            identityId: identityCredentials.identityId,
            passwordHash: identityCredentials.passwordHash,
            failedAttempts: identityCredentials.failedAttempts,
            lockedUntil: identityCredentials.lockedUntil,
          })
          .from(identityCredentials)
          .where(eq(identityCredentials.identityId, identityId))
          .limit(1);

        return rows[0] ?? null;
      },

      async findActiveMfaFactor(identityId: string): Promise<MfaFactorRecord | null> {
        const rows = await db
          .select({
            id: identityMfaFactors.id,
            identityId: identityMfaFactors.identityId,
            secretCiphertext: identityMfaFactors.secretCiphertext,
            status: identityMfaFactors.status,
            lastUsedCounter: identityMfaFactors.lastUsedCounter,
          })
          .from(identityMfaFactors)
          .where(
            and(
              eq(identityMfaFactors.identityId, identityId),
              eq(identityMfaFactors.status, "ACTIVE"),
            ),
          )
          .limit(1);

        const row = rows[0];

        if (row === undefined) {
          return null;
        }

        return {
          id: row.id,
          identityId: row.identityId,
          secretCiphertext: row.secretCiphertext,
          status: row.status,
          lastUsedCounter: row.lastUsedCounter === null ? null : Number(row.lastUsedCounter),
        };
      },

      async listAdminRoles(identityId: string): Promise<readonly string[]> {
        const rows = await db
          .select({ roleKey: adminUserRoles.roleKey })
          .from(adminUserRoles)
          .innerJoin(adminUsers, eq(adminUsers.id, adminUserRoles.adminUserId))
          .where(eq(adminUsers.identityId, identityId));

        return rows.map((row) => row.roleKey);
      },

      async findAdminUser(identityId: string): Promise<{ status: string } | null> {
        const rows = await db
          .select({ status: adminUsers.status })
          .from(adminUsers)
          .where(eq(adminUsers.identityId, identityId))
          .limit(1);

        return rows[0] ?? null;
      },

      async recordLoginAttempt(input): Promise<void> {
        if (input.succeeded) {
          await db
            .update(identityCredentials)
            .set({ failedAttempts: 0, lockedUntil: null })
            .where(eq(identityCredentials.identityId, input.identityId));
          return;
        }

        // El incremento y el bloqueo se calculan EN EL MOTOR, en una sola
        // sentencia. Leer, sumar en JavaScript y escribir permitiria que dos
        // intentos simultaneos se pisaran y el contador avanzara uno en vez de
        // dos, que es justo lo que buscaria quien esta probando contrasenas.
        await db
          .update(identityCredentials)
          .set({
            failedAttempts: sql`${identityCredentials.failedAttempts} + 1`,
            lockedUntil: sql`CASE
              WHEN ${identityCredentials.failedAttempts} + 1 >= ${input.lockThreshold}
              THEN ${input.now}::timestamptz + (${input.lockMinutes} * interval '1 minute')
              ELSE ${identityCredentials.lockedUntil}
            END`,
          })
          .where(eq(identityCredentials.identityId, input.identityId));
      },

      async updatePasswordHash(identityId: string, passwordHash: string): Promise<void> {
        await db
          .update(identityCredentials)
          .set({ passwordHash, passwordSetAt: sql`now()` })
          .where(eq(identityCredentials.identityId, identityId));
      },

      async consumeMfaCounter(factorId: string, counter: number): Promise<boolean> {
        // La condicion `last_used_counter < counter` va en el WHERE y no en un
        // `if` previo: es lo que hace atomico el consumo. Dos peticiones con el
        // mismo codigo compiten por la misma fila y solo una actualiza; la otra
        // recibe cero filas y se rechaza.
        const result = await db
          .update(identityMfaFactors)
          .set({ lastUsedCounter: BigInt(counter) })
          .where(
            and(
              eq(identityMfaFactors.id, factorId),
              sql`(${identityMfaFactors.lastUsedCounter} IS NULL OR ${identityMfaFactors.lastUsedCounter} < ${counter})`,
            ),
          );

        return (result.rowCount ?? 0) > 0;
      },

      async setPasswordAfterReset(identityId: string, passwordHash: string): Promise<void> {
        await db
          .update(identityCredentials)
          .set({
            passwordHash,
            passwordSetAt: sql`now()`,
            failedAttempts: 0,
            lockedUntil: null,
            updatedAt: sql`now()`,
          })
          .where(eq(identityCredentials.identityId, identityId));
      },

      async markEmailVerified(identityId: string, email: string, now: Date): Promise<boolean> {
        const normalized = email.trim().toLowerCase();

        // `COALESCE` conserva el instante de la PRIMERA verificacion: forma
        // parte de la procedencia y un segundo clic no puede moverlo. La
        // condicion sobre `email_normalized` es la que impide que un enlace
        // enviado a una direccion anterior verifique la actual.
        const result = await db
          .update(identities)
          .set({
            emailVerifiedAt: sql`COALESCE(${identities.emailVerifiedAt}, ${now}::timestamptz)`,
          })
          .where(and(eq(identities.id, identityId), eq(identities.emailNormalized, normalized)));

        return (result.rowCount ?? 0) > 0;
      },
    },

    emailTokens: {
      async issue(input): Promise<void> {
        await db.insert(identityEmailTokens).values({
          identityId: input.identityId,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          email: input.email,
          expiresAt: input.expiresAt,
        });
      },

      async consume(tokenHash, purpose, now): Promise<ConsumeEmailTokenResult> {
        // Todas las condiciones van en el WHERE, no en un `if` previo: es lo
        // que hace atomico el consumo. Dos clics simultaneos compiten por la
        // misma fila y solo uno recibe una fila de vuelta.
        const consumed = await db
          .update(identityEmailTokens)
          .set({ consumedAt: now })
          .where(
            and(
              eq(identityEmailTokens.tokenHash, tokenHash),
              eq(identityEmailTokens.purpose, purpose),
              isNull(identityEmailTokens.consumedAt),
              gt(identityEmailTokens.expiresAt, now),
            ),
          )
          .returning({
            identityId: identityEmailTokens.identityId,
            email: identityEmailTokens.email,
          });

        const row = consumed[0];

        if (row !== undefined) {
          return { status: "CONSUMED", identityId: row.identityId, email: row.email };
        }

        // Solo para elegir el mensaje: caducado y sin usar, o cualquier otra
        // cosa (inexistente, de otro proposito, ya usado).
        const existing = await db
          .select({ consumedAt: identityEmailTokens.consumedAt })
          .from(identityEmailTokens)
          .where(
            and(
              eq(identityEmailTokens.tokenHash, tokenHash),
              eq(identityEmailTokens.purpose, purpose),
            ),
          )
          .limit(1);

        // Sin fila, `?.` da `undefined` y la comparacion con `null` es falsa:
        // cae en `INVALID`, que es lo correcto.
        return existing[0]?.consumedAt === null ? { status: "EXPIRED" } : { status: "INVALID" };
      },

      async countIssuedSince(identityId, purpose, since): Promise<number> {
        const rows = await db
          .select({ issued: count() })
          .from(identityEmailTokens)
          .where(
            and(
              eq(identityEmailTokens.identityId, identityId),
              eq(identityEmailTokens.purpose, purpose),
              gte(identityEmailTokens.createdAt, since),
            ),
          );

        return rows[0]?.issued ?? 0;
      },

      async invalidateOutstanding(identityId, purpose, now): Promise<void> {
        await db
          .update(identityEmailTokens)
          .set({ consumedAt: now })
          .where(
            and(
              eq(identityEmailTokens.identityId, identityId),
              eq(identityEmailTokens.purpose, purpose),
              isNull(identityEmailTokens.consumedAt),
            ),
          );
      },
    },

    sessions: {
      async create(input: CreateSessionInput): Promise<SessionRecord> {
        const rows = await db
          .insert(sessions)
          .values({
            tokenHash: input.tokenHash,
            identityId: input.identityId,
            scope: input.scope,
            expiresAt: input.expiresAt,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
          })
          .returning();

        const row = rows[0];

        if (row === undefined) {
          throw new Error("session_insert_returned_no_row");
        }

        return toSession(row);
      },

      async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
        const rows = await db
          .select()
          .from(sessions)
          .where(eq(sessions.tokenHash, tokenHash))
          .limit(1);

        const row = rows[0];
        return row === undefined ? null : toSession(row);
      },

      async touch(sessionId: string, now: Date): Promise<void> {
        await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
      },

      async markMfaVerified(sessionId: string, now: Date): Promise<void> {
        await db.update(sessions).set({ mfaVerifiedAt: now }).where(eq(sessions.id, sessionId));
      },

      async revoke(sessionId: string, reason: string, now: Date): Promise<void> {
        // `isNull(revokedAt)` evita reescribir el motivo de una sesion ya
        // revocada: el primer motivo es el que explica lo que paso.
        await db
          .update(sessions)
          .set({ revokedAt: now, revocationReason: reason })
          .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
      },

      async revokeAllForIdentity(identityId: string, reason: string, now: Date): Promise<number> {
        const result = await db
          .update(sessions)
          .set({ revokedAt: now, revocationReason: reason })
          .where(and(eq(sessions.identityId, identityId), isNull(sessions.revokedAt)));

        return result.rowCount ?? 0;
      },
    },
  };
}
