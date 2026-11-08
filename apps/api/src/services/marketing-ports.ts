/**
 * Puertos del correo promocional (DEC-099).
 *
 * Separados de `services/email.ts` a proposito: el correo de acceso y el de
 * marketing no comparten clave, dominio ni codigo. `test/marketing-boundary`
 * comprueba que estos modulos no importan el emisor transaccional.
 */

import type { MarketingConsentSource } from "./identity-ports.js";

export type MarketingSegment = "BUYERS" | "REGISTERED_NO_PURCHASE";

/** A quien se le puede escribir: una fila de `marketing_eligible_contacts`, ya filtrada. */
export interface EligibleContact {
  readonly participantId: string;
  readonly email: string;
  readonly locale: "en-US" | "es-US";
  readonly segment: MarketingSegment;
  readonly consentTextVersion: string;
}

export interface AudienceFilter {
  /** Codigos USPS excluidos por las Reglas de la edicion elegida. */
  readonly excludedStates: readonly string[];
  /** Solo cuenta el permiso dado con estas versiones del texto. */
  readonly textVersions: readonly string[];
}

export interface ContactSyncRow {
  readonly participantId: string;
  readonly providerContactId: string;
  readonly segment: MarketingSegment;
  readonly stateHash: string;
  readonly removedAt: Date | null;
  /** Borro sus datos: en el proveedor se borra el contacto, no se da de baja. */
  readonly anonymized: boolean;
  /** Sigue teniendo un permiso `GRANTED` vigente. Decide como se le saca. */
  readonly consentGranted: boolean;
}

export type SuppressionReason = "HARD_BOUNCE" | "COMPLAINT" | "PROVIDER_MANUAL";

/** Lo que un evento del proveedor obliga a hacer. Nunca incluye DAR permiso. */
export interface ProviderEventEffect {
  readonly suppress: SuppressionReason | null;
  readonly withdraw: MarketingConsentSource | null;
}

export interface ProviderEventInput {
  readonly providerEventId: string;
  readonly eventType: string;
  readonly providerEmailId: string | null;
  readonly providerBroadcastId: string | null;
  readonly occurredAt: Date;
  /** Solo para encontrar a la persona. No se guarda. */
  readonly email: string | null;
  readonly effect: ProviderEventEffect;
}

export interface MarketingCounts {
  readonly consent: {
    readonly granted: number;
    readonly withdrawn: number;
    readonly none: number;
  };
  readonly audience: {
    readonly buyers: number;
    readonly registeredNoPurchase: number;
    /** Con permiso, pero sin estado declarado o en un estado excluido. `null` sin edicion. */
    readonly excludedByTerritory: number | null;
  };
  readonly suppressions: {
    readonly hardBounce: number;
    readonly complaint: number;
    readonly providerManual: number;
  };
  readonly unsubscribes: number;
}

export interface CampaignStats {
  readonly providerBroadcastId: string;
  readonly name: string | null;
  readonly delivered: number;
  readonly opened: number;
  readonly clicked: number;
  readonly bounced: number;
  readonly complained: number;
  readonly attributed: readonly {
    readonly currency: string;
    readonly orders: number;
    /** En unidad menor y como texto: viene de un `bigint`. */
    readonly netMinor: string;
  }[];
}

export interface MarketingRepository {
  /** Lista sin paginar: se usa desde un proceso por lotes, no desde una peticion. */
  listEligibleContacts(filter: AudienceFilter): Promise<readonly EligibleContact[]>;
  /** Se vuelve a preguntar justo antes de cada alta en el proveedor. */
  isEligible(participantId: string, filter: AudienceFilter): Promise<boolean>;
  listSyncRows(): Promise<readonly ContactSyncRow[]>;
  saveSynced(input: {
    readonly participantId: string;
    readonly providerContactId: string;
    readonly segment: MarketingSegment;
    readonly stateHash: string;
    readonly syncedAt: Date;
  }): Promise<void>;
  markRemoved(participantId: string, at: Date): Promise<void>;
  /** Los estados excluidos de las Reglas activas de esa edicion, o `null` si no se sabe. */
  readExcludedStates(promotionSlug: string): Promise<readonly string[] | null>;
  /** En UNA transaccion. `DUPLICATE` si ese evento ya se proceso. */
  applyProviderEvent(input: ProviderEventInput): Promise<"APPLIED" | "DUPLICATE">;
  counts(excludedStates: readonly string[] | null): Promise<MarketingCounts>;
  campaignStats(attributionWindowDays: number): Promise<readonly CampaignStats[]>;
  nameCampaign(providerBroadcastId: string, name: string, at: Date): Promise<void>;
}

/**
 * El proveedor de contactos. NO tiene ningun metodo para enviar correos: las
 * campanas las crea y las envia una persona desde Resend.
 */
export interface MarketingContactProvider {
  /** Crea el contacto, o actualiza el que ya exista con esa direccion. */
  createOrAttach(input: {
    readonly email: string;
    readonly properties: Readonly<Record<string, string>>;
    readonly segmentId: string;
  }): Promise<{ readonly contactId: string }>;
  updateContact(
    contactId: string,
    input: {
      readonly properties: Readonly<Record<string, string>>;
      /** Solo al volver a dar permiso. En una actualizacion normal se omite. */
      readonly resubscribe: boolean;
    },
  ): Promise<void>;
  moveSegment(
    contactId: string,
    addSegmentId: string,
    removeSegmentId: string | null,
  ): Promise<void>;
  /**
   * Saca al contacto del segmento SIN darlo de baja. Es la salida cuando la causa
   * no es de la persona (cuenta suspendida, texto nuevo): un `unsubscribed: true`
   * volveria por webhook como si ella hubiera pedido la baja.
   */
  removeFromSegment(contactId: string, segmentId: string): Promise<void>;
  unsubscribe(contactId: string): Promise<void>;
  deleteContact(contactId: string): Promise<void>;
  /** Siempre con `contact_id`: con `email`, Resend crearia el contacto sin permiso. */
  sendAutomationEvent(contactId: string, event: string): Promise<void>;
}

/** Fallo del proveedor. Lleva status y codigo, nunca la direccion. */
export class MarketingProviderError extends Error {
  public readonly status: number | null;

  public constructor(status: number | null, cause?: unknown) {
    super(`marketing_provider_failed${status === null ? "" : `_${String(status)}`}`, { cause });
    this.name = "MarketingProviderError";
    this.status = status;
  }

  public get rateLimited(): boolean {
    return this.status === 429;
  }
}
