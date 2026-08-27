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
import { and, eq, isNull, sql } from "drizzle-orm";

import type {
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
  identityMfaFactors,
  sessions,
  adminUserRoles,
  adminUsers,
} = schema;

function toIdentity(row: {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  status: string;
}): IdentityRecord {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    status: row.status,
  };
}

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

export function createIdentityRepositories(db: Database): IdentityRepositories {
  return {
    identities: {
      async findByEmail(email: string): Promise<IdentityRecord | null> {
        // Se compara contra la columna GENERADA `email_normalized`
        // (`lower(btrim(email))`), no contra `email`. Comparar contra la cruda
        // haria que `Admin@x.com` y `admin@x.com` fueran cuentas distintas, y
        // el indice unico esta sobre la normalizada.
        const normalized = email.trim().toLowerCase();

        const rows = await db
          .select({
            id: identities.id,
            email: identities.email,
            emailVerifiedAt: identities.emailVerifiedAt,
            status: identities.status,
          })
          .from(identities)
          .where(eq(identities.emailNormalized, normalized))
          .limit(1);

        const row = rows[0];
        return row === undefined ? null : toIdentity(row);
      },

      async findById(identityId: string): Promise<IdentityRecord | null> {
        const rows = await db
          .select({
            id: identities.id,
            email: identities.email,
            emailVerifiedAt: identities.emailVerifiedAt,
            status: identities.status,
          })
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
