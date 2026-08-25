/**
 * Contrato con el third-party sweepstakes administrator.
 *
 * ESTADO: ANDAMIAJE. Solo la interfaz y un adaptador que se niega a entregar.
 *
 * El administrador externo NO esta elegido (`docs/LEGAL_PENDING.md`). El
 * contrato se escribe ahora, y en abstracto, precisamente por eso: cuando se
 * elija, se implementa un adaptador; no se reescribe el dominio.
 */

import type {
  ExportDeliveryMethod,
  ExportSnapshotManifest,
  ReconciliationReport,
} from "./snapshot.js";

/** Esquema de export acordado con el administrador. Minimizacion de PII. */
export interface ExportSchemaDescriptor {
  readonly name: string;
  readonly version: number;
  /** Campos que el administrador exige. Nada mas viaja. */
  readonly fields: readonly string[];
  readonly containsPii: boolean;
}

export interface DeliveryReceipt {
  readonly snapshotId: string;
  readonly method: ExportDeliveryMethod;
  readonly deliveredAt: string;
  /** Referencia devuelta por el administrador. Prueba de la entrega. */
  readonly externalReference: string;
  readonly acknowledgedSha256: string | null;
}

/** Resultado que el administrador devuelve tras su propio sorteo. */
export interface PotentialWinnerResult {
  readonly promotionId: string;
  readonly snapshotId: string;
  readonly externalReference: string;
  readonly selections: readonly {
    readonly participantReference: string;
    readonly entryReference: string;
    readonly rank: number;
  }[];
}

export interface TpaAdapter {
  readonly providerId: string;
  prepareExportSchema(): Promise<ExportSchemaDescriptor>;
  validateSnapshot(manifest: ExportSnapshotManifest): Promise<ReconciliationReport>;
  serializeSnapshot(manifest: ExportSnapshotManifest): Promise<Uint8Array>;
  deliverSnapshot(manifest: ExportSnapshotManifest, payload: Uint8Array): Promise<DeliveryReceipt>;
  recordDeliveryReceipt(receipt: DeliveryReceipt): Promise<void>;
  ingestPotentialWinnerResult(result: PotentialWinnerResult): Promise<void>;
}

export class TpaNotConfiguredError extends Error {
  public constructor(operation: string) {
    super(
      `No hay third-party administrator configurado; la operacion '${operation}' no puede ejecutarse. ` +
        "Elegir el administrador y su esquema de entrega es una decision del cliente (docs/LEGAL_PENDING.md).",
    );
    this.name = "TpaNotConfiguredError";
  }
}

/**
 * Adaptador por defecto.
 *
 * Falla en cerrado a proposito: mientras nadie configure un destino real, el
 * sistema debe negarse a entregar datos de participantes, no elegir uno por su
 * cuenta ni "simular" la entrega. Un stub silencioso que devuelve exito seria
 * la forma mas facil de creer que los datos se entregaron cuando no lo hicieron.
 */
export function createUnconfiguredTpaAdapter(): TpaAdapter {
  const refuse = (operation: string): never => {
    throw new TpaNotConfiguredError(operation);
  };

  return {
    providerId: "unconfigured",
    prepareExportSchema: () => refuse("prepareExportSchema"),
    validateSnapshot: () => refuse("validateSnapshot"),
    serializeSnapshot: () => refuse("serializeSnapshot"),
    deliverSnapshot: () => refuse("deliverSnapshot"),
    recordDeliveryReceipt: () => refuse("recordDeliveryReceipt"),
    ingestPotentialWinnerResult: () => refuse("ingestPotentialWinnerResult"),
  };
}
