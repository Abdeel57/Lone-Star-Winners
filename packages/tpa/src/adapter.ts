/**
 * Contrato con el third-party sweepstakes administrator.
 *
 * ESTADO: ANDAMIAJE. Solo la interfaz y un adaptador que se niega a entregar.
 *
 * El administrador externo NO esta elegido (`docs/LEGAL_PENDING.md`). El
 * contrato se escribe ahora, y en abstracto, precisamente por eso: cuando se
 * elija, se implementa un adaptador; no se reescribe el dominio.
 */

import type { ExportDeliveryMethod, ExportSnapshotManifest } from "./snapshot.js";
import type { ReconciliationReport } from "./reconciliation.js";

/**
 * Campo del esquema de export.
 *
 * Es un objeto y no una cadena porque un nombre de campo no dice lo unico que
 * hay que saber antes de entregarlo: si lleva datos personales y quien lo pidio.
 * Con una lista de cadenas, anadir `email` al export es un cambio de una linea
 * que nadie revisa; con esto, anadirlo obliga a escribir por que.
 */
export interface ExportSchemaField {
  readonly name: string;
  /**
   * `true` si el administrador externo lo EXIGE. Los campos opcionales son
   * opt-in: por defecto no viajan, aunque existan en la base de datos.
   */
  readonly required: boolean;
  readonly containsPii: boolean;
  /** Por que este campo tiene que salir de nuestros sistemas. Se revisa. */
  readonly justification: string;
}

/**
 * Esquema de export acordado con el administrador. Minimizacion de PII.
 *
 * El esquema es DATO VERSIONADO, no codigo: el administrador todavia no esta
 * elegido (`docs/LEGAL_PENDING.md`) y sus requisitos llegaran como
 * configuracion. Lo que si es codigo es la regla de minimizacion, que se
 * comprueba antes de entregar nada.
 */
export interface ExportSchemaDescriptor {
  readonly name: string;
  readonly version: number;
  readonly fields: readonly ExportSchemaField[];
  /** Clave de orden. Debe distinguir cada registro (DEC-016). */
  readonly sortFields: readonly string[];
}

export function exportSchemaFieldNames(schema: ExportSchemaDescriptor): readonly string[] {
  return schema.fields.map((field) => field.name);
}

export function exportSchemaContainsPii(schema: ExportSchemaDescriptor): boolean {
  return schema.fields.some((field) => field.containsPii);
}

/**
 * Esquema minimo por defecto: NINGUN dato personal.
 *
 * Una referencia interna de participante, la promocion y el numero de entries.
 * Con esto un administrador puede sortear y devolvernos a quien le toco; el
 * nombre y el correo los pedimos nosotros despues, si su proceso los exige, y
 * entonces sera una decision explicita con su justificacion escrita.
 *
 * Los nombres de campo coinciden con los del artefacto de `@lsw/audit` porque
 * el esquema es lo que se le pasa al generador: dos vocabularios distintos para
 * lo mismo obligarian a un mapeo, y un mapeo es un sitio donde equivocarse.
 */
export const MINIMAL_EXPORT_SCHEMA_V1: ExportSchemaDescriptor = Object.freeze({
  name: "lsw.minimal",
  version: 1,
  fields: Object.freeze([
    Object.freeze({
      name: "participant_reference",
      required: true,
      containsPii: false,
      justification:
        "Identificador interno estable. Permite al administrador devolvernos el resultado sin " +
        "que ningun dato identificativo salga de nuestros sistemas.",
    }),
    Object.freeze({
      name: "promotion_id",
      required: true,
      containsPii: false,
      justification: "Sin la promocion, el universo entregado no se puede situar.",
    }),
    Object.freeze({
      name: "eligible_entries",
      required: true,
      containsPii: false,
      justification: "Es el peso de cada participante en el sorteo.",
    }),
  ]),
  sortFields: Object.freeze(["participant_reference"]),
});

export class ExportSchemaMinimizationError extends Error {
  public constructor(detail: string) {
    super(detail);
    this.name = "ExportSchemaMinimizationError";
  }
}

/**
 * Comprueba la minimizacion antes de generar nada.
 *
 * Dos reglas, y las dos han sido reglas de sentido comun que alguien se salta
 * bajo presion de entrega:
 *
 *   1. un campo con datos personales tiene que ser EXIGIDO por el
 *      administrador; si es opcional y lleva PII, no viaja;
 *   2. todo campo lleva justificacion escrita, PII o no. La justificacion es lo
 *      que un dia permite responder "por que sale este dato de aqui".
 */
export function assertExportSchemaMinimized(schema: ExportSchemaDescriptor): void {
  if (schema.fields.length === 0) {
    throw new ExportSchemaMinimizationError("El esquema de export no declara ningun campo.");
  }
  for (const field of schema.fields) {
    if (field.justification.trim().length < 20) {
      throw new ExportSchemaMinimizationError(
        `El campo '${field.name}' no explica por que viaja. Un esquema sin justificaciones es ` +
          "una lista de columnas que nadie ha revisado.",
      );
    }
    if (field.containsPii && !field.required) {
      throw new ExportSchemaMinimizationError(
        `El campo '${field.name}' lleva datos personales y no es exigido por el administrador. ` +
          "Lo opcional con PII no sale: minimizacion no es enviar todo lo que tenemos por si acaso.",
      );
    }
  }
  const names = new Set(schema.fields.map((field) => field.name));
  const outside = schema.sortFields.filter((field) => !names.has(field));
  if (outside.length > 0) {
    throw new ExportSchemaMinimizationError(
      `La clave de orden usa campos que no viajan: ${outside.join(", ")}.`,
    );
  }
  if (schema.sortFields.length === 0) {
    throw new ExportSchemaMinimizationError(
      "El esquema no declara clave de orden: sin ella el orden de las filas dependeria de la " +
        "consulta y DEC-016 dejaria de cumplirse.",
    );
  }
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
