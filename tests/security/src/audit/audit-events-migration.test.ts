/**
 * INVARIANTE: la migracion de `audit_events` cumple lo que DEC-007 y DEC-008
 * prometen, y se puede comprobar SIN ejecutarla.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UN TEST ESTATICO, HABIENDO UNO DE INTEGRACION
 * ---------------------------------------------------------------------------
 *
 * El de integracion es mejor -intenta el UPDATE y comprueba que falla- y hoy no
 * se puede ejecutar: exige Docker y en esta maquina no lo hay. Un control que
 * solo existe en una suite que nadie corre no es un control.
 *
 * Este lee el TEXTO de la migracion, que es lo que un auditor tambien puede
 * leer (DEC-005). No sustituye al dinamico: comprueba que las garantias estan
 * ESCRITAS. Que ademas funcionen lo dice el otro, cuando haya Docker.
 *
 * ---------------------------------------------------------------------------
 * Y LA PARIDAD DE CAMPOS, QUE ES LA PARTE QUE SE EROSIONA SOLA
 * ---------------------------------------------------------------------------
 *
 * El dia que alguien anade una columna a `audit_events`, todo compila, todos
 * los tests pasan y la cadena sigue verificando. Y sin embargo desde ese dia
 * los hashes cubren un conjunto de campos distinto del de ayer, y nada en el
 * registro lo dice. Un campo fuera del hash es un campo que se puede cambiar
 * sin dejar rastro.
 *
 * La proteccion es aritmetica: incluidos + excluidos = columnas de la tabla.
 * Es el mismo gate que `canonicalization-parity.test.ts` pone sobre el ledger.
 */

import { AUDIT_EVENT_CANONICAL_FIELDS_V1, AUDIT_EVENT_EXCLUDED_FIELDS_V1 } from "@lsw/audit";
import { describe, expect, it } from "vitest";

import { readRepoFile } from "../helpers/repo.js";

const MIGRATION = "packages/database/drizzle/0024_audit_events.sql";
const sql = readRepoFile(MIGRATION);

/**
 * El mismo SQL sin comentarios `--`.
 *
 * Las comprobaciones sobre lo que la base de datos HACE tienen que mirar aqui.
 * Es la leccion que ya dejo escrita `migration-audit.test.ts`: esta migracion
 * explica en un comentario por que NO recalcula el hash -y nombra `digest()`
 * para decirlo-, y buscar la cadena en el fichero entero convertiria esa
 * explicacion en un fallo. Un comentario no hace nada.
 *
 * Las comprobaciones de PERMISOS siguen mirando el texto completo: un GRANT
 * nunca vive dentro de un comentario, y ahi el falso positivo es preferible al
 * falso negativo.
 */
const statements = sql
  .split("\n")
  .map((line) => {
    const comment = line.indexOf("--");
    return comment === -1 ? line : line.slice(0, comment);
  })
  .join("\n");

/**
 * Columnas declaradas en `CREATE TABLE audit_events (...)`.
 *
 * Mismo extractor que usa el gate del ledger: el bloque termina en la primera
 * restriccion con nombre, y una columna empieza SIEMPRE en la columna 3 del
 * fichero con un identificador en minusculas.
 */
function migrationColumns(): readonly string[] {
  const start = sql.indexOf("CREATE TABLE audit_events (");
  expect(start, `No se encuentra la tabla en ${MIGRATION}`).toBeGreaterThan(-1);

  const rest = sql.slice(start);
  const end = rest.indexOf("CONSTRAINT audit_events_");
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

describe("DEC-007: las tres capas del append-only estan escritas", () => {
  it("capa 1 - el rol de la aplicacion recibe SELECT e INSERT, y nada mas", () => {
    expect(sql).toContain("GRANT SELECT, INSERT ON audit_events TO lsw_app;");
  });

  it("capa 1 - y hay un REVOKE explicito, no solo la ausencia del privilegio", () => {
    expect(sql).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM lsw_app;");
  });

  it("capa 1 - ningun GRANT concede UPDATE o DELETE sobre la tabla al rol app", () => {
    // Literal, no `new RegExp(...)`: una expresion regular construida desde una
    // cadena es donde se cuelan las barras invertidas mal escapadas, y un
    // escaner que no encuentra nada porque su patron esta roto informa en verde
    // por ausencia de busqueda (HO-014).
    const offending =
      /GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*\bON\b[^;]*\baudit_events\b[^;]*\blsw_app\b/isu;
    expect(offending.test(sql)).toBe(false);
  });

  it("capa 1 - el rol de informes lee y no escribe", () => {
    expect(sql).toContain("GRANT SELECT ON audit_events TO lsw_readonly_report;");
    const offending =
      /GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*\bON\b[^;]*\baudit_events\b[^;]*\blsw_readonly_report\b/isu;
    expect(offending.test(sql)).toBe(false);
  });

  it("capa 2 - hay un trigger BEFORE UPDATE OR DELETE que lanza excepcion", () => {
    // `lsw_reject_mutation()` esta definida en 0000_baseline y hace `RAISE
    // EXCEPTION`. El trigger cubre al superusuario y al migrator, que los
    // permisos no alcanzan.
    expect(sql).toMatch(
      /CREATE TRIGGER audit_events_reject_mutation\s+BEFORE UPDATE OR DELETE ON audit_events\s+FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation\(\);/u,
    );
  });

  it("capa 3 - este fichero, y el de integracion que intenta romperlo de verdad", () => {
    // La capa 3 no se puede comprobar sobre el texto de la migracion: es este
    // test. Lo que si se comprueba es que el de integracion existe, porque un
    // control cuya unica prueba es estatica nunca se ha intentado romper.
    expect(() =>
      readRepoFile("packages/database/test/integration/audit-events.int.test.ts"),
    ).not.toThrow();
  });
});

describe("DEC-008: la cadena no se puede bifurcar, por construccion", () => {
  it("la unicidad del antecesor es una restriccion de la tabla", () => {
    expect(sql).toContain("CONSTRAINT audit_events_unique_chain_link");
    expect(sql).toContain("UNIQUE (chain_key, chain_prev_hash)");
  });

  it("`chain_prev_hash` es NOT NULL: con NULL, dos filas iniciales serian posibles", () => {
    // En PostgreSQL dos NULL son distintos dentro de un indice unico. Si la
    // primera fila dejara `chain_prev_hash` a NULL, la restriccion de arriba no
    // impediria una segunda fila inicial, que es el peor sitio para bifurcar.
    expect(sql).toMatch(/chain_prev_hash\s+text NOT NULL/u);
  });

  it("hay un trigger de insercion que comprueba que el eslabon engancha", () => {
    expect(sql).toContain("CREATE TRIGGER audit_events_validate_insert");
    expect(sql).toContain("lsw_audit_events_validate_insert()");
  });

  it("el trigger toma el MISMO cerrojo consultivo que el adaptador", () => {
    // Si el trigger y el adaptador eligieran claves distintas, los dos
    // tomarian un cerrojo y ninguno serializaria al otro: el cerrojo mas
    // inutil posible, y ademas invisible.
    const lock = "pg_advisory_xact_lock(hashtext('lsw_audit_chain'), hashtext(";
    expect(sql.includes(lock), "el trigger no toma el cerrojo de la cadena").toBe(true);

    const adapter = readRepoFile("packages/database/src/repositories/audit-event-repository.ts");
    expect(
      adapter.includes(lock),
      "el adaptador no toma el mismo cerrojo: dos claves distintas no serializan nada",
    ).toBe(true);
  });

  it("el trigger NO recalcula el hash: eso seria una segunda implementacion", () => {
    // Construir el preimage de DEC-035 en plpgsql seria una segunda
    // implementacion del hash, y dos implementaciones de un hash acaban
    // difiriendo. La base de datos comprueba la TOPOLOGIA; el preimage lo
    // conoce solo `@lsw/audit`.
    expect(/digest\s*\(/iu.test(statements)).toBe(false);
    expect(/sha256\s*\(/iu.test(statements)).toBe(false);
    expect(/encode\s*\(/iu.test(statements)).toBe(false);
  });
});

describe("DEC-008: el conjunto de campos de la v1 cubre la tabla entera", () => {
  it("el extractor encuentra columnas (si no, este gate seria verde por vacio)", () => {
    expect(migrationColumns().length).toBeGreaterThanOrEqual(20);
    expect(migrationColumns()).toContain("occurred_at");
    expect(migrationColumns()).toContain("chain_hash");
  });

  it("incluidos + excluidos = columnas de audit_events", () => {
    const declared = new Set([
      ...AUDIT_EVENT_CANONICAL_FIELDS_V1,
      ...AUDIT_EVENT_EXCLUDED_FIELDS_V1.map((entry) => entry.field),
    ]);
    const actual = new Set(migrationColumns());

    expect(
      [...actual].filter((column) => !declared.has(column)).sort(),
      "Columnas que la canonicalizacion v1 no clasifica. Decidir si el hash debe cubrirlas -lo " +
        "que exige una version 2, porque cambiaria hashes ya escritos- o si van a la lista de " +
        "exclusiones con su motivo.",
    ).toStrictEqual([]);

    expect(
      [...declared].filter((column) => !actual.has(column)).sort(),
      "La canonicalizacion nombra campos que la tabla no tiene: el hash cubriria algo que nadie " +
        "guarda.",
    ).toStrictEqual([]);
  });

  it("ninguna columna esta en las dos listas a la vez", () => {
    const included = new Set(AUDIT_EVENT_CANONICAL_FIELDS_V1);
    expect(
      AUDIT_EVENT_EXCLUDED_FIELDS_V1.filter((entry) => included.has(entry.field)),
    ).toStrictEqual([]);
  });

  it("cada exclusion tiene un motivo escrito, no solo un nombre", () => {
    for (const entry of AUDIT_EVENT_EXCLUDED_FIELDS_V1) {
      expect(entry.reason.length, `Exclusion sin motivo: ${entry.field}`).toBeGreaterThan(40);
    }
  });

  it("las columnas de la cadena estan excluidas del payload", () => {
    const excluded = new Set(AUDIT_EVENT_EXCLUDED_FIELDS_V1.map((entry) => entry.field));
    for (const column of [
      "chain_hash",
      "chain_prev_hash",
      "canonicalization_version",
      "chain_key",
    ]) {
      expect(excluded.has(column), `${column} deberia estar excluida`).toBe(true);
    }
  });
});

describe("DEC-035 / DEC-047: ninguna columna del payload tiene DEFAULT", () => {
  it("ni id, ni recorded_at, ni metadata, ni actor_roles", () => {
    // Con `DEFAULT`, quien inserta puede omitir el valor, y entonces el hash
    // cubre una cosa y la fila guarda otra: la cadena NACE ROTA. Sin `DEFAULT`,
    // el olvido es un error de NOT NULL en el sitio.
    const hashed = new Set<string>(AUDIT_EVENT_CANONICAL_FIELDS_V1);
    const columnBlock = sql.slice(
      sql.indexOf("CREATE TABLE audit_events ("),
      sql.indexOf("CONSTRAINT audit_events_chain_key_matches_promotion"),
    );

    // Se recorren las LINEAS de columna en vez de construir una expresion
    // regular por campo: un patron por campo hay que escaparlo, y un patron mal
    // escapado no encuentra nada y el gate se pone verde por no haber buscado.
    const offenders: string[] = [];
    for (const line of columnBlock.split("\n")) {
      const match = /^ {2}([a-z][a-z0-9_]*) {2,}(.*)$/u.exec(line);
      const column = match?.[1];
      if (column === undefined || !hashed.has(column)) {
        continue;
      }
      if (/\bDEFAULT\b/u.test(match?.[2] ?? "")) {
        offenders.push(column);
      }
    }

    expect(
      offenders,
      "columnas con DEFAULT que ademas entran en el hash: quien inserta podria omitirlas y la " +
        "cadena naceria rota (DEC-035, DEC-047)",
    ).toStrictEqual([]);
  });
});

describe("minimizacion: la tabla no puede guardar una direccion IP", () => {
  it("source_ip solo admite un digest de 64 hexadecimales", () => {
    expect(sql).toContain("CONSTRAINT audit_events_source_ip_is_digest");
    expect(sql).toMatch(/source_ip IS NULL OR source_ip ~ '\^\[0-9a-f\]\{64\}\$'/u);
  });

  it("la migracion no siembra ningun evento", () => {
    // Un evento sembrado por una migracion seria un hecho que no ocurrio,
    // encadenado como si hubiera ocurrido.
    expect(/INSERT\s+INTO\s+audit_events/iu.test(sql)).toBe(false);
  });
});
