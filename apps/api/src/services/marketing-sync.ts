/**
 * Sincronizador de contactos autorizados con el proveedor (DEC-099).
 *
 * Una pasada y termina: no hay ningun cron que lo lance. Compara la audiencia
 * deseada -solo `marketing_eligible_contacts`- con lo ya sincronizado.
 *
 * TRES CERROJOS PARA NO ESCRIBIR A QUIEN NO DIO PERMISO
 *
 *   1. La audiencia sale de una unica vista, con evento GRANTED vigente.
 *   2. Solo cuenta el permiso dado con la version vigente del texto.
 *   3. Justo antes de cada alta se vuelve a preguntar a la base de datos: entre
 *      que se calcula la lista y se llega a esa fila, la persona pudo retirarlo.
 *
 * Y si la edicion no tiene Reglas legibles, no se sincroniza a nadie: sin saber
 * que estados estan excluidos no se puede decidir a quien escribir.
 *
 * El informe solo lleva cifras: ni direcciones ni identificadores.
 */

import { createHash } from "node:crypto";

import { MARKETING_EMAIL_CONSENT, RESEND_PROMOTIONAL_USE } from "../config/consents.js";
import type { MarketingSyncConfig } from "../config/env.js";
import {
  MarketingProviderError,
  type AudienceFilter,
  type ContactSyncRow,
  type EligibleContact,
  type MarketingContactProvider,
  type MarketingRepository,
  type MarketingSegment,
} from "./marketing-ports.js";

export type MarketingSyncStatus =
  | "OFF"
  | "BLOCKED_NOT_APPROVED"
  | "BLOCKED_NO_TERRITORY_RULES"
  | "DRY_RUN"
  | "DONE"
  | "PARTIAL_BATCH_LIMIT"
  | "PARTIAL_RATE_LIMITED"
  | "PARTIAL_PROVIDER_FAILING";

export interface MarketingSyncReport {
  readonly status: MarketingSyncStatus;
  readonly eligible: number;
  readonly planned: {
    readonly create: number;
    readonly update: number;
    readonly reactivate: number;
    readonly remove: number;
  };
  readonly applied: {
    readonly created: number;
    readonly updated: number;
    readonly reactivated: number;
    readonly removed: number;
  };
  readonly skippedNoLongerEligible: number;
  readonly failed: number;
}

export interface MarketingSyncDependencies {
  readonly config: MarketingSyncConfig;
  readonly repository: MarketingRepository;
  /** `null` salvo en `live`: `dry_run` no puede llamar a nadie. */
  readonly provider: MarketingContactProvider | null;
  readonly now: () => Date;
  readonly approvals?: { readonly legallyApproved: boolean; readonly resendAuthorized: boolean };
  readonly textVersions?: readonly string[];
  readonly maxOperations?: number;
}

const DEFAULT_MAX_OPERATIONS = 200;
/** Tras tantos fallos seguidos algo va mal: se para y se reintenta en otra pasada. */
const MAX_CONSECUTIVE_FAILURES = 5;
export const BECAME_BUYER_EVENT = "lsw.contact.became_buyer";

function blocked(status: MarketingSyncStatus, eligible = 0): MarketingSyncReport {
  return {
    status,
    eligible,
    planned: { create: 0, update: 0, reactivate: 0, remove: 0 },
    applied: { created: 0, updated: 0, reactivated: 0, removed: 0 },
    skippedNoLongerEligible: 0,
    failed: 0,
  };
}

export function contactStateHash(contact: EligibleContact): string {
  return createHash("sha256")
    .update(
      JSON.stringify([contact.email, contact.locale, contact.segment, contact.consentTextVersion]),
    )
    .digest("hex");
}

/** Lo unico que sabe el proveedor de cada contacto, ademas de su direccion. */
function propertiesOf(contact: EligibleContact): Readonly<Record<string, string>> {
  return { locale: contact.locale, is_buyer: contact.segment === "BUYERS" ? "true" : "false" };
}

interface Plan {
  readonly creates: readonly EligibleContact[];
  readonly updates: readonly { contact: EligibleContact; row: ContactSyncRow }[];
  readonly reactivations: readonly { contact: EligibleContact; row: ContactSyncRow }[];
  readonly removals: readonly ContactSyncRow[];
}

export function planMarketingSync(
  desired: readonly EligibleContact[],
  rows: readonly ContactSyncRow[],
): Plan {
  const byParticipant = new Map(rows.map((row) => [row.participantId, row]));
  const wanted = new Set(desired.map((contact) => contact.participantId));

  const creates: EligibleContact[] = [];
  const updates: { contact: EligibleContact; row: ContactSyncRow }[] = [];
  const reactivations: { contact: EligibleContact; row: ContactSyncRow }[] = [];

  for (const contact of desired) {
    const row = byParticipant.get(contact.participantId);
    if (row === undefined) creates.push(contact);
    else if (row.removedAt !== null) reactivations.push({ contact, row });
    else if (row.stateHash !== contactStateHash(contact)) updates.push({ contact, row });
  }

  return {
    creates,
    updates,
    reactivations,
    removals: rows.filter((row) => row.removedAt === null && !wanted.has(row.participantId)),
  };
}

export async function runMarketingSync(
  dependencies: MarketingSyncDependencies,
): Promise<MarketingSyncReport> {
  const { config, repository, provider } = dependencies;
  if (config.mode === "off") return blocked("OFF");

  const approvals = dependencies.approvals ?? {
    legallyApproved: MARKETING_EMAIL_CONSENT.legallyApproved,
    resendAuthorized: RESEND_PROMOTIONAL_USE.authorizedInWriting,
  };

  const slug = config.targetPromotionSlug;
  const excludedStates = slug === null ? null : await repository.readExcludedStates(slug);
  if (excludedStates === null) return blocked("BLOCKED_NO_TERRITORY_RULES");

  const filter: AudienceFilter = {
    excludedStates,
    textVersions: dependencies.textVersions ?? [MARKETING_EMAIL_CONSENT.version],
  };
  const desired = await repository.listEligibleContacts(filter);
  const plan = planMarketingSync(desired, await repository.listSyncRows());

  const planned = {
    create: plan.creates.length,
    update: plan.updates.length,
    reactivate: plan.reactivations.length,
    remove: plan.removals.length,
  };

  if (config.mode === "dry_run") return { ...blocked("DRY_RUN", desired.length), planned };

  // El esquema de entorno ya lo impide; se repite porque de esto depende que
  // nadie reciba publicidad sin que este autorizado.
  if (
    !approvals.legallyApproved ||
    !approvals.resendAuthorized ||
    provider === null ||
    config.buyersSegmentId === null ||
    config.registeredSegmentId === null
  ) {
    return { ...blocked("BLOCKED_NOT_APPROVED", desired.length), planned };
  }

  const segmentIds: Record<MarketingSegment, string> = {
    BUYERS: config.buyersSegmentId,
    REGISTERED_NO_PURCHASE: config.registeredSegmentId,
  };
  const limit = dependencies.maxOperations ?? DEFAULT_MAX_OPERATIONS;
  const applied = { created: 0, updated: 0, reactivated: 0, removed: 0 };
  let skippedNoLongerEligible = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let operations = 0;
  let stoppedBy: MarketingSyncStatus | null = null;

  const finish = (): MarketingSyncReport => ({
    status: stoppedBy ?? "DONE",
    eligible: desired.length,
    planned,
    applied,
    skippedNoLongerEligible,
    failed,
  });

  /** Ejecuta una operacion. Devuelve `false` si la pasada debe terminar. */
  async function attempt(operation: () => Promise<void>): Promise<boolean> {
    if (operations >= limit) {
      stoppedBy = "PARTIAL_BATCH_LIMIT";
      return false;
    }
    operations += 1;
    try {
      await operation();
      consecutiveFailures = 0;
      return true;
    } catch (error) {
      if (error instanceof MarketingProviderError && error.rateLimited) {
        stoppedBy = "PARTIAL_RATE_LIMITED";
        return false;
      }
      failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stoppedBy = "PARTIAL_PROVIDER_FAILING";
        return false;
      }
      return true;
    }
  }

  // Las salidas primero: una baja importa mas que un alta.
  for (const row of plan.removals) {
    const go = await attempt(async () => {
      if (row.anonymized) {
        await provider.deleteContact(row.providerContactId);
      } else if (row.consentGranted) {
        // La causa no es de la persona: se le saca del segmento, sin darla de
        // baja. Una baja alli volveria por webhook como si ella la hubiera pedido.
        await provider.removeFromSegment(row.providerContactId, segmentIds[row.segment]);
      } else {
        await provider.unsubscribe(row.providerContactId);
      }
      await repository.markRemoved(row.participantId, dependencies.now());
      applied.removed += 1;
    });
    if (!go) return finish();
  }

  const save = async (contact: EligibleContact, providerContactId: string): Promise<void> => {
    await repository.saveSynced({
      participantId: contact.participantId,
      providerContactId,
      segment: contact.segment,
      stateHash: contactStateHash(contact),
      syncedAt: dependencies.now(),
    });
  };

  for (const contact of plan.creates) {
    const go = await attempt(async () => {
      if (!(await repository.isEligible(contact.participantId, filter))) {
        skippedNoLongerEligible += 1;
        return;
      }
      const { contactId } = await provider.createOrAttach({
        email: contact.email,
        properties: propertiesOf(contact),
        segmentId: segmentIds[contact.segment],
      });
      await save(contact, contactId);
      applied.created += 1;
    });
    if (!go) return finish();
  }

  const changeExisting = async (
    contact: EligibleContact,
    row: ContactSyncRow,
    resubscribe: boolean,
  ): Promise<boolean> => {
    if (!(await repository.isEligible(contact.participantId, filter))) {
      skippedNoLongerEligible += 1;
      return false;
    }
    await provider.updateContact(row.providerContactId, {
      properties: propertiesOf(contact),
      resubscribe,
    });
    const changedSegment = row.segment !== contact.segment;
    // Quien vuelve pudo haber salido por el segmento: hay que devolverlo a el.
    if (changedSegment || resubscribe) {
      await provider.moveSegment(
        row.providerContactId,
        segmentIds[contact.segment],
        changedSegment ? segmentIds[row.segment] : null,
      );
    }
    // Solo el paso a comprador, y nunca en un alta: encender esto no puede
    // disparar una automatizacion para toda la base de golpe.
    if (changedSegment && config.automationEventsEnabled && contact.segment === "BUYERS") {
      await provider.sendAutomationEvent(row.providerContactId, BECAME_BUYER_EVENT);
    }
    await save(contact, row.providerContactId);
    return true;
  };

  for (const { contact, row } of plan.reactivations) {
    const go = await attempt(async () => {
      if (await changeExisting(contact, row, true)) applied.reactivated += 1;
    });
    if (!go) return finish();
  }

  for (const { contact, row } of plan.updates) {
    const go = await attempt(async () => {
      if (await changeExisting(contact, row, false)) applied.updated += 1;
    });
    if (!go) return finish();
  }

  return finish();
}
