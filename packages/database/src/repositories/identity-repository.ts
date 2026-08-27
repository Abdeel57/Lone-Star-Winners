/**
 * `ParticipantIdentityPort` contra PostgreSQL.
 *
 * ALCANCE DELIBERADAMENTE MINIMO. La identidad -credenciales, MFA, sesiones- la
 * construye el modulo de identidad, y `CLAUDE.md` seccion 4 prohibe dos
 * sistemas de autenticacion. Este adaptador NO autentica a nadie: responde el
 * UNICO dato de identidad del que depende una regla de participaciones.
 *
 * DEVUELVE UN INSTANTE, NO UN BOOLEANO
 *
 *   `identities.email_verified_at` es `timestamptz` nulable desde la migracion
 *   0001, y el puerto expone ese instante y no un `isVerified` derivado. Si las
 *   Official Rules acaban exigiendo "verificado ANTES de la compra", la unica
 *   forma de contestar es comparar el instante de verificacion con el
 *   `qualified_at` de la orden; con un booleano no habria dato historico con el
 *   que contestar hacia atras.
 *
 * EL JOIN VA DE `participants` A `identities`
 *
 *   El dominio conoce al participante, no a la identidad. Son entidades
 *   distintas a proposito: una identidad puede existir sin perfil de
 *   participante -una cuenta de personal, por ejemplo-, y el ledger referencia
 *   siempre al participante.
 */

import { eq } from "drizzle-orm";
import type { ParticipantIdentityPort, ParticipantIdentitySnapshot } from "@lsw/sweepstakes";

import { identities, participants } from "../schema/identity.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

export class DrizzleParticipantIdentityRepository implements ParticipantIdentityPort {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async getIdentitySnapshot(
    participantId: string,
  ): Promise<ParticipantIdentitySnapshot | null> {
    const rows = await this.db
      .select({
        participantId: participants.id,
        emailVerifiedAt: identities.emailVerifiedAt,
      })
      .from(participants)
      .innerJoin(identities, eq(identities.id, participants.identityId))
      .where(eq(participants.id, participantId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      // `null` = ese participante no existe. Distinto de "existe y no ha
      // verificado", que es `emailVerifiedAt: null`. El dominio los trata
      // igual para decidir la retencion, pero no son el mismo hecho y quien
      // audite tiene que poder separarlos.
      return null;
    }

    return {
      participantId: row.participantId,
      emailVerifiedAt: row.emailVerifiedAt,
    };
  }
}
