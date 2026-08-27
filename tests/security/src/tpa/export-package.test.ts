/**
 * El paquete entregable: que se reproduce, que no, y por que la diferencia
 * tiene que estar escrita (DEC-016, DEC-035, DEC-036).
 *
 * ---------------------------------------------------------------------------
 * LA CONVERSACION QUE ESTOS TESTS EVITAN
 * ---------------------------------------------------------------------------
 *
 * Dentro de un ano alguien regenera el export de junio para comprobar una
 * afirmacion, ve que el ZIP tiene otro SHA-256 y concluye que el sistema no es
 * reproducible. Tiene razon a medias, y esa mitad es peligrosa: lo que cambia
 * es la PROCEDENCIA -quien lo genero y cuando-, que describe el acto de generar
 * y no el contenido generado.
 *
 * Por eso el paquete declara `reproducibleMemberNames` y un
 * `packageContentDigest` que cubre exactamente ese subconjunto. Estos tests
 * fijan las dos cosas: lo que debe coincidir byte a byte, y lo que debe
 * diferir.
 */

import { describe, expect, it } from "vitest";

import {
  buildExportPackage,
  buildReconciliationReport,
  packDeterministicZip,
  PACKAGE_MEMBER_NAMES,
  renderEntriesCsv,
  runReconciliationChecks,
  type ExportPackage,
} from "@lsw/tpa";

import {
  ARTIFACT,
  provenanceBytes,
  reconciliationInputs,
  RULES_VERSION_DOCUMENT,
  SCHEMA_FIELDS,
} from "../helpers/export-fixtures.js";
import { SNAPSHOT_ID } from "../helpers/draw-fixtures.js";

const inputs = reconciliationInputs();
const REPORT = buildReconciliationReport({
  snapshotId: SNAPSHOT_ID,
  promotionId: inputs.entryRanges.at(0)?.batchId ?? "promo",
  cutoffAt: "2026-05-31T23:59:59.999Z",
  ledgerHighWaterMark: "128",
  totals: inputs.totals,
  expiration: inputs.expiration,
  findings: runReconciliationChecks(inputs),
});

function build(generatedAt: string): ExportPackage {
  return buildExportPackage({
    snapshotId: SNAPSHOT_ID,
    snapshotVersion: 1,
    schemaFields: SCHEMA_FIELDS,
    artifact: ARTIFACT,
    reconciliation: REPORT,
    rulesVersion: RULES_VERSION_DOCUMENT,
    provenanceBytes: provenanceBytes(generatedAt),
  });
}

function memberOf(packaged: ExportPackage, name: string): Uint8Array {
  const found = packaged.members.find((item) => item.name === name);
  if (found === undefined) {
    throw new Error(`El paquete no contiene ${name}`);
  }
  return found.bytes;
}

const decoder = new TextDecoder();

describe("que lleva el paquete", () => {
  const packaged = build("2026-06-01T11:00:00.000Z");

  it("los ocho miembros, en orden declarado", () => {
    expect(packaged.members.map((item) => item.name)).toStrictEqual([
      PACKAGE_MEMBER_NAMES.MANIFEST,
      PACKAGE_MEMBER_NAMES.ENTRIES_JSONL,
      PACKAGE_MEMBER_NAMES.ENTRIES_CSV,
      PACKAGE_MEMBER_NAMES.RECONCILIATION_JSON,
      PACKAGE_MEMBER_NAMES.RECONCILIATION_MD,
      PACKAGE_MEMBER_NAMES.RULES_VERSION,
      PACKAGE_MEMBER_NAMES.PROVENANCE,
      PACKAGE_MEMBER_NAMES.CHECKSUMS,
    ]);
  });

  it("`manifest.json` y `entries.jsonl` son EXACTAMENTE los bytes que se firman", () => {
    // No una copia reserializada: los mismos bytes cuyo resumen es el
    // `content_digest`. Reserializarlos abriria la puerta a que el fichero
    // entregado y el fichero hasheado dejaran de ser el mismo.
    expect(
      Buffer.from(memberOf(packaged, PACKAGE_MEMBER_NAMES.MANIFEST)).equals(
        Buffer.from(ARTIFACT.contentManifestBytes),
      ),
    ).toBe(true);
    expect(
      Buffer.from(memberOf(packaged, PACKAGE_MEMBER_NAMES.ENTRIES_JSONL)).equals(
        Buffer.from(ARTIFACT.dataBytes),
      ),
    ).toBe(true);
  });

  it("el CSV sale de los mismos registros ordenados, no de otra consulta", () => {
    const csv = decoder.decode(memberOf(packaged, PACKAGE_MEMBER_NAMES.ENTRIES_CSV));
    const lines = csv.split("\n").filter((line) => line !== "");

    expect(lines.at(0)).toBe(SCHEMA_FIELDS.join(","));
    expect(lines).toHaveLength(ARTIFACT.recordCount + 1);

    const jsonl = decoder
      .decode(memberOf(packaged, PACKAGE_MEMBER_NAMES.ENTRIES_JSONL))
      .split("\n")
      .filter((line) => line !== "");
    const referencesFromJsonl = jsonl.map((line) => {
      const parsed: unknown = JSON.parse(line);
      return (parsed as { participant_reference: string }).participant_reference;
    });
    const referencesFromCsv = lines.slice(1).map((line) => line.split(",").at(0));

    expect(referencesFromCsv).toStrictEqual(referencesFromJsonl);
  });

  it("`CHECKSUMS.txt` cubre a todos los demas y no a si mismo", () => {
    const checksums = decoder
      .decode(memberOf(packaged, PACKAGE_MEMBER_NAMES.CHECKSUMS))
      .split("\n")
      .filter((line) => line !== "");

    expect(checksums).toHaveLength(packaged.members.length - 1);
    expect(checksums.join("\n")).not.toContain(PACKAGE_MEMBER_NAMES.CHECKSUMS);
    for (const line of checksums) {
      expect(line).toMatch(/^[0-9a-f]{64} {2}[A-Za-z0-9._-]+$/u);
    }
  });

  it("el informe legible sale del mismo objeto que el JSON", () => {
    const markdown = decoder.decode(memberOf(packaged, PACKAGE_MEMBER_NAMES.RECONCILIATION_MD));
    expect(markdown).toContain(`# Reconciliacion del snapshot ${SNAPSHOT_ID}`);
    expect(markdown).toContain("TOTAL elegible: 20");
    // La caducidad tiene seccion propia aunque valga cero (DEC-033 / DEC-034).
    expect(markdown).toContain("Entries excluidas: 0");
  });
});

describe("reproducibilidad: lo que coincide y lo que no", () => {
  const first = build("2026-06-01T11:00:00.000Z");
  const second = build("2027-01-15T08:30:00.000Z");

  it("los miembros reproducibles salen byte a byte identicos", () => {
    expect(first.reproducibleMemberNames).toStrictEqual([
      PACKAGE_MEMBER_NAMES.MANIFEST,
      PACKAGE_MEMBER_NAMES.ENTRIES_JSONL,
      PACKAGE_MEMBER_NAMES.ENTRIES_CSV,
      PACKAGE_MEMBER_NAMES.RECONCILIATION_JSON,
      PACKAGE_MEMBER_NAMES.RECONCILIATION_MD,
      PACKAGE_MEMBER_NAMES.RULES_VERSION,
    ]);

    for (const name of first.reproducibleMemberNames) {
      expect(
        Buffer.from(memberOf(second, name)).equals(Buffer.from(memberOf(first, name))),
        `${name} deberia ser identico entre dos generaciones`,
      ).toBe(true);
    }
  });

  it("`packageContentDigest` es el mismo pese a generarse siete meses despues", () => {
    expect(second.packageContentDigest).toBe(first.packageContentDigest);
    expect(second.contentDigest).toBe(first.contentDigest);
  });

  it("la procedencia SI difiere, y debe diferir: son dos actos distintos", () => {
    expect(
      Buffer.from(memberOf(second, PACKAGE_MEMBER_NAMES.PROVENANCE)).equals(
        Buffer.from(memberOf(first, PACKAGE_MEMBER_NAMES.PROVENANCE)),
      ),
    ).toBe(false);
  });
});

describe("el contenedor ZIP es determinista", () => {
  const packaged = build("2026-06-01T11:00:00.000Z");

  it("empaquetar dos veces los mismos miembros da los mismos bytes", () => {
    const a = packDeterministicZip(packaged.members);
    const b = packDeterministicZip(packaged.members);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
  });

  it("no lleva marcas de tiempo del reloj: la fecha de todos los miembros es fija", () => {
    const zip = Buffer.from(packDeterministicZip(packaged.members));

    // Cabecera local: firma PK\x03\x04, y en los offsets 10 y 12 la hora y la
    // fecha MS-DOS. 0x0000 / 0x0021 = 1980-01-01 00:00:00 en todos.
    expect(zip.readUInt32LE(0)).toBe(0x0403_4b50);
    expect(zip.readUInt16LE(10)).toBe(0x0000);
    expect(zip.readUInt16LE(12)).toBe(0x0021);
    // Metodo 0 = almacenado, sin comprimir: sin dependencia del nivel de zlib.
    expect(zip.readUInt16LE(8)).toBe(0);
  });

  it("el directorio central declara los ocho miembros", () => {
    const zip = Buffer.from(packDeterministicZip(packaged.members));
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);
    expect(zip.readUInt16LE(eocd + 10)).toBe(packaged.members.length);
  });

  it("al ir sin comprimir, el contenido se puede leer del propio ZIP", () => {
    const zip = Buffer.from(packDeterministicZip(packaged.members));
    expect(zip.includes(Buffer.from("participant_reference,promotion_id,eligible_entries"))).toBe(
      true,
    );
  });

  it("se niega a empaquetar nombres con ruta o fuera de ASCII", () => {
    expect(() =>
      packDeterministicZip([
        { name: "sub/dir.txt", bytes: new Uint8Array([1]), sha256: "0".repeat(64) },
      ]),
    ).toThrow(/Nombre de miembro no admitido/u);
  });

  it("se niega a empaquetar un paquete vacio", () => {
    expect(() => packDeterministicZip([])).toThrow(/vacio/u);
  });
});

describe("el CSV no se convierte en un vector de ejecucion", () => {
  it("por defecto se niega ante un valor que una hoja de calculo leeria como formula", () => {
    expect(() =>
      renderEntriesCsv({
        schemaFields: ["participant_reference"],
        records: [{ participant_reference: '=HYPERLINK("http://x")' }],
      }),
    ).toThrow(/formula/u);
  });

  it("con PREFIX_APOSTROPHE se neutraliza, y se sabe que el dato entregado cambia", () => {
    const csv = new TextDecoder().decode(
      renderEntriesCsv({
        schemaFields: ["participant_reference"],
        records: [{ participant_reference: "=1+1" }],
        guard: "PREFIX_APOSTROPHE",
      }),
    );
    expect(csv).toContain("'=1+1");
  });

  it("las comas y las comillas se escapan segun RFC 4180", () => {
    const csv = new TextDecoder().decode(
      renderEntriesCsv({
        schemaFields: ["participant_reference"],
        records: [{ participant_reference: 'LSW, "26"' }],
      }),
    );
    expect(csv).toContain('"LSW, ""26"""');
  });

  it("un registro al que le falta un campo del esquema no se rellena con vacio", () => {
    expect(() =>
      renderEntriesCsv({
        schemaFields: ["participant_reference", "eligible_entries"],
        records: [{ participant_reference: "LSW26-P-00001" }],
      }),
    ).toThrow(/Falta el campo/u);
  });

  it("un decimal en el CSV es un error (DEC-010)", () => {
    expect(() =>
      renderEntriesCsv({
        schemaFields: ["eligible_entries"],
        records: [{ eligible_entries: 1.5 }],
      }),
    ).toThrow(/entero seguro/u);
  });
});
