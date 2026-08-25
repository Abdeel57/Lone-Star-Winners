/**
 * Paridad entre las declaraciones del mismo vocabulario.
 *
 * Hay conceptos escritos mas de una vez por necesidad tecnica: en SQL (que es
 * lo que impone la base de datos), en el esquema Drizzle (que es lo que ve el
 * ORM), en `@lsw/sweepstakes` (que es lo que viaja por la API) y, desde
 * DEC-027, en `@lsw/security` (que es el catalogo canonico de autorizacion).
 * Cada copia es una oportunidad de divergir, y una divergencia silenciosa
 * significa que base de datos, dominio y contrato estarian describiendo
 * productos distintos.
 *
 * Este test convierte esa duplicacion inevitable en una duplicacion vigilada.
 *
 * SOBRE EL CATALOGO RBAC (DEC-027)
 *   `packages/database` ya NO define permisos ni roles: los importa de
 *   `@lsw/security` y los proyecta a filas en `src/domain/permissions.ts`. Lo
 *   que se comprueba aqui es que la migracion `0004` siembra exactamente esa
 *   proyeccion. Si `security` anade una capacidad y nadie escribe la
 *   migracion, este test falla, que es lo que debe pasar: una ruta podria
 *   exigir un permiso que no existe en la base de datos y el registro
 *   deny-by-default de DEC-015 se quedaria sin referencia.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADMIN_USER_STATUSES,
  IDENTITY_STATUSES,
  LOCALE_CODES,
  PARTICIPANT_REVIEW_STATES,
  PARTICIPANT_STATUSES,
  PRODUCT_STATUSES,
  PROMOTION_STATUSES,
  REQUIRED_RULES_KEYS,
  RULES_VERSION_STATUSES,
} from "@lsw/sweepstakes";
import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLES,
  ADMIN_ROLE_CONFLICTS,
  ADMIN_ROLE_KEYS,
  ADMIN_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_CAPABILITIES,
  SEPARATION_OF_DUTIES,
  STAFF_ASSIGNABLE_ROLE_KEYS,
  adminUserStatusEnum,
  identityStatusEnum,
  localeCodeEnum,
  participantReviewStateEnum,
  participantStatusEnum,
  productStatusEnum,
  promotionStatusEnum,
  rulesVersionStatusEnum,
} from "../src/index.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

function readMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

const baselineSql = readMigration("0000_baseline.sql");
const promotionsSql = readMigration("0002_promotions.sql");
const rbacSql = readMigration("0004_rbac_catalog_unification.sql");

/** Extrae los valores de `CREATE TYPE <name> AS ENUM (...)`. */
function parseSqlEnum(sql: string, typeName: string): string[] {
  const pattern = new RegExp(
    String.raw`CREATE\s+TYPE\s+${typeName}\s+AS\s+ENUM\s*\(([^)]*)\)`,
    "iu",
  );
  const match = pattern.exec(sql);
  if (match?.[1] === undefined) {
    throw new Error(`No se encontro el tipo enumerado ${typeName} en el SQL.`);
  }
  return [...match[1].matchAll(/'([^']*)'/gu)].map((entry) => entry[1] ?? "");
}

/** Extrae el cuerpo de un `INSERT INTO <table> ... VALUES ...;`. */
function parseInsertBlock(sql: string, table: string): string {
  const start = sql.indexOf(`INSERT INTO ${table}`);
  if (start === -1) {
    throw new Error(`No se encontro INSERT INTO ${table}.`);
  }
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
}

/**
 * Divide una fila `(...)` en sus columnas, respetando las comillas simples
 * escapadas (`''`) que aparecen dentro de las descripciones.
 */
function splitSqlTuple(tuple: string): string[] {
  const values: string[] = [];
  let current = "";
  let inString = false;

  for (let index = 0; index < tuple.length; index += 1) {
    const character = tuple[index];

    if (inString) {
      if (character === "'") {
        if (tuple[index + 1] === "'") {
          current += "'";
          index += 1;
          continue;
        }
        inString = false;
        continue;
      }
      current += character;
      continue;
    }

    if (character === "'") {
      inString = true;
      continue;
    }
    if (character === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }

  values.push(current.trim());
  return values;
}

/** Extrae las tuplas `(...)` de nivel superior de un bloque `VALUES`. */
function parseValueTuples(block: string): string[][] {
  const body = block.slice(block.indexOf("VALUES") + "VALUES".length);
  const tuples: string[][] = [];
  let depth = 0;
  let current = "";
  let inString = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (inString) {
      current += character;
      if (character === "'") {
        if (body[index + 1] === "'") {
          current += "'";
          index += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (character === "'") {
      inString = true;
      current += character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      if (depth === 1) {
        current = "";
        continue;
      }
    }
    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        tuples.push(splitSqlTuple(current));
        current = "";
        continue;
      }
    }
    if (depth > 0) {
      current += character;
    }
  }

  return tuples;
}

const asBoolean = (value: string | undefined): boolean => value === "true";
const asNullableText = (value: string | undefined): string | null =>
  value === undefined || value === "NULL" ? null : value;

describe("paridad de enumerados: SQL <-> Drizzle <-> dominio", () => {
  const cases = [
    { type: "identity_status", drizzle: identityStatusEnum.enumValues, domain: IDENTITY_STATUSES },
    {
      type: "participant_status",
      drizzle: participantStatusEnum.enumValues,
      domain: PARTICIPANT_STATUSES,
    },
    {
      type: "participant_review_state",
      drizzle: participantReviewStateEnum.enumValues,
      domain: PARTICIPANT_REVIEW_STATES,
    },
    {
      type: "admin_user_status",
      drizzle: adminUserStatusEnum.enumValues,
      domain: ADMIN_USER_STATUSES,
    },
    {
      type: "promotion_status",
      drizzle: promotionStatusEnum.enumValues,
      domain: PROMOTION_STATUSES,
    },
    {
      type: "rules_version_status",
      drizzle: rulesVersionStatusEnum.enumValues,
      domain: RULES_VERSION_STATUSES,
    },
    { type: "product_status", drizzle: productStatusEnum.enumValues, domain: PRODUCT_STATUSES },
    { type: "locale_code", drizzle: localeCodeEnum.enumValues, domain: LOCALE_CODES },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.type} coincide en las tres fuentes`, () => {
      const fromSql = parseSqlEnum(baselineSql, testCase.type);
      expect(fromSql).toEqual([...testCase.drizzle]);
      expect(fromSql).toEqual([...testCase.domain]);
    });
  }
});

describe("paridad del catalogo RBAC unificado (DEC-027, DEC-015)", () => {
  it("las capacidades sembradas son exactamente las de `@lsw/security`", () => {
    const rows = parseValueTuples(parseInsertBlock(rbacSql, "admin_permissions")).map(
      (columns) => ({
        key: columns[0] ?? "",
        domain: columns[1] ?? "",
        sensitivity: columns[2] ?? "",
        description: columns[3] ?? "",
        requiresStepUp: asBoolean(columns[4]),
        requiresReason: asBoolean(columns[5]),
        requiresSecondApproval: asBoolean(columns[6]),
        emitsAuditEvent: asBoolean(columns[7]),
        touchesPii: asBoolean(columns[8]),
        dependsOnFeatureFlag: asBoolean(columns[9]),
        legalDependency: asNullableText(columns[10]),
      }),
    );

    expect(rows.length).toBe(PERMISSIONS.length);
    expect(rows.map((row) => row.key).sort()).toEqual(
      PERMISSIONS.map((permission) => permission.key).sort(),
    );

    const sqlIndex = new Map(rows.map((row) => [row.key, row]));
    for (const permission of PERMISSIONS) {
      const fromSql = sqlIndex.get(permission.key);
      expect(fromSql, `capacidad ausente en SQL: ${permission.key}`).toBeDefined();
      // Comparacion campo a campo del objeto entero: un metadato nuevo en
      // `@lsw/security` que nadie siembre hace fallar este test, en vez de
      // colarse porque la lista de comprobaciones se quedo corta.
      expect(fromSql, `los metadatos difieren en ${permission.key}`).toEqual({
        key: permission.key,
        domain: permission.domain,
        sensitivity: permission.sensitivity,
        description: permission.description,
        requiresStepUp: permission.requiresStepUp,
        requiresReason: permission.requiresReason,
        requiresSecondApproval: permission.requiresSecondApproval,
        emitsAuditEvent: permission.emitsAuditEvent,
        touchesPii: permission.touchesPii,
        dependsOnFeatureFlag: permission.dependsOnFeatureFlag,
        legalDependency: permission.legalDependency,
      });
    }
  });

  it("los roles sembrados son exactamente los ocho de `@lsw/security`", () => {
    const rows = parseValueTuples(parseInsertBlock(rbacSql, "admin_roles")).map((columns) => ({
      key: columns[0] ?? "",
      kind: columns[1] ?? "",
      requiresMfa: asBoolean(columns[2]),
      assignableToHuman: asBoolean(columns[3]),
      labelKey: columns[4] ?? "",
      description: columns[5] ?? "",
    }));

    expect(rows.map((row) => row.key).sort()).toEqual([...ADMIN_ROLE_KEYS].sort());

    const sqlIndex = new Map(rows.map((row) => [row.key, row]));
    for (const role of ADMIN_ROLES) {
      expect(sqlIndex.get(role.key), `el rol ${role.key} difiere`).toEqual({
        key: role.key,
        kind: role.kind,
        requiresMfa: role.requiresMfa,
        assignableToHuman: role.assignableToHuman,
        labelKey: role.labelKey,
        description: role.description,
      });
    }

    // DEC-027 adopta el actor `SYSTEM` y el rol `EXPORT_OFFICER`, que el
    // catalogo anterior de `backend` no tenia.
    expect(rows.map((row) => row.key)).toContain("SYSTEM");
    expect(rows.map((row) => row.key)).toContain("EXPORT_OFFICER");
    // DEC-017 / DEC-027: `COMPLIANCE_OFFICER`, nunca `COMPLIANCE_REVIEWER`.
    expect(rows.map((row) => row.key)).toContain("COMPLIANCE_OFFICER");
    expect(rows.map((row) => row.key)).not.toContain("COMPLIANCE_REVIEWER");
  });

  it("la matriz rol x capacidad sembrada es la de `ROLE_CAPABILITIES`", () => {
    const rows = parseValueTuples(parseInsertBlock(rbacSql, "admin_role_permissions")).map(
      (columns) => [columns[0] ?? "", columns[1] ?? ""] as const,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map(([role, permission]) => `${role}|${permission}`).sort()).toEqual(
      ADMIN_ROLE_PERMISSIONS.map(([role, permission]) => `${role}|${permission}`).sort(),
    );
  });

  it("ningun rol acumula por si solo dos capacidades incompatibles (DEC-017)", () => {
    // El acierto que DEC-027 conserva del diseno de `backend`: el catalogo
    // anterior lo garantizaba excluyendo `export.finalize`, `draw.authorize` y
    // `draw.execute` de `SUPER_ADMIN`. El catalogo unificado va mas lejos y no
    // tiene ningun rol con todos los privilegios, asi que la comprobacion se
    // expresa sobre la regla, no sobre un rol concreto: si manana apareciera
    // un rol que acumulara las dos mitades de una separacion de funciones,
    // este test lo veria.
    expect([...ADMIN_ROLE_KEYS]).not.toContain("SUPER_ADMIN");

    for (const role of ADMIN_ROLE_KEYS) {
      const granted = new Set<string>(ROLE_CAPABILITIES[role]);
      for (const constraint of SEPARATION_OF_DUTIES) {
        const [capabilityA, capabilityB] = constraint.capabilities;
        expect(
          granted.has(capabilityA) && granted.has(capabilityB),
          `el rol ${role} acumula ${capabilityA} y ${capabilityB} (${constraint.source})`,
        ).toBe(false);
      }
    }
  });

  it("los pares de roles incompatibles sembrados son los derivados de la separacion de funciones", () => {
    const rows = parseValueTuples(parseInsertBlock(rbacSql, "admin_role_conflicts")).map(
      (columns) => ({
        roleKeyA: columns[0] ?? "",
        roleKeyB: columns[1] ?? "",
        reason: columns[2] ?? "",
      }),
    );

    expect(rows).toEqual(
      ADMIN_ROLE_CONFLICTS.map((conflict) => ({
        roleKeyA: conflict.roleKeyA,
        roleKeyB: conflict.roleKeyB,
        reason: conflict.reason,
      })),
    );

    // El orden canonico que exige la CHECK de `0001` (`role_key_a < role_key_b`).
    for (const row of rows) {
      expect(row.roleKeyA < row.roleKeyB, `par no canonico: ${row.roleKeyA}/${row.roleKeyB}`).toBe(
        true,
      );
    }

    // Cada restriccion de capacidades tiene que haber producido al menos un
    // par de roles: si no, la separacion de funciones no llegaria a la base de
    // datos y solo existiria en tiempo de ejecucion.
    expect(rows.length).toBeGreaterThanOrEqual(SEPARATION_OF_DUTIES.length);
  });

  it("cada capacidad con step-up esta clasificada por encima de rutinaria", () => {
    for (const permission of PERMISSIONS) {
      if (permission.requiresStepUp) {
        expect(permission.sensitivity, `${permission.key} exige step-up siendo ROUTINE`).not.toBe(
          "ROUTINE",
        );
      }
    }
  });

  it("solo los roles de personal pueden asignarse a una cuenta administrativa", () => {
    // La base de datos lo impone con la clave ajena compuesta de `0004`; esto
    // comprueba que el lado TypeScript dice lo mismo.
    expect([...STAFF_ASSIGNABLE_ROLE_KEYS]).not.toContain("SYSTEM");
    expect([...STAFF_ASSIGNABLE_ROLE_KEYS]).not.toContain("PARTICIPANT");
    expect(STAFF_ASSIGNABLE_ROLE_KEYS.length).toBeGreaterThan(0);

    for (const role of ADMIN_ROLES) {
      if (role.kind === "STAFF" && role.assignableToHuman) {
        expect([...STAFF_ASSIGNABLE_ROLE_KEYS]).toContain(role.key);
      }
    }
  });
});

describe("paridad de claves legales requeridas (DEC-012)", () => {
  it("la funcion SQL y `REQUIRED_RULES_KEYS` declaran el mismo conjunto", () => {
    const start = promotionsSql.indexOf("FROM unnest(ARRAY[");
    const end = promotionsSql.indexOf("]) AS required_key", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const fromSql = [...promotionsSql.slice(start, end).matchAll(/'([a-z0-9_]+)'/gu)].map(
      (match) => match[1] ?? "",
    );
    expect(fromSql.sort()).toEqual([...REQUIRED_RULES_KEYS].sort());
  });
});
