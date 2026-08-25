/**
 * Paridad entre las tres declaraciones del mismo vocabulario.
 *
 * El mismo concepto esta escrito tres veces por necesidad tecnica: en SQL
 * (que es lo que impone la base de datos), en el esquema Drizzle (que es lo
 * que ve el ORM) y en `@lsw/sweepstakes` (que es lo que viaja por la API).
 * Tres copias son tres oportunidades de divergir, y una divergencia silenciosa
 * aqui significa que base de datos, dominio y contrato estarian describiendo
 * productos distintos.
 *
 * Este test convierte esa duplicacion inevitable en una duplicacion vigilada.
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
  ADMIN_ROLE_CONFLICTS,
  ADMIN_ROLE_KEYS,
  PERMISSIONS,
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
const rbacSql = readMigration("0001_identity_and_rbac.sql");
const promotionsSql = readMigration("0002_promotions.sql");

/** Extrae los valores de `CREATE TYPE <name> AS ENUM (...)`. */
function parseSqlEnum(sql: string, typeName: string): string[] {
  const pattern = new RegExp(String.raw`CREATE\s+TYPE\s+${typeName}\s+AS\s+ENUM\s*\(([^)]*)\)`, "iu");
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

describe("paridad de enumerados: SQL <-> Drizzle <-> dominio", () => {
  const cases = [
    { type: "identity_status", drizzle: identityStatusEnum.enumValues, domain: IDENTITY_STATUSES },
    { type: "participant_status", drizzle: participantStatusEnum.enumValues, domain: PARTICIPANT_STATUSES },
    {
      type: "participant_review_state",
      drizzle: participantReviewStateEnum.enumValues,
      domain: PARTICIPANT_REVIEW_STATES,
    },
    { type: "admin_user_status", drizzle: adminUserStatusEnum.enumValues, domain: ADMIN_USER_STATUSES },
    { type: "promotion_status", drizzle: promotionStatusEnum.enumValues, domain: PROMOTION_STATUSES },
    { type: "rules_version_status", drizzle: rulesVersionStatusEnum.enumValues, domain: RULES_VERSION_STATUSES },
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

describe("paridad del catalogo RBAC (DEC-015)", () => {
  it("los permisos del SQL y los de TypeScript son exactamente los mismos", () => {
    const block = parseInsertBlock(rbacSql, "admin_permissions");
    const parsed = [...block.matchAll(/\(\s*'([a-z0-9_.]+)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/gu)].map(
      (match) => ({
        key: match[1] ?? "",
        description: match[2] ?? "",
        isSensitive: match[3] === "true",
        requiresStepUp: match[4] === "true",
      }),
    );

    expect(parsed.length).toBe(PERMISSIONS.length);
    expect(parsed.map((p) => p.key).sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());

    const sqlIndex = new Map(parsed.map((p) => [p.key, p]));
    for (const permission of PERMISSIONS) {
      const fromSql = sqlIndex.get(permission.key);
      expect(fromSql, `permiso ausente en SQL: ${permission.key}`).toBeDefined();
      expect(fromSql?.isSensitive, `is_sensitive difiere en ${permission.key}`).toBe(permission.isSensitive);
      expect(fromSql?.requiresStepUp, `requires_step_up difiere en ${permission.key}`).toBe(permission.requiresStepUp);
      expect(fromSql?.description, `description difiere en ${permission.key}`).toBe(permission.description);
    }
  });

  it("los roles del SQL y los de TypeScript son exactamente los mismos", () => {
    const block = parseInsertBlock(rbacSql, "admin_roles");
    const parsed = [...block.matchAll(/\(\s*'([A-Z_]+)'\s*,/gu)].map((match) => match[1] ?? "");
    expect(parsed.sort()).toEqual([...ADMIN_ROLE_KEYS].sort());
  });

  it("todo permiso asignado a un rol existe en el catalogo", () => {
    const block = parseInsertBlock(rbacSql, "admin_role_permissions");
    const assignments = [...block.matchAll(/\(\s*'([A-Z_]+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/gu)].map((match) => ({
      role: match[1] ?? "",
      permission: match[2] ?? "",
    }));

    expect(assignments.length).toBeGreaterThan(0);

    const knownRoles = new Set<string>(ADMIN_ROLE_KEYS);
    const knownPermissions = new Set(PERMISSIONS.map((p) => p.key));

    for (const assignment of assignments) {
      expect(knownRoles.has(assignment.role), `rol desconocido: ${assignment.role}`).toBe(true);
      expect(knownPermissions.has(assignment.permission), `permiso desconocido: ${assignment.permission}`).toBe(true);
    }
  });

  it("SUPER_ADMIN no puede finalizar exports ni ejecutar sorteos (DEC-017)", () => {
    // Si el rol con mas privilegios acumulara ambas capacidades, la separacion
    // de funciones se eludiria simplemente usando esa cuenta.
    const block = parseInsertBlock(rbacSql, "admin_role_permissions");
    const superAdminPermissions = [...block.matchAll(/\(\s*'SUPER_ADMIN'\s*,\s*'([a-z0-9_.]+)'\s*\)/gu)].map(
      (match) => match[1] ?? "",
    );

    expect(superAdminPermissions).not.toContain("export.finalize");
    expect(superAdminPermissions).not.toContain("draw.execute");
    expect(superAdminPermissions).not.toContain("draw.authorize");
  });

  it("los pares de roles incompatibles del SQL coinciden con los de TypeScript", () => {
    const block = parseInsertBlock(rbacSql, "admin_role_conflicts");
    const parsed = [...block.matchAll(/\(\s*'([A-Z_]+)'\s*,\s*'([A-Z_]+)'\s*,/gu)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]);

    expect(parsed).toEqual(ADMIN_ROLE_CONFLICTS.map(([a, b]) => [a, b]));
  });

  it("cada permiso con step-up esta marcado tambien como sensible", () => {
    for (const permission of PERMISSIONS) {
      if (permission.requiresStepUp) {
        expect(permission.isSensitive, `${permission.key} exige step-up sin ser sensible`).toBe(true);
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

    const fromSql = [...promotionsSql.slice(start, end).matchAll(/'([a-z0-9_]+)'/gu)].map((match) => match[1] ?? "");
    expect(fromSql.sort()).toEqual([...REQUIRED_RULES_KEYS].sort());
  });
});
