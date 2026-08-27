/**
 * Puerto de identidad, visto desde el dominio de participaciones.
 *
 * ALCANCE DELIBERADAMENTE MINIMO. La identidad -credenciales, MFA, sesiones-
 * la construye el modulo de identidad, y `CLAUDE.md` seccion 4 prohibe dos
 * sistemas de autenticacion. Este puerto no autentica a nadie: solo pregunta
 * el UNICO dato de identidad del que depende una regla de participaciones.
 *
 * POR QUE UN INSTANTE Y NO UN BOOLEANO
 *
 *   `identities.email_verified_at` es `timestamptz` nulable desde la migracion
 *   0001. El puerto expone ese instante, no un `isVerified` derivado, por dos
 *   razones concretas:
 *
 *     1. Si las Official Rules acaban exigiendo "verificado ANTES de la
 *        compra", la unica forma de responder es comparar el instante de
 *        verificacion con `qualified_at` de la orden. Con un booleano habria
 *        que rehacer el puerto y, peor, no habria dato historico con el que
 *        contestar hacia atras.
 *     2. "Cuando se verifico" es procedencia de la participacion y debe poder
 *        acabar en el snapshot de calculo, que es lo que un tercero
 *        reconstruye.
 *
 *   `isEmailVerifiedAt` se deriva encima; la fuente sigue siendo el instante.
 */

export interface ParticipantIdentitySnapshot {
  readonly participantId: string;
  /** `null` = sin verificar. Con valor = instante de verificacion, en UTC. */
  readonly emailVerifiedAt: Date | null;
}

export interface ParticipantIdentityPort {
  /**
   * El nombre definitivo del metodo llega con el contrato de la fase 2 del
   * modulo de identidad; la FORMA -un instante nulable- es la que queda fijada
   * aqui.
   */
  getIdentitySnapshot(participantId: string): Promise<ParticipantIdentitySnapshot | null>;
}

/**
 * Estaba el email verificado en un instante dado.
 *
 * Compara contra un instante y no contra "ahora" porque el dominio no lee el
 * reloj (DEC-011) y porque la pregunta relevante puede ser historica.
 */
export function isEmailVerifiedAt(
  snapshot: ParticipantIdentitySnapshot | null,
  instant: Date,
): boolean {
  const verifiedAt = snapshot?.emailVerifiedAt ?? null;
  if (verifiedAt === null) {
    return false;
  }
  return verifiedAt.getTime() <= instant.getTime();
}
