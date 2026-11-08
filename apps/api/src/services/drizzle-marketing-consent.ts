/**
 * Permiso opcional para correo promocional contra Drizzle (DEC-098).
 *
 * La tabla `marketing_email_consent_events` (0046) es de solo insercion: este
 * modulo solo lee el ultimo evento y anade uno nuevo cuando el estado cambia.
 * No decide si se ofrece la casilla ni con que texto: eso es la ruta, con
 * `MARKETING_EMAIL_CONSENT` y la configuracion.
 */

import type { Database } from "@lsw/database";
import { schema } from "@lsw/database";
import { desc, eq } from "drizzle-orm";

import type {
  MarketingConsentEventInput,
  MarketingConsentRepository,
  MarketingConsentState,
} from "./identity-ports.js";

const { marketingEmailConsentEvents, participants } = schema;

/** Lo que tiene una cuenta sin ningun evento: nunca dio permiso. */
export const NO_MARKETING_CONSENT: MarketingConsentState = {
  status: "NONE",
  textVersion: null,
  source: null,
  updatedAt: null,
};

type Reader = Pick<Database, "select">;

async function latest(db: Reader, participantId: string): Promise<MarketingConsentState> {
  const [row] = await db
    .select({
      action: marketingEmailConsentEvents.action,
      textVersion: marketingEmailConsentEvents.textVersion,
      source: marketingEmailConsentEvents.source,
      occurredAt: marketingEmailConsentEvents.occurredAt,
    })
    .from(marketingEmailConsentEvents)
    .where(eq(marketingEmailConsentEvents.participantId, participantId))
    .orderBy(desc(marketingEmailConsentEvents.seq))
    .limit(1);

  if (row === undefined) return NO_MARKETING_CONSENT;
  return {
    status: row.action,
    textVersion: row.action === "GRANTED" ? row.textVersion : null,
    source: row.source,
    updatedAt: row.occurredAt,
  };
}

/**
 * Si el evento cambia algo. Dar con el texto que ya esta dado o retirar lo que
 * no esta dado no cambia nada; dar con OTRO texto, si.
 */
export function marketingEventChangesState(
  current: MarketingConsentState,
  input: MarketingConsentEventInput,
): boolean {
  if (input.action === "WITHDRAWN") return current.status === "GRANTED";
  return current.status !== "GRANTED" || current.textVersion !== input.textVersion;
}

/** La fila de un evento, para insertarla aqui o dentro de otra transaccion. */
export function marketingEventRow(input: MarketingConsentEventInput) {
  return input.action === "GRANTED"
    ? {
        participantId: input.participantId,
        action: "GRANTED" as const,
        textVersion: input.textVersion,
        locale: input.locale,
        source: input.source,
        occurredAt: input.occurredAt,
      }
    : {
        participantId: input.participantId,
        action: "WITHDRAWN" as const,
        textVersion: null,
        locale: null,
        source: input.source,
        occurredAt: input.occurredAt,
      };
}

/** Una transaccion abierta de Drizzle. */
export type MarketingTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Registra el evento dentro de una transaccion ya abierta, solo si cambia algo.
 * Lo usan la ruta de la cuenta y el webhook del proveedor, que tiene que unir la
 * baja y el registro del evento en una sola transaccion.
 */
export async function recordConsentEventInTx(
  tx: MarketingTx,
  input: MarketingConsentEventInput,
): Promise<MarketingConsentState> {
  // Bloquear la fila del participante serializa dos cambios simultaneos de la
  // misma persona: el segundo lee lo que dejo el primero.
  const [owner] = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.id, input.participantId))
    .limit(1)
    .for("update");
  if (owner === undefined) throw new Error("marketing_consent_participant_not_found");

  const current = await latest(tx, input.participantId);
  if (!marketingEventChangesState(current, input)) return current;

  await tx.insert(marketingEmailConsentEvents).values(marketingEventRow(input));
  return latest(tx, input.participantId);
}

export function createMarketingConsentRepository(db: Database): MarketingConsentRepository {
  return {
    current(participantId) {
      return latest(db, participantId);
    },

    async record(input) {
      return db.transaction((tx) => recordConsentEventInTx(tx, input));
    },
  };
}
