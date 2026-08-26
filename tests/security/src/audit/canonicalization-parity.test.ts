/**
 * INVARIANTE: la canonicalizacion v1 y la migracion del ledger no se separan
 * en silencio.
 *
 * ---------------------------------------------------------------------------
 * EL FALLO QUE ESTE FICHERO EXISTE PARA IMPEDIR
 * ---------------------------------------------------------------------------
 *
 * `backend` anade una columna a `entry_transactions`. Todo compila, todos los
 * tests pasan, la cadena sigue verificando. Y sin embargo el sistema ha
 * cambiado de forma irreversible: desde ese dia los hashes cubren un conjunto
 * de campos distinto del que cubrian ayer, y NADA en el registro lo dice. Un
 * auditor que pregunte "que campos protegia el hash de marzo?" no tiene forma
 * de responder, y la respuesta importa: un campo fuera del hash es un campo que
 * se puede cambiar sin dejar rastro.
 *
 * No es un fallo hipotetico ni exotico: anadir una columna es de las cosas mas
 * normales que le pasan a una tabla.
 *
 * La proteccion es aritmetica: campos incluidos + campos excluidos = columnas
 * de la tabla. Una columna nueva no cuadra en ninguna de las dos listas y este
 * test falla el mismo dia, obligando a una decision explicita -que no puede ser
 * "meterla en la v1", porque eso invalidaria los hashes ya escritos-.
 *
 * ---------------------------------------------------------------------------
 * Y EL PREDICADO DEL SALDO
 * ---------------------------------------------------------------------------
 *
 * DEC-034 dejo escrito que la semantica de bordes pertenece a la version de
 * canonicalizacion. Aqui se comprueba que lo declarado en `@lsw/audit` es
 * LITERALMENTE lo que ejecuta `lsw_entry_balances_at`. Si alguien cambia un
 * `<=` por un `<` en el SQL, altera saldos historicos sin tocar una sola fila y
 * sin que la hash chain pueda notarlo. Este test es lo unico que lo ve.
 */

import { describe, expect, it } from "vitest";

import {
  BALANCE_PREDICATE_V1,
  CANONICALIZATION_V1,
  LEDGER_CANONICAL_FIELDS_V1,
  LEDGER_EXCLUDED_FIELDS_V1,
} from "@lsw/audit";

import { buildLedgerRow, fixtureCoversDeclaredFields } from "../helpers/ledger-chain.js";
import { readRepoFile } from "../helpers/repo.js";

const MIGRATION = "packages/database/drizzle/0006_entry_ledger.sql";

/**
 * Columnas declaradas en `CREATE TABLE entry_transactions (...)`.
 *
 * Se corta el bloque en la primera restriccion con nombre (`CONSTRAINT`), que
 * es donde acaban las columnas. Las lineas de comentario y las continuaciones
 * indentadas se descartan: una columna empieza SIEMPRE en la columna 3 del
 * fichero con un identificador en minusculas.
 */
function migrationColumns(): readonly string[] {
  const sql = readRepoFile(MIGRATION);
  const start = sql.indexOf("CREATE TABLE entry_transactions (");
  expect(start, `No se encuentra la tabla en ${MIGRATION}`).toBeGreaterThan(-1);

  const rest = sql.slice(start);
  const end = rest.indexOf("CONSTRAINT entry_transactions_");
  expect(end, "No se encuentra el bloque de restricciones").toBeGreaterThan(-1);

  const columns: string[] = [];
  for (const line of rest.slice(0, end).split("\n")) {
    const match = /^ {2}([a-z][a-z0-9_]*) {2,}/u.exec(line);
    if (match?.[1] !== undefined) {
      columns.push(match[1]);
    }
  }
  return columns;
}

describe("DEC-008: el conjunto de campos de la v1 cubre la tabla entera", () => {
  it("el extractor encuentra columnas (si no, este gate seria verde por vacio)", () => {
    // Sin esta comprobacion, un cambio de formato en la migracion dejaria la
    // lista vacia y las dos afirmaciones de abajo pasarian trivialmente.
    expect(migrationColumns().length).toBeGreaterThanOrEqual(20);
    expect(migrationColumns()).toContain("quantity_delta");
    expect(migrationColumns()).toContain("chain_hash");
  });

  it("incluidos + excluidos = columnas de entry_transactions", () => {
    const declared = new Set([
      ...LEDGER_CANONICAL_FIELDS_V1,
      ...LEDGER_EXCLUDED_FIELDS_V1.map((entry) => entry.field),
    ]);
    const actual = new Set(migrationColumns());

    const sinClasificar = [...actual].filter((column) => !declared.has(column)).sort();
    const inventadas = [...declared].filter((column) => !actual.has(column)).sort();

    expect(
      sinClasificar,
      "Columnas de la tabla que la canonicalizacion v1 no clasifica. Decidir si el hash debe " +
        "cubrirlas -lo que exige una version 2, porque cambiaria hashes ya escritos- o si van " +
        "a la lista de exclusiones con su motivo.",
    ).toStrictEqual([]);

    expect(
      inventadas,
      "La canonicalizacion nombra campos que la tabla no tiene: el hash se calcularia sobre " +
        "algo que nadie guarda.",
    ).toStrictEqual([]);
  });

  it("ninguna columna esta en las dos listas a la vez", () => {
    const incluidas = new Set(LEDGER_CANONICAL_FIELDS_V1);
    const duplicadas = LEDGER_EXCLUDED_FIELDS_V1.filter((entry) => incluidas.has(entry.field));
    expect(duplicadas).toStrictEqual([]);
  });

  it("cada exclusion tiene un motivo escrito, no solo un nombre", () => {
    for (const entry of LEDGER_EXCLUDED_FIELDS_V1) {
      expect(entry.reason.length, `Exclusion sin motivo: ${entry.field}`).toBeGreaterThan(40);
    }
  });

  it("las columnas de la cadena estan excluidas del payload", () => {
    const excluidas = new Set(LEDGER_EXCLUDED_FIELDS_V1.map((entry) => entry.field));
    for (const columna of ["chain_hash", "chain_prev_hash", "canonicalization_version"]) {
      expect(excluidas.has(columna), `${columna} deberia estar excluida`).toBe(true);
    }
  });

  it("el fixture de los tests cubre exactamente los campos declarados", () => {
    // Si el fixture llevara menos campos, los tests de manipulacion probarian
    // una canonicalizacion mas pequena que la real.
    expect(fixtureCoversDeclaredFields(buildLedgerRow(1))).toBe(true);
  });

  it("el orden de las columnas en el DDL no afecta al hash", () => {
    // La respuesta a "esta congelado el orden de columnas?": no hace falta que
    // lo este. La forma canonica ordena las claves, asi que el orden fisico es
    // invisible. Lo que si esta congelado es el CONJUNTO, y de eso se ocupan
    // las comprobaciones de arriba.
    const ordenada = [...LEDGER_CANONICAL_FIELDS_V1].sort();
    expect(ordenada).toStrictEqual([...LEDGER_CANONICAL_FIELDS_V1]);
  });
});

describe("DEC-033 / DEC-034: la semantica de bordes declarada es la que ejecuta el SQL", () => {
  const normalize = (text: string): string => text.replace(/\s+/gu, " ").trim();

  it("el predicado declarado aparece literalmente en lsw_entry_balances_at", () => {
    const sql = normalize(readRepoFile(MIGRATION));
    expect(
      sql.includes(normalize(BALANCE_PREDICATE_V1.sql)),
      "El predicado de saldo del SQL ya no coincide con `BALANCE_PREDICATE_V1`. Cambiar un " +
        "borde altera saldos historicos SIN tocar una sola fila del ledger, asi que la hash " +
        "chain no puede detectarlo: hace falta una version nueva del predicado.",
    ).toBe(true);
  });

  it("el intervalo es semiabierto y esta escrito como tal", () => {
    expect(BALANCE_PREDICATE_V1.effectiveAtOperator).toBe("<=");
    expect(BALANCE_PREDICATE_V1.expiresAtOperator).toBe(">");
    expect(BALANCE_PREDICATE_V1.intervalNotation).toBe("[effective_at, expires_at)");
    expect(BALANCE_PREDICATE_V1.nullExpiryMeans).toBe("NEVER_EXPIRES");
  });

  it("solo POSTED cuenta para el universo elegible", () => {
    expect([...BALANCE_PREDICATE_V1.includedStatuses]).toStrictEqual(["POSTED"]);
  });

  it("el descriptor de la v1 apunta al predicado v1", () => {
    expect(CANONICALIZATION_V1.balancePredicate.version).toBe(1);
    expect(CANONICALIZATION_V1.hashAlgorithm).toBe("SHA-256");
    expect(CANONICALIZATION_V1.serialization).toBe("RFC8785+NFC+SAFE_INTEGERS");
  });
});
