/**
 * Auditoria estatica de las migraciones.
 *
 * Estas comprobaciones existen porque DEC-005 promete algo concreto: que un
 * tercero pueda ABRIR una migracion y verificar sus garantias sin ejecutarla.
 * Si esa promesa no se comprueba automaticamente, se erosiona en el tercer
 * sprint.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

interface MigrationFile {
  readonly name: string;
  /** Contenido literal del archivo, comentarios incluidos. */
  readonly sql: string;
  /**
   * El mismo SQL sin comentarios `--`.
   *
   * Las comprobaciones de INVARIANTES DE DOMINIO tienen que mirar aqui, no al
   * texto completo. La migracion `0001` explica en un comentario por que NO
   * existe una columna `is_admin`; buscar la cadena en el archivo entero
   * convierte esa explicacion en un fallo. Lo que se quiere comprobar es lo
   * que la base de datos hace, y un comentario no hace nada.
   *
   * Las comprobaciones de PERMISOS siguen usando `sql`: un GRANT nunca vive
   * dentro de un comentario, y ahi el falso positivo es preferible al falso
   * negativo.
   */
  readonly statements: string;
}

/** Quita comentarios de linea `--`, respetando los que van dentro de literales. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      let inString = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === "'") {
          inString = !inString;
          continue;
        }
        if (!inString && character === "-" && line[index + 1] === "-") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

function loadMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      return { name, sql, statements: stripLineComments(sql) };
    });
}

/** Tablas cuyo append-only es una garantia estructural (DEC-007). */
const APPEND_ONLY_TABLES = ["entry_transactions", "audit_events", "export_snapshots"];

const migrations = loadMigrations();

describe("migraciones: forma y legibilidad (DEC-005)", () => {
  it("existe al menos una migracion", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("todas siguen la convencion NNNN_nombre.sql y estan numeradas sin huecos", () => {
    migrations.forEach((migration, index) => {
      expect(migration.name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/u);
      expect(migration.name.slice(0, 4)).toBe(String(index).padStart(4, "0"));
    });
  });

  it("todas usan finales de linea LF (DEC-026: el hash de un export no puede depender del sistema operativo)", () => {
    for (const migration of migrations) {
      expect(migration.sql.includes("\r"), `${migration.name} contiene CR`).toBe(false);
    }
  });

  it("todas estan referenciadas en el journal de drizzle, en el mismo orden", () => {
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(
      migrations.map((m) => m.name),
    );
    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
    });
  });
});

describe("migraciones: invariantes de permisos (DEC-003, DEC-007)", () => {
  it("ninguna concede UPDATE o DELETE al rol app sobre una tabla append-only", () => {
    for (const migration of migrations) {
      for (const table of APPEND_ONLY_TABLES) {
        const offending = new RegExp(
          String.raw`GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*\bON\b[^;]*\b${table}\b[^;]*\blsw_app\b`,
          "isu",
        );
        expect(
          offending.test(migration.sql),
          `${migration.name} concede escritura sobre ${table}`,
        ).toBe(false);
      }
    }
  });

  it("ningun ALTER DEFAULT PRIVILEGES concede escritura sobre TABLAS futuras al rol app", () => {
    // El riesgo concreto: con un privilegio por defecto de UPDATE, el dia que
    // se cree `entry_transactions` el rol `app` lo heredaria en silencio y
    // DEC-007 quedaria roto sin que nadie escribiera SQL equivocado.
    for (const migration of migrations) {
      const statements = migration.sql.split(";");
      for (const statement of statements) {
        if (!/ALTER\s+DEFAULT\s+PRIVILEGES/iu.test(statement)) {
          continue;
        }
        if (!/\bON\s+TABLES\b/iu.test(statement)) {
          continue;
        }
        if (!/\blsw_app\b/iu.test(statement)) {
          continue;
        }
        expect(
          /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b/iu.test(statement),
          `${migration.name} concede escritura por defecto a lsw_app`,
        ).toBe(false);
      }
    }
  });

  it("los tres roles de DEC-003 se crean en la migracion base", () => {
    const baseline = migrations[0];
    expect(baseline).toBeDefined();
    for (const role of ["lsw_migrator", "lsw_app", "lsw_readonly_report"]) {
      expect(baseline?.sql).toContain(`CREATE ROLE ${role} LOGIN`);
    }
  });

  it("ningun rol se crea con contrasena escrita en el repositorio (principios 19 y 20)", () => {
    for (const migration of migrations) {
      expect(
        /CREATE\s+ROLE[^;]*PASSWORD/iu.test(migration.sql),
        `${migration.name} fija una contrasena`,
      ).toBe(false);
      expect(
        /ALTER\s+ROLE[^;]*PASSWORD\s+'/iu.test(migration.sql),
        `${migration.name} fija una contrasena`,
      ).toBe(false);
    }
  });
});

describe("migraciones: invariantes de dominio", () => {
  it("no hay ninguna columna monetaria en coma flotante (DEC-010)", () => {
    for (const migration of migrations) {
      expect(
        /\b(amount|price|total|subtotal)\w*\s+(numeric|decimal|real|double\s+precision|float)/iu.test(
          migration.statements,
        ),
        migration.name,
      ).toBe(false);
    }
  });

  it("todas las columnas de instante son timestamptz, nunca timestamp sin zona (DEC-011)", () => {
    for (const migration of migrations) {
      const naive = /\b\w+\s+timestamp(?!tz)\b(?!\s+with\s+time\s+zone)/giu;
      const matches = migration.statements.match(naive) ?? [];
      expect(
        matches,
        `${migration.name} usa timestamp sin zona: ${matches.join(", ")}`,
      ).toHaveLength(0);
    }
  });

  it("no existe ninguna columna is_admin: la autorizacion es por capacidades", () => {
    for (const migration of migrations) {
      expect(/\bis_admin\b/iu.test(migration.statements), migration.name).toBe(false);
    }
  });

  it("ninguna migracion activa un sorteo interno ni siembra una autorizacion de sorteo (DEC-017)", () => {
    for (const migration of migrations) {
      expect(
        /internal_draw_enabled\s*(boolean\s*)?(NOT NULL\s*)?DEFAULT\s+true/iu.test(
          migration.statements,
        ),
        migration.name,
      ).toBe(false);
      expect(
        /INSERT\s+INTO\s+draw_authorizations/iu.test(migration.statements),
        migration.name,
      ).toBe(false);
    }
  });

  it("no siembra ningun valor legal: solo nombres de clave (DEC-012, principio 2)", () => {
    // El riesgo concreto seria una migracion que insertara, por ejemplo, una
    // edad minima o una lista de jurisdicciones. Esos valores los fija el
    // abogado del cliente y viven en `PromotionRulesVersion` como datos
    // cargados, no en el esquema.
    const promotionsMigration = migrations.find((m) => m.name.includes("promotions"));
    expect(promotionsMigration).toBeDefined();
    expect(/minimum_age\s*'?\s*[:=]\s*\d/iu.test(promotionsMigration?.statements ?? "")).toBe(
      false,
    );
    expect(
      /INSERT\s+INTO\s+promotion_rules_versions/iu.test(promotionsMigration?.statements ?? ""),
    ).toBe(false);
  });
});
