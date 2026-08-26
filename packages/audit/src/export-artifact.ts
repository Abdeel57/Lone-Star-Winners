/**
 * Artefacto de export reproducible (DEC-016).
 *
 * ---------------------------------------------------------------------------
 * QUE ES UNA FUNCION PURA AQUI
 * ---------------------------------------------------------------------------
 *
 * DEC-016 dice que el `ExportSnapshot` es una funcion pura de
 * `(promotion_id, cutoff_at, rules_version_id, ledger_high_water_mark,
 * export_schema_version, canonicalization_version)`, y que regenerarlo dentro
 * de un ano debe producir BYTES IDENTICOS.
 *
 * Este modulo es esa funcion. Recibe los registros ya leidos -no consulta
 * nada- y devuelve bytes. Que no toque la base de datos no es purismo: es lo
 * que permite que un tercero con un volcado del ledger reproduzca el artefacto
 * y compare hashes sin acceso a nuestros sistemas. Un export que solo puede
 * regenerar quien lo genero no es evidencia de nada.
 *
 * ---------------------------------------------------------------------------
 * UNA CONTRADICCION DE DEC-016 QUE HABIA QUE RESOLVER
 * ---------------------------------------------------------------------------
 *
 * DEC-016 pide dos cosas que, literalmente, no caben juntas:
 *
 *   a) "ningun `generated_at` dentro de las filas de datos (solo en el
 *       manifiesto)";
 *   b) "regenerarlo en cualquier momento futuro debe producir bytes
 *       identicos".
 *
 * Si el manifiesto lleva `generated_at` y el manifiesto forma parte del
 * artefacto hasheado, dos generaciones del MISMO corte producen hashes
 * distintos y (b) es falso. La contradiccion es sutil porque (a) suena a que
 * el problema estaba resuelto al sacar la marca de las filas.
 *
 * Se resuelve partiendo el manifiesto en dos, no eligiendo entre (a) y (b):
 *
 *   - MANIFIESTO DE CONTENIDO (`contentManifestBytes`): describe QUE hay en el
 *     snapshot -clave de DEC-016, esquema, orden, numero de registros, merkle
 *     root, hash de los datos, contabilidad de caducidad-. No contiene una
 *     sola marca de tiempo de generacion. Es reproducible byte a byte, y es lo
 *     que se hashea y se firma.
 *
 *   - PROCEDENCIA (`buildProvenanceBytes`): quien lo genero, cuando, con que
 *     clave, que version de snapshot es y a cual sustituye. Acompana al
 *     artefacto, se guarda y se entrega, pero NO entra en el digest.
 *
 * La procedencia de la segunda generacion diferira de la de la primera, y debe
 * diferir: son dos actos distintos sobre el mismo contenido. Lo que no puede
 * diferir es el contenido.
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALE EL DETERMINISMO
 * ---------------------------------------------------------------------------
 *
 *   - ORDEN DE FILAS: no se confia en el `ORDER BY` de nadie. Las filas se
 *     ordenan aqui por la forma canonica de su clave de orden declarada, y en
 *     caso de empate por la forma canonica del registro completo. El orden en
 *     que lleguen es irrelevante, y hay un test que las baraja para
 *     demostrarlo.
 *
 *     Dos registros COMPLETAMENTE identicos serian un empate irresoluble, y
 *     ademas un error de la consulta que los produjo. Se rechazan.
 *
 *   - CAMPOS Y ORDEN DE CAMPOS: los fija `schemaFields`. Un registro al que le
 *     falte uno es un error, no un `null` de cortesia (minimizacion de PII: lo
 *     que no esta en el esquema no viaja, y lo que esta debe estar).
 *
 *   - CODIFICACION: UTF-8 sin BOM, saltos `LF`, un objeto canonico por linea
 *     (JSON Lines). Sin locale, sin coma flotante, fechas ISO-8601 UTC tal y
 *     como vengan del ledger.
 *
 *   - INTEGRIDAD: merkle root sobre el hash canonico de cada registro, para
 *     que el administrador externo pueda verificar UN participante sin recibir
 *     el fichero entero.
 *
 * ---------------------------------------------------------------------------
 * LA CADUCIDAD, QUE NO DEJA FILA (DEC-033 / DEC-034)
 * ---------------------------------------------------------------------------
 *
 * Una entry caducada baja el saldo sin que nadie escriba nada. La hash chain
 * encadena filas, asi que esa bajada es invisible para ella: un tercero puede
 * verificar la cadena entera, encontrarla intacta, y no hallar nada que
 * explique por que el total del snapshot es menor que la suma de los deltas.
 *
 * Por eso el manifiesto de contenido lleva `expiration` OBLIGATORIO: el corte,
 * la version del predicado, si la caducidad estaba activa, y cuantas entries
 * quedaron fuera por ella. Con eso el numero se vuelve reproducible; sin eso,
 * el snapshot afirma un total que nadie mas puede derivar.
 */

import { createHash } from "node:crypto";

import { canonicalizeToBytes } from "./canonical.js";
import type { CanonicalObject } from "./canonical.js";
import { canonicalizationDescriptor, projectCanonicalPayload } from "./canonicalization.js";
import { toHex } from "./chain.js";
import { merkleLeafHash, merkleRootFromLeaves } from "./merkle.js";

const encoder = new TextEncoder();

/** Version del formato del propio artefacto, independiente del esquema TPA. */
export const EXPORT_ARTIFACT_FORMAT = "LSW/EXPORT/JSONL/v1";

function sha256Hex(chunks: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** La tupla de DEC-016. Dos artefactos con la misma tupla son el mismo. */
export interface ExportSnapshotKey {
  readonly promotionId: string;
  /** Corte en ISO-8601 UTC. */
  readonly cutoffAt: string;
  readonly rulesVersionId: string;
  /** `sequence_no` maximo incluido, como cadena de digitos (es `bigint`). */
  readonly ledgerHighWaterMark: string;
  readonly exportSchemaVersion: number;
  readonly canonicalizationVersion: number;
}

/**
 * Contabilidad de la caducidad al corte.
 *
 * Es una LINEA PROPIA, no una nota. Con `entry_expiration_enabled` apagado
 * todos los valores son cero y la seccion sigue presente: su ausencia el dia
 * que el flag se encienda seria indistinguible de un cero, y esa es
 * exactamente la confusion que hay que evitar.
 */
export interface ExpirationAccounting {
  readonly balancePredicateVersion: number;
  readonly expirationEnabledAtCutoff: boolean;
  /** Transacciones POSTED excluidas por `expires_at <= corte`. */
  readonly excludedTransactionCount: number;
  /** Suma de `quantity_delta` que esas transacciones aportaban. Entero. */
  readonly excludedEntryQuantity: number;
}

export interface ExportArtifactRequest {
  readonly key: ExportSnapshotKey;
  /** Campos del esquema acordado con el administrador, en su orden declarado. */
  readonly schemaFields: readonly string[];
  /** Clave de orden. Debe distinguir cada registro; el desempate es el registro entero. */
  readonly sortFields: readonly string[];
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly expiration: ExpirationAccounting;
}

export interface ExportArtifact {
  readonly key: ExportSnapshotKey;
  readonly formatVersion: string;
  readonly recordCount: number;
  /** JSON Lines canonico, UTF-8 sin BOM, terminado en LF. */
  readonly dataBytes: Uint8Array;
  readonly dataSha256: string;
  /** Hash de hoja de cada registro, en el orden final. */
  readonly leafHashes: readonly string[];
  readonly merkleRoot: string;
  /** Manifiesto SIN marcas de generacion: reproducible byte a byte. */
  readonly contentManifestBytes: Uint8Array;
  readonly contentManifestSha256: string;
  /**
   * Identidad del snapshot en un solo valor. Es lo que se firma, lo que se
   * compara entre dos generaciones y lo que se guarda como evidencia.
   */
  readonly contentDigest: string;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

interface PreparedRecord {
  readonly canonical: Uint8Array;
  readonly sortKey: Uint8Array;
  readonly payload: CanonicalObject;
}

/**
 * Construye el artefacto. Funcion pura: mismos argumentos, mismos bytes.
 *
 * No recibe `generated_at`, `generated_by` ni identificadores de snapshot a
 * proposito. Si los recibiera, alguien acabaria metiendolos en el digest, y la
 * reproducibilidad se perderia de forma silenciosa un martes cualquiera.
 */
export function buildExportArtifact(request: ExportArtifactRequest): ExportArtifact {
  // Valida la version y, de paso, deja constancia de contra que descriptor se
  // construyo: si la version no existe, esto lanza antes de producir bytes.
  const descriptor = canonicalizationDescriptor(request.key.canonicalizationVersion);

  if (request.schemaFields.length === 0) {
    throw new Error("El esquema de export no declara ningun campo.");
  }
  if (request.sortFields.length === 0) {
    throw new Error(
      "El esquema de export no declara clave de orden: sin ella el orden de las filas " +
        "dependeria de la consulta, y DEC-016 dejaria de cumplirse.",
    );
  }
  const schema = new Set(request.schemaFields);
  const outsideSchema = request.sortFields.filter((field) => !schema.has(field));
  if (outsideSchema.length > 0) {
    throw new Error(
      `La clave de orden usa campos que no estan en el esquema: ${outsideSchema.join(", ")}. ` +
        "Ordenar por algo que no viaja hace el orden irreproducible para quien recibe.",
    );
  }
  if (request.expiration.balancePredicateVersion !== descriptor.balancePredicate.version) {
    throw new Error(
      `La contabilidad de caducidad declara predicado v${String(request.expiration.balancePredicateVersion)} ` +
        `y la canonicalizacion v${String(request.key.canonicalizationVersion)} usa ` +
        `v${String(descriptor.balancePredicate.version)}.`,
    );
  }

  const prepared: PreparedRecord[] = request.records.map((record) => {
    const payload = projectCanonicalPayload(record, request.schemaFields);
    const sortPayload = projectCanonicalPayload(record, request.sortFields);
    return {
      payload,
      canonical: canonicalizeToBytes(payload),
      sortKey: canonicalizeToBytes(sortPayload),
    };
  });

  prepared.sort((left, right) => {
    const bySortKey = compareBytes(left.sortKey, right.sortKey);
    return bySortKey !== 0 ? bySortKey : compareBytes(left.canonical, right.canonical);
  });

  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared.at(index - 1);
    const current = prepared.at(index);
    /* c8 ignore next 3 -- `index` recorre el propio array */
    if (previous === undefined || current === undefined) {
      throw new Error("Registro ausente ordenando el artefacto.");
    }
    if (compareBytes(previous.canonical, current.canonical) === 0) {
      throw new Error(
        "Dos registros identicos en el export. El empate no tiene desempate posible, asi que " +
          "el orden -y por tanto el merkle root- dependeria del azar. Corrige la consulta que " +
          "los produjo antes de finalizar el snapshot.",
      );
    }
  }

  const lines: Uint8Array[] = [];
  const leaves: Uint8Array[] = [];
  for (const record of prepared) {
    lines.push(record.canonical, encoder.encode("\n"));
    leaves.push(merkleLeafHash(record.payload));
  }

  const dataBytes = Buffer.concat(lines.map((chunk) => Buffer.from(chunk)));
  const dataSha256 = sha256Hex([dataBytes]);
  const merkleRoot = toHex(merkleRootFromLeaves(leaves));

  const contentManifest: CanonicalObject = {
    artifact_format: EXPORT_ARTIFACT_FORMAT,
    balance_predicate: {
      version: descriptor.balancePredicate.version,
      included_statuses: [...descriptor.balancePredicate.includedStatuses],
      effective_at_operator: descriptor.balancePredicate.effectiveAtOperator,
      expires_at_operator: descriptor.balancePredicate.expiresAtOperator,
      null_expiry_means: descriptor.balancePredicate.nullExpiryMeans,
      interval_notation: descriptor.balancePredicate.intervalNotation,
    },
    canonicalization_version: request.key.canonicalizationVersion,
    cutoff_at: request.key.cutoffAt,
    data_sha256: dataSha256,
    expiration: {
      balance_predicate_version: request.expiration.balancePredicateVersion,
      enabled_at_cutoff: request.expiration.expirationEnabledAtCutoff,
      excluded_entry_quantity: request.expiration.excludedEntryQuantity,
      excluded_transaction_count: request.expiration.excludedTransactionCount,
    },
    export_schema_version: request.key.exportSchemaVersion,
    ledger_high_water_mark: request.key.ledgerHighWaterMark,
    merkle_root: merkleRoot,
    promotion_id: request.key.promotionId,
    record_count: prepared.length,
    rules_version_id: request.key.rulesVersionId,
    schema_fields: [...request.schemaFields],
    serialization: descriptor.serialization,
    sort_fields: [...request.sortFields],
  };

  const contentManifestBytes = canonicalizeToBytes(contentManifest);

  return {
    key: request.key,
    formatVersion: EXPORT_ARTIFACT_FORMAT,
    recordCount: prepared.length,
    dataBytes: new Uint8Array(dataBytes),
    dataSha256,
    leafHashes: leaves.map((leaf) => toHex(leaf)),
    merkleRoot,
    contentManifestBytes,
    contentManifestSha256: sha256Hex([contentManifestBytes]),
    contentDigest: sha256Hex([encoder.encode("LSW/EXPORT/DIGEST/v1\n"), contentManifestBytes]),
  };
}

/**
 * Procedencia: quien, cuando y con que clave. FUERA del digest.
 *
 * Se guarda y se entrega junto al artefacto porque un auditor la necesita,
 * pero nunca entra en `contentDigest`: si entrara, dos generaciones del mismo
 * corte dejarian de coincidir y DEC-016 seria imposible de cumplir.
 */
export interface ExportProvenance {
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly finalizedAt: string | null;
  readonly finalizedBy: string | null;
  readonly signingKeyId: string | null;
  readonly supersedesSnapshotId: string | null;
}

export function buildProvenanceBytes(
  artifact: ExportArtifact,
  provenance: ExportProvenance,
): Uint8Array {
  return canonicalizeToBytes({
    content_digest: artifact.contentDigest,
    content_manifest_sha256: artifact.contentManifestSha256,
    finalized_at: provenance.finalizedAt,
    finalized_by: provenance.finalizedBy,
    generated_at: provenance.generatedAt,
    generated_by: provenance.generatedBy,
    signing_key_id: provenance.signingKeyId,
    snapshot_id: provenance.snapshotId,
    snapshot_version: provenance.snapshotVersion,
    supersedes_snapshot_id: provenance.supersedesSnapshotId,
  });
}
