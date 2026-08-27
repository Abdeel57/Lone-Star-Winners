/**
 * De identidad a participante, y perfil del participante.
 *
 * SON DOS ENTIDADES DISTINTAS, Y LA TRADUCCION IMPORTA
 *
 *   `identities` es quien inicia sesion; `participants` es quien acumula
 *   entries. Una identidad puede existir sin perfil de participante -una cuenta
 *   de personal, por ejemplo- y el ledger referencia SIEMPRE al participante.
 *   Confundirlos haria que un miembro del personal apareciera con saldo.
 *
 *   Por eso `findIdByIdentity` devuelve `null` cuando no hay perfil, y quien
 *   llama lo trata como "esta sesion no puede leer datos de participante" y no
 *   como un error.
 *
 * QUE NO SE PUEDE CAMBIAR DESDE AQUI, Y POR QUE
 *
 *   El CORREO. Cambiarlo invalida la verificacion, y la verificacion puede ser
 *   condicion para acumular participaciones
 *   (`eligibility.email_verification_required`). Un cambio de correo es un
 *   flujo con su propia confirmacion, y pertenece al modulo de identidad.
 *
 *   El ESTADO y el ESTADO DE REVISION. Los mueve administracion con su propia
 *   capacidad y su propio expediente. Si el participante pudiera tocarlos,
 *   descalificarse -o des-descalificarse- seria un PATCH.
 *
 * POR QUE VIVE EN SU PROPIO FICHERO
 *
 *   Porque `services/ports.ts` y `services/drizzle-repositories.ts` son
 *   ficheros compartidos que otra sesion puede estar tocando ahora mismo.
 *   Anadir metodos alli habria sido lo natural con el repositorio quieto; con
 *   dos sesiones abiertas, un fichero nuevo cuesta menos que un conflicto.
 *   Cuando el repositorio se quede quieto, esto se pliega en `Repositories`.
 */

import { eq } from "drizzle-orm";
import { identities, participants, type Database } from "@lsw/database";

export interface ParticipantProfileRecord {
  readonly id: string;
  readonly email: string;
  readonly display_name: string | null;
  readonly email_verified: boolean;
  /**
   * Etiqueta BCP-47 (DEC-029). NUNCA es `null` aunque el contrato lo permita:
   * `participants.preferred_locale` es `NOT NULL` y sin default, porque DEC-021
   * no admite un idioma por defecto. El contrato lo declara nulable para que la
   * interfaz sepa tratar el caso el dia que exista un participante sin idioma.
   */
  readonly language_preference: string | null;
  readonly created_at: string;
}

export interface ParticipantProfilePatch {
  readonly displayName?: string | null | undefined;
  readonly languagePreference?: string | null | undefined;
}

export interface ParticipantLookup {
  /** `null` = esa identidad no tiene perfil de participante. */
  findIdByIdentity(identityId: string): Promise<string | null>;
  findProfile(participantId: string): Promise<ParticipantProfileRecord | null>;
  updateProfile(
    participantId: string,
    patch: ParticipantProfilePatch,
  ): Promise<ParticipantProfileRecord | null>;
}

export function createParticipantLookup(db: Database): ParticipantLookup {
  async function readProfile(participantId: string): Promise<ParticipantProfileRecord | null> {
    const rows = await db
      .select({
        id: participants.id,
        displayName: participants.displayName,
        preferredLocale: participants.preferredLocale,
        createdAt: participants.createdAt,
        email: identities.email,
        emailVerifiedAt: identities.emailVerifiedAt,
      })
      .from(participants)
      .innerJoin(identities, eq(identities.id, participants.identityId))
      .where(eq(participants.id, participantId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      // Una identidad anonimizada no tiene correo. Se sirve cadena vacia y no
      // se inventa nada: el perfil sigue existiendo aunque el dato se haya
      // purgado por retencion.
      email: row.email ?? "",
      display_name: row.displayName,
      // Instante y no booleano en la base de datos; aqui se deriva. La fuente
      // sigue siendo el instante, que es lo que permite contestar "estaba
      // verificado ANTES de la compra" si las Official Rules lo exigen.
      email_verified: row.emailVerifiedAt !== null,
      language_preference: row.preferredLocale,
      created_at: row.createdAt.toISOString(),
    };
  }

  return {
    findIdByIdentity: async (identityId: string): Promise<string | null> => {
      const rows = await db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.identityId, identityId))
        .limit(1);

      return rows[0]?.id ?? null;
    },

    findProfile: readProfile,

    updateProfile: async (
      participantId: string,
      patch: ParticipantProfilePatch,
    ): Promise<ParticipantProfileRecord | null> => {
      // Se construye el `SET` con lo que VIENE, no con todo el objeto: un
      // `undefined` significa "no lo toques" y un `null` significa "borralo".
      // Escribir siempre ambos campos convertiria un PATCH parcial en un PUT y
      // borraria el nombre de quien solo cambia el idioma.
      const changes: { displayName?: string | null; preferredLocale?: "en-US" | "es-US" } = {};

      if (patch.displayName !== undefined) {
        changes.displayName = patch.displayName;
      }

      if (patch.languagePreference !== undefined && patch.languagePreference !== null) {
        // La columna es un enum de dos valores y NOT NULL: DEC-021 no admite un
        // idioma por defecto, asi que tampoco admite borrarlo. Un idioma que no
        // sea uno de los dos se rechaza aqui en vez de reventar en el motor.
        if (patch.languagePreference !== "en-US" && patch.languagePreference !== "es-US") {
          // Inalcanzable desde HTTP -el esquema de la ruta ya lo acota- y aun
          // asi se lanza: una guarda que devuelve el perfil sin cambiarlo hace
          // creer al cliente que su peticion se aplico.
          throw new RangeError(
            `Idioma no soportado: ${patch.languagePreference}. DEC-021 solo admite en-US y es-US.`,
          );
        }
        changes.preferredLocale = patch.languagePreference;
      }

      if (Object.keys(changes).length === 0) {
        return await readProfile(participantId);
      }

      const updated = await db
        .update(participants)
        .set(changes)
        .where(eq(participants.id, participantId))
        .returning({ id: participants.id });

      if (updated.length === 0) {
        return null;
      }
      return await readProfile(participantId);
    },
  };
}
