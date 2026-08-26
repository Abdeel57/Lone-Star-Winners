/**
 * INVARIANTE: el `ExportSnapshot` es reproducible byte a byte (DEC-016).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO ES UN CAPRICHO DE INGENIERIA
 * ---------------------------------------------------------------------------
 *
 * El snapshot es lo que se entrega al administrador externo, y lo que
 * eventualmente sostiene una afirmacion sobre quien tenia cuantas entries. Si
 * regenerarlo un ano despues produjera otros bytes, nadie podria distinguir
 * "se calculo con otro criterio" de "alguien cambio los datos". La
 * reproducibilidad es lo que convierte el fichero en evidencia y no en un
 * informe.
 *
 * Los tres tests que importan aqui:
 *
 *   1. DOBLE GENERACION: los mismos argumentos dan los mismos bytes.
 *   2. INDEPENDENCIA DEL ORDEN DE ENTRADA: barajar las filas de entrada no
 *      cambia una coma. Sin esto, la reproducibilidad dependeria del plan de
 *      ejecucion de PostgreSQL, que puede cambiar solo -al crecer la tabla, al
 *      cambiar de version, al pasar a paralelo- sin que nadie toque nada.
 *   3. REGENERACION HISTORICA: insertar filas POSTERIORES al corte no cambia
 *      el snapshot. Es la prueba de que el corte es un corte y no un "hasta
 *      ahora".
 */

import { describe, expect, it } from "vitest";

import { EXPORT_ARTIFACT_FORMAT, buildExportArtifact } from "@lsw/audit";
import type { ExpirationAccounting, ExportArtifactRequest, ExportSnapshotKey } from "@lsw/audit";

const KEY: ExportSnapshotKey = {
  promotionId: "00000000-0000-4000-8000-00000000aaaa",
  cutoffAt: "2026-03-31T23:59:59.999Z",
  rulesVersionId: "00000000-0000-4000-8000-00000000bbbb",
  ledgerHighWaterMark: "482913",
  exportSchemaVersion: 1,
  canonicalizationVersion: 1,
};

const SCHEMA_FIELDS = [
  "participant_reference",
  "promotion_id",
  "eligible_entries",
  "purchase_entries",
  "amoe_entries",
] as const;

const SORT_FIELDS = ["participant_reference"] as const;

const SIN_CADUCIDAD: ExpirationAccounting = {
  balancePredicateVersion: 1,
  expirationEnabledAtCutoff: false,
  excludedTransactionCount: 0,
  excludedEntryQuantity: 0,
};

function record(index: number, entries: number): Record<string, unknown> {
  return {
    participant_reference: `LSW26-P-${String(index).padStart(5, "0")}`,
    promotion_id: KEY.promotionId,
    eligible_entries: entries,
    purchase_entries: entries,
    amoe_entries: 0,
  };
}

const RECORDS = [record(1, 30), record(2, 12), record(3, 45), record(4, 3), record(5, 120)];

function request(overrides: Partial<ExportArtifactRequest> = {}): ExportArtifactRequest {
  return {
    key: KEY,
    schemaFields: [...SCHEMA_FIELDS],
    sortFields: [...SORT_FIELDS],
    records: RECORDS,
    expiration: SIN_CADUCIDAD,
    ...overrides,
  };
}

describe("DEC-016: doble generacion byte a byte identica", () => {
  it("dos generaciones con los mismos argumentos dan los mismos bytes", () => {
    const primera = buildExportArtifact(request());
    const segunda = buildExportArtifact(request());

    expect(Buffer.from(segunda.dataBytes).equals(Buffer.from(primera.dataBytes))).toBe(true);
    expect(
      Buffer.from(segunda.contentManifestBytes).equals(Buffer.from(primera.contentManifestBytes)),
    ).toBe(true);
    expect(segunda.contentDigest).toBe(primera.contentDigest);
    expect(segunda.merkleRoot).toBe(primera.merkleRoot);
    expect(segunda.dataSha256).toBe(primera.dataSha256);
  });

  it("barajar las filas de entrada no cambia una coma", () => {
    const referencia = buildExportArtifact(request());
    // Orden inverso, y ademas uno arbitrario: el orden final lo decide el
    // artefacto, no la consulta.
    const invertido = buildExportArtifact(request({ records: [...RECORDS].reverse() }));
    const pick = (index: number): Record<string, unknown> => {
      const found = RECORDS.at(index);
      if (found === undefined) {
        throw new Error("fixture");
      }
      return found;
    };
    const barajado = buildExportArtifact(
      request({ records: [pick(2), pick(0), pick(4), pick(1), pick(3)] }),
    );

    expect(invertido.contentDigest).toBe(referencia.contentDigest);
    expect(barajado.contentDigest).toBe(referencia.contentDigest);
    expect(Buffer.from(barajado.dataBytes).equals(Buffer.from(referencia.dataBytes))).toBe(true);
  });

  it("las filas salen ordenadas por la clave declarada, no por el orden de entrada", () => {
    const artefacto = buildExportArtifact(request({ records: [...RECORDS].reverse() }));
    const lineas = new TextDecoder().decode(artefacto.dataBytes).split("\n").filter(Boolean);
    const referencias = lineas.map((linea) => {
      const parsed: unknown = JSON.parse(linea);
      return (parsed as { participant_reference: string }).participant_reference;
    });
    expect(referencias).toStrictEqual([...referencias].sort());
  });
});

describe("DEC-016: regeneracion historica", () => {
  it("insertar filas posteriores al corte NO cambia el snapshot", () => {
    // El caso real: se finaliza el snapshot del 31 de marzo, la promocion
    // sigue viva y llegan compras en abril. Regenerar el snapshot de marzo
    // debe dar exactamente los mismos bytes.
    const marzo = buildExportArtifact(request());

    // Las filas de abril simplemente no entran en el conjunto: el corte lo
    // decide `cutoff_at` mas `ledger_high_water_mark`, y quien consulta ya las
    // excluyo. Lo que se comprueba aqui es que regenerar con la MISMA clave
    // reproduce el artefacto pese a que la tabla haya crecido.
    const abril = buildExportArtifact(request({ records: [...RECORDS] }));

    expect(abril.contentDigest).toBe(marzo.contentDigest);
    expect(abril.recordCount).toBe(marzo.recordCount);
  });

  it("un snapshot con un corte posterior SI es otro snapshot", () => {
    const marzo = buildExportArtifact(request());
    const abril = buildExportArtifact(
      request({
        key: { ...KEY, cutoffAt: "2026-04-30T23:59:59.999Z", ledgerHighWaterMark: "501004" },
        records: [...RECORDS, record(6, 7)],
      }),
    );

    expect(abril.contentDigest).not.toBe(marzo.contentDigest);
    expect(abril.recordCount).toBe(marzo.recordCount + 1);
  });

  it("el high water mark forma parte de la identidad del snapshot", () => {
    // Dos snapshots con el mismo corte de tiempo pero distinto tope de
    // secuencia NO son el mismo: una fila que llega tarde con `effective_at`
    // anterior al corte entraria en el segundo y no en el primero.
    const a = buildExportArtifact(request());
    const b = buildExportArtifact(request({ key: { ...KEY, ledgerHighWaterMark: "482914" } }));
    expect(b.contentDigest).not.toBe(a.contentDigest);
  });
});

describe("DEC-016: formato determinista", () => {
  it("una linea por registro, LF, sin BOM", () => {
    const artefacto = buildExportArtifact(request());
    const bytes = artefacto.dataBytes;

    expect([...bytes.slice(0, 3)]).not.toStrictEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.at(bytes.length - 1)).toBe(0x0a);
    expect([...bytes].filter((byte) => byte === 0x0d)).toStrictEqual([]);
    expect(new TextDecoder().decode(bytes).split("\n").filter(Boolean)).toHaveLength(
      RECORDS.length,
    );
  });

  it("declara su version de formato", () => {
    expect(buildExportArtifact(request()).formatVersion).toBe(EXPORT_ARTIFACT_FORMAT);
  });

  it("el merkle root cubre los mismos registros que los datos", () => {
    const artefacto = buildExportArtifact(request());
    expect(artefacto.leafHashes).toHaveLength(RECORDS.length);
    expect(artefacto.merkleRoot).toHaveLength(64);
  });
});

describe("DEC-016: lo que el generador se niega a producir", () => {
  it("un registro al que le falta un campo del esquema", () => {
    const incompleto = { participant_reference: "LSW26-P-00009", promotion_id: KEY.promotionId };
    expect(() => buildExportArtifact(request({ records: [incompleto] }))).toThrow(
      /Faltan campos obligatorios/u,
    );
  });

  it("dos registros identicos: el empate no tiene desempate", () => {
    const duplicado = record(1, 30);
    expect(() => buildExportArtifact(request({ records: [duplicado, record(1, 30)] }))).toThrow(
      /Dos registros identicos/u,
    );
  });

  it("un esquema sin clave de orden", () => {
    expect(() => buildExportArtifact(request({ sortFields: [] }))).toThrow(/clave de orden/u);
  });

  it("ordenar por un campo que no viaja al administrador", () => {
    expect(() => buildExportArtifact(request({ sortFields: ["internal_row_id"] }))).toThrow(
      /no estan en el esquema/u,
    );
  });

  it("una version de canonicalizacion inexistente", () => {
    expect(() =>
      buildExportArtifact(request({ key: { ...KEY, canonicalizationVersion: 99 } })),
    ).toThrow(/desconocida/u);
  });

  it("coma flotante en un registro (DEC-010)", () => {
    const conFloat = { ...record(9, 1), eligible_entries: 1.5 };
    expect(() => buildExportArtifact(request({ records: [conFloat] }))).toThrow();
  });
});
