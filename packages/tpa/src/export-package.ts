/**
 * El paquete que se entrega al administrador externo (DEC-016, DEC-035/036).
 *
 * ---------------------------------------------------------------------------
 * QUE LLEVA DENTRO, Y POR QUE CADA COSA
 * ---------------------------------------------------------------------------
 *
 *   `manifest.json`        el MANIFIESTO DE CONTENIDO, tal cual lo produce
 *                          `@lsw/audit`. Sus bytes son los que se resumen en
 *                          `content_digest`. No lleva marcas de generacion, y
 *                          por eso dos generaciones del mismo corte coinciden.
 *   `entries.jsonl`        los datos canonicos: una linea por registro, en el
 *                          orden que fija el artefacto. Es lo que cubre
 *                          `data_sha256` y el merkle root.
 *   `entries.csv`          los MISMOS registros, en el mismo orden, en el
 *                          formato que casi cualquier administrador puede
 *                          abrir. Se deriva del artefacto ya ordenado, no de
 *                          una segunda consulta: dos consultas pueden diferir
 *                          en contenido, y el dia que difieran nadie sabria
 *                          cual de los dos ficheros era el snapshot.
 *   `reconciliation.json`  el informe que se ejecuto antes de finalizar.
 *   `reconciliation.md`    el mismo informe para leerlo. Se genera del mismo
 *                          objeto, no se escribe a mano.
 *   `rules_version.json`   que version de las Official Rules gobernaba el
 *                          corte. Sin esto, el universo entregado no significa
 *                          nada: las mismas compras dan entries distintas bajo
 *                          reglas distintas.
 *   `provenance.json`      quien genero el paquete, cuando y con que clave.
 *   `CHECKSUMS.txt`        SHA-256 de cada miembro anterior.
 *
 * ---------------------------------------------------------------------------
 * QUE SE REPRODUCE Y QUE NO, DICHO EN VOZ ALTA
 * ---------------------------------------------------------------------------
 *
 * DEC-016 pide bytes identicos al regenerar. DEC-035/036 explican por que eso
 * no puede incluir la procedencia: dos generaciones del mismo corte son dos
 * ACTOS distintos sobre el mismo contenido, y la procedencia describe el acto.
 *
 * Por eso el paquete declara `reproducibleMemberNames`: los miembros que deben
 * salir byte a byte iguales, que son todos menos `provenance.json` y
 * `CHECKSUMS.txt` -este ultimo solo porque contiene el hash del primero-. Y
 * `packageContentDigest` resume exactamente ese subconjunto.
 *
 * Decirlo asi, con una lista explicita, evita la conversacion en la que alguien
 * regenera el paquete, ve que el ZIP tiene otro hash y concluye que el sistema
 * no es reproducible.
 */

import { createHash } from "node:crypto";

import type { ExportPackageMember } from "./ports.js";
import type { ReconciliationReport } from "./reconciliation.js";

const encoder = new TextEncoder();

export const EXPORT_PACKAGE_FORMAT = "LSW/EXPORT/PACKAGE/v1";

export const PACKAGE_MEMBER_NAMES = Object.freeze({
  MANIFEST: "manifest.json",
  ENTRIES_JSONL: "entries.jsonl",
  ENTRIES_CSV: "entries.csv",
  RECONCILIATION_JSON: "reconciliation.json",
  RECONCILIATION_MD: "reconciliation.md",
  RULES_VERSION: "rules_version.json",
  PROVENANCE: "provenance.json",
  CHECKSUMS: "CHECKSUMS.txt",
} as const);

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function member(name: string, bytes: Uint8Array): ExportPackageMember {
  return { name, bytes, sha256: sha256Hex(bytes) };
}

/**
 * Vista del artefacto que produce `@lsw/audit`.
 *
 * Se declara aqui, y no se importa, por la misma razon que el resto de puertos:
 * este paquete no depende de aquel. La compatibilidad es estructural y el punto
 * de montaje es quien la comprueba.
 */
export interface ExportArtifactView {
  readonly contentDigest: string;
  readonly contentManifestBytes: Uint8Array;
  readonly dataBytes: Uint8Array;
  readonly dataSha256: string;
  readonly merkleRoot: string;
  readonly recordCount: number;
  readonly orderedRecords: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Que hacer con un valor de texto que empieza por un caracter que Excel
 * interpretaria como formula.
 *
 * `REFUSE` es el valor por defecto y hoy no se dispara nunca, porque el esquema
 * minimo solo lleva identificadores internos y enteros. Existe para el dia que
 * alguien anada un campo de texto libre -un nombre- al esquema: ese dia hay que
 * decidir a proposito entre romper el export o alterar el dato que se entrega,
 * y ninguna de las dos cosas debe pasar en silencio.
 */
export type CsvFormulaGuard = "REFUSE" | "PREFIX_APOSTROPHE";

const FORMULA_STARTERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function csvCell(value: unknown, field: string, guard: CsvFormulaGuard): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `El campo ${field} lleva un numero que no es entero seguro (${String(value)}). DEC-010 ` +
          "prohibe la coma flotante en entries y en dinero, y un CSV con notacion cientifica " +
          "es ademas irreproducible entre implementaciones.",
      );
    }
    return value.toString(10);
  }
  if (typeof value !== "string") {
    throw new Error(
      `El campo ${field} lleva un valor de tipo ${typeof value}, que no tiene una unica ` +
        "representacion razonable en CSV. Los esquemas de export son planos a proposito.",
    );
  }

  let text = value;
  const firstCharacter = text.slice(0, 1);
  if (FORMULA_STARTERS.has(firstCharacter)) {
    if (guard === "REFUSE") {
      throw new Error(
        `El campo ${field} empieza por ${JSON.stringify(firstCharacter)} y una hoja de calculo ` +
          "lo interpretaria como formula. Decide a proposito: sanea el dato en origen, o " +
          "configura PREFIX_APOSTROPHE sabiendo que el valor entregado dejara de ser identico " +
          "al almacenado.",
      );
    }
    text = `'${text}`;
  }

  if (/["\n\r,]/u.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/**
 * CSV derivado del artefacto YA ordenado.
 *
 * Saltos `LF`, no `CRLF`. RFC 4180 pide `CRLF`, pero DEC-016 fija `LF` para
 * todo el export y una sola convencion en el paquete vale mas que la letra de
 * un RFC que todos los lectores de CSV toleran. Va escrito aqui para que nadie
 * lo "corrija" mas adelante y cambie el hash de un artefacto ya entregado.
 */
export function renderEntriesCsv(input: {
  readonly schemaFields: readonly string[];
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly guard?: CsvFormulaGuard;
}): Uint8Array {
  const guard = input.guard ?? "REFUSE";
  const lines: string[] = [
    input.schemaFields.map((field) => csvCell(field, field, guard)).join(","),
  ];

  for (const record of input.records) {
    // `Map` en vez de acceso indexado: la fila viene de la base de datos y el
    // campo de un esquema configurable. Un objeto llano con clave calculada es
    // justo el patron que persigue `security/detect-object-injection`.
    const source = new Map(Object.entries(record));
    const cells: string[] = [];
    for (const field of input.schemaFields) {
      if (!source.has(field)) {
        throw new Error(
          `Falta el campo ${field} en un registro del export. Un campo ausente no se rellena ` +
            "con vacio: el esquema declara lo que viaja, y lo que declara tiene que estar.",
        );
      }
      cells.push(csvCell(source.get(field), field, guard));
    }
    lines.push(cells.join(","));
  }

  return encoder.encode(`${lines.join("\n")}\n`);
}

/** Informe legible. Se genera del mismo objeto que el JSON, nunca a mano. */
export function renderReconciliationMarkdown(report: ReconciliationReport): Uint8Array {
  const lines: string[] = [
    `# Reconciliacion del snapshot ${report.snapshotId}`,
    "",
    `- Promocion: ${report.promotionId}`,
    `- Corte (UTC): ${report.cutoffAt}`,
    `- Ultima transaccion incluida: ${report.ledgerHighWaterMark}`,
    `- Bloquea la finalizacion: ${report.blocksFinalization ? "SI" : "no"}`,
    "",
    "## Totales del universo elegible",
    "",
    `- Participantes: ${String(report.totals.participantCount)}`,
    `- Lotes de entries: ${String(report.totals.entryBatchCount)}`,
    `- Entries de compra: ${String(report.totals.purchaseSourceEntries)}`,
    `- Entries de AMOE: ${String(report.totals.amoeSourceEntries)}`,
    `- Entries de ajuste administrativo: ${String(report.totals.adminSourceEntries)}`,
    `- Entries de sistema: ${String(report.totals.systemSourceEntries)}`,
    `- Reversals: ${String(report.totals.reversalEntries)}`,
    `- TOTAL elegible: ${String(report.totals.totalEligibleEntries)}`,
    "",
    "## Caducidad (DEC-033 / DEC-034)",
    "",
    "La caducidad baja el saldo SIN escribir fila. Quien sume los deltas del ledger obtendra un",
    "numero mayor que el total de arriba, y la diferencia es exactamente esta seccion.",
    "",
    `- Version del predicado de saldo: ${String(report.expiration.predicateVersion)}`,
    `- Caducidad activa en el corte: ${report.expiration.expirationEnabledAtCutoff ? "si" : "no"}`,
    `- Transacciones excluidas: ${String(report.expiration.excludedTransactionCount)}`,
    `- Entries excluidas: ${String(report.expiration.excludedEntryQuantity)}`,
    `- Participantes afectados: ${String(report.expiration.affectedParticipantCount)}`,
    "",
    "## Hallazgos",
    "",
  ];

  if (report.findings.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`);
    }
  }
  lines.push("");

  return encoder.encode(lines.join("\n"));
}

/** `CHECKSUMS.txt` en el formato de `sha256sum`: hash, dos espacios, nombre. */
export function renderChecksums(members: readonly ExportPackageMember[]): Uint8Array {
  const sorted = [...members].sort((left, right) => (left.name < right.name ? -1 : 1));
  return encoder.encode(`${sorted.map((item) => `${item.sha256}  ${item.name}`).join("\n")}\n`);
}

export interface ExportPackage {
  readonly formatVersion: string;
  readonly fileName: string;
  readonly members: readonly ExportPackageMember[];
  /** Miembros que DEBEN salir identicos al regenerar. Ver la cabecera. */
  readonly reproducibleMemberNames: readonly string[];
  /** Resumen de ese subconjunto. Es la identidad reproducible del paquete. */
  readonly packageContentDigest: string;
  readonly contentDigest: string;
  readonly merkleRoot: string;
  readonly recordCount: number;
}

export interface BuildExportPackageInput {
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly schemaFields: readonly string[];
  readonly artifact: ExportArtifactView;
  readonly reconciliation: ReconciliationReport;
  /** Documento de la version de reglas: identificador, hash y vigencia. */
  readonly rulesVersion: Readonly<Record<string, unknown>>;
  /** Procedencia ya canonicalizada por `@lsw/audit`. NO entra en el digest. */
  readonly provenanceBytes: Uint8Array;
  readonly csvFormulaGuard?: CsvFormulaGuard;
}

/**
 * Construye el paquete. Funcion pura: mismos argumentos, mismos bytes.
 *
 * No lee el reloj ni genera identificadores. Si los generase, dos llamadas con
 * los mismos argumentos producirian paquetes distintos, y la reproducibilidad
 * se perderia sin que ningun test lo notara.
 */
export function buildExportPackage(input: BuildExportPackageInput): ExportPackage {
  const entriesCsv = renderEntriesCsv({
    schemaFields: input.schemaFields,
    records: input.artifact.orderedRecords,
    ...(input.csvFormulaGuard === undefined ? {} : { guard: input.csvFormulaGuard }),
  });

  const reproducible: ExportPackageMember[] = [
    member(PACKAGE_MEMBER_NAMES.MANIFEST, input.artifact.contentManifestBytes),
    member(PACKAGE_MEMBER_NAMES.ENTRIES_JSONL, input.artifact.dataBytes),
    member(PACKAGE_MEMBER_NAMES.ENTRIES_CSV, entriesCsv),
    member(
      PACKAGE_MEMBER_NAMES.RECONCILIATION_JSON,
      encoder.encode(`${JSON.stringify(input.reconciliation, null, 2)}\n`),
    ),
    member(
      PACKAGE_MEMBER_NAMES.RECONCILIATION_MD,
      renderReconciliationMarkdown(input.reconciliation),
    ),
    member(
      PACKAGE_MEMBER_NAMES.RULES_VERSION,
      encoder.encode(`${JSON.stringify(input.rulesVersion, null, 2)}\n`),
    ),
  ];

  const provenance = member(PACKAGE_MEMBER_NAMES.PROVENANCE, input.provenanceBytes);
  const withProvenance = [...reproducible, provenance];
  const checksums = member(PACKAGE_MEMBER_NAMES.CHECKSUMS, renderChecksums(withProvenance));

  const digestInput = reproducible.map((item) => `${item.sha256}  ${item.name}`).join("\n");

  return {
    formatVersion: EXPORT_PACKAGE_FORMAT,
    fileName: `lsw-export-${input.snapshotId}-v${String(input.snapshotVersion)}`,
    members: [...withProvenance, checksums],
    reproducibleMemberNames: reproducible.map((item) => item.name),
    packageContentDigest: createHash("sha256")
      .update(`${EXPORT_PACKAGE_FORMAT}\n`)
      .update(digestInput)
      .digest("hex"),
    contentDigest: input.artifact.contentDigest,
    merkleRoot: input.artifact.merkleRoot,
    recordCount: input.artifact.recordCount,
  };
}
