/**
 * Fabrica de cadenas de ledger para los tests de integridad.
 *
 * Construye filas con TODOS los campos que declara
 * `LEDGER_CANONICAL_FIELDS_V1` y las encadena con el mismo camino de codigo que
 * usara el escritor real. Que el fixture y el verificador compartan
 * `computeRowHash` es deliberado: si el test construyera los hashes por su
 * cuenta, probaria que dos implementaciones distintas coinciden, que no es lo
 * que hay que demostrar. Lo que hay que demostrar es que una fila ALTERADA
 * deja de cuadrar, y para eso el camino honesto tiene que ser exactamente el de
 * produccion.
 */

import {
  CHAIN_DOMAIN_ENTRY_LEDGER,
  CURRENT_CANONICALIZATION_VERSION,
  LEDGER_CANONICAL_FIELDS_V1,
  computeRowHash,
} from "@lsw/audit";
import type { StoredChainLink } from "@lsw/audit";

export type LedgerRow = Record<string, unknown>;

const PROMOTION_ID = "00000000-0000-4000-8000-00000000aaaa";
const RULES_VERSION_ID = "00000000-0000-4000-8000-00000000bbbb";

/** Fila completa y valida. Los overrides sustituyen campo a campo. */
export function buildLedgerRow(index: number, overrides: LedgerRow = {}): LedgerRow {
  const suffix = index.toString(10).padStart(4, "0");
  const base: LedgerRow = {
    actor_admin_user_id: null,
    actor_participant_id: `00000000-0000-4000-8000-0000000p${suffix}`,
    actor_type: "SYSTEM",
    calculation_snapshot_id: null,
    effective_at: `2026-03-${(index % 28) + 1 < 10 ? "0" : ""}${String((index % 28) + 1)}T12:00:00.000Z`,
    engine_version: 1,
    expires_at: null,
    id: `00000000-0000-4000-8000-0000000t${suffix}`,
    metadata: {},
    participant_id: `00000000-0000-4000-8000-0000000p${suffix}`,
    promotion_id: PROMOTION_ID,
    quantity_delta: 10,
    reason_detail: null,
    reason_key: "entry.purchase_earned",
    // DEC-008: quien inserta DEBE pasar `recorded_at` explicitamente; si deja
    // actuar al DEFAULT now() de la tabla, el hash cubre un instante y la fila
    // guarda otro. El fixture lo pasa siempre, igual que debera hacerlo el
    // escritor real.
    recorded_at: `2026-03-${(index % 28) + 1 < 10 ? "0" : ""}${String((index % 28) + 1)}T12:00:01.000Z`,
    reverses_transaction_id: null,
    rules_version_id: RULES_VERSION_ID,
    source_ref: `order:${suffix}`,
    source_type: "PURCHASE",
    status: "POSTED",
    type: "PURCHASE_EARNED",
  };

  return { ...base, ...overrides };
}

export const LEDGER_PROMOTION_ID = PROMOTION_ID;

/** Los campos del fixture son exactamente los que cubre la version 1. */
export function fixtureCoversDeclaredFields(row: LedgerRow): boolean {
  const keys = new Set(Object.keys(row));
  return (
    keys.size === LEDGER_CANONICAL_FIELDS_V1.length &&
    LEDGER_CANONICAL_FIELDS_V1.every((field) => keys.has(field))
  );
}

/** Encadena filas por el camino de produccion. */
export function chainRows(
  rows: readonly LedgerRow[],
  promotionId: string = PROMOTION_ID,
): readonly StoredChainLink[] {
  const links: StoredChainLink[] = [];
  let previousHash: Uint8Array | null = null;

  for (const [index, row] of rows.entries()) {
    const storedHash = computeRowHash({
      domain: CHAIN_DOMAIN_ENTRY_LEDGER,
      promotionId,
      canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
      row,
      previousHash,
    });

    links.push({
      id: String(row.id),
      sequence: String(index + 1),
      canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
      row,
      storedHash,
      storedPreviousHash: previousHash,
    });

    previousHash = storedHash;
  }

  return links;
}

/** Cadena honesta de `count` filas. */
export function honestChain(
  count: number,
  promotionId: string = PROMOTION_ID,
): readonly StoredChainLink[] {
  return chainRows(
    Array.from({ length: count }, (_unused, index) => buildLedgerRow(index + 1)),
    promotionId,
  );
}
