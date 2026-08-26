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
  AMOE_MODES,
  ENTRY_ACTOR_TYPES,
  ENTRY_SOURCE_TYPES,
  ENTRY_TRANSACTION_STATUSES,
  ENTRY_TRANSACTION_TYPES,
  IDENTITY_STATUSES,
  LOCALE_CODES,
  PARTICIPANT_REVIEW_STATES,
  PARTICIPANT_STATUSES,
  PRODUCT_STATUSES,
  PROMOTION_STATUSES,
  REQUIRED_RULES_KEYS,
  RULES_VERSION_STATUSES,
} from "@lsw/sweepstakes";
import {
  AMOE_MODES as SECURITY_AMOE_MODES,
  FEATURE_FLAG_KEYS as SECURITY_FEATURE_FLAG_KEYS,
} from "@lsw/security";
import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLES,
  ADMIN_ROLE_CONFLICTS,
  ADMIN_ROLE_KEYS,
  ADMIN_ROLE_PERMISSIONS,
  FEATURE_FLAG_SEED_ROWS,
  FLAGS_ENABLED_AT_SEED,
  PERMISSIONS,
  ROLE_CAPABILITIES,
  SEPARATION_OF_DUTIES,
  STAFF_ASSIGNABLE_ROLE_KEYS,
  adminUserStatusEnum,
  amoeModeEnum,
  entryActorTypeEnum,
  entrySourceTypeEnum,
  entryTransactionStatusEnum,
  entryTransactionTypeEnum,
  featureFlagKeyEnum,
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
const rbacReadSql = readMigration("0007_rbac_read_capabilities.sql");

/**
 * Migraciones que siembran el catalogo RBAC, en orden de aplicacion.
 *
 * Son DOS porque DEC-005 fija migraciones forward-only: cuando `security`
 * resolvio `HO-013` anadiendo las capacidades de lectura que faltaban, la
 * respuesta correcta no fue editar `0004` -eso dejaria dos entornos con la
 * misma version de esquema y catalogos distintos- sino escribir `0007`.
 *
 * Este test compara la UNION contra el catalogo, de modo que la particion entre
 * migraciones puede cambiar sin que la garantia cambie.
 */
const RBAC_SEED_MIGRATIONS = [rbacSql, rbacReadSql] as const;

function parseSeedRowsAcross(table: string): string[][] {
  return RBAC_SEED_MIGRATIONS.flatMap((sql) =>
    sql.includes(`INSERT INTO ${table}`) ? parseValueTuples(parseInsertBlock(sql, table)) : [],
  );
}

const flagsSql = readMigration("0005_feature_flags.sql");
const ledgerSql = readMigration("0006_entry_ledger.sql");

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

/**
 * Extrae el cuerpo de un `INSERT INTO <table> ... VALUES ...;`.
 *
 * El punto y coma que cierra la sentencia se busca FUERA de los literales de
 * texto. Buscar el primero a secas parecia bastar hasta que una descripcion del
 * catalogo incluyo un punto y coma: el bloque se cortaba por la mitad, el test
 * comparaba tres filas menos de las que la migracion siembra de verdad y
 * culpaba a la migracion. Un parser que se equivoca callado es peor que no
 * tener parser.
 */
function parseInsertBlock(sql: string, table: string): string {
  const start = sql.indexOf(`INSERT INTO ${table}`);
  if (start === -1) {
    throw new Error(`No se encontro INSERT INTO ${table}.`);
  }

  let inString = false;
  for (let index = start; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      // `''` es una comilla escapada, no el fin del literal.
      if (inString && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (!inString && character === ";") {
      return sql.slice(start, index);
    }
  }

  throw new Error(`El INSERT INTO ${table} no termina en punto y coma.`);
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

describe("paridad de enumerados de flags y ledger (migraciones 0005 y 0006)", () => {
  const flagCases = [
    { sql: flagsSql, type: "amoe_mode", drizzle: amoeModeEnum.enumValues, domain: AMOE_MODES },
    {
      sql: ledgerSql,
      type: "entry_source_type",
      drizzle: entrySourceTypeEnum.enumValues,
      domain: ENTRY_SOURCE_TYPES,
    },
    {
      sql: ledgerSql,
      type: "entry_transaction_type",
      drizzle: entryTransactionTypeEnum.enumValues,
      domain: ENTRY_TRANSACTION_TYPES,
    },
    {
      sql: ledgerSql,
      type: "entry_transaction_status",
      drizzle: entryTransactionStatusEnum.enumValues,
      domain: ENTRY_TRANSACTION_STATUSES,
    },
    {
      sql: ledgerSql,
      type: "entry_actor_type",
      drizzle: entryActorTypeEnum.enumValues,
      domain: ENTRY_ACTOR_TYPES,
    },
  ] as const;

  for (const testCase of flagCases) {
    it(`${testCase.type} coincide en las tres fuentes`, () => {
      const fromSql = parseSqlEnum(testCase.sql, testCase.type);
      expect(fromSql).toEqual([...testCase.drizzle]);
      expect(fromSql).toEqual([...testCase.domain]);
    });
  }

  it("feature_flag_key coincide con el catalogo canonico de DEC-032", () => {
    const fromSql = parseSqlEnum(flagsSql, "feature_flag_key");
    expect(fromSql).toEqual([...featureFlagKeyEnum.enumValues]);
    expect(fromSql).toEqual([...SECURITY_FEATURE_FLAG_KEYS]);
  });

  it("las modalidades AMOE coinciden entre @lsw/sweepstakes y @lsw/security", () => {
    // Los dos paquetes declararon esta lista por separado, trabajando en
    // paralelo, y por suerte coincidieron. La suerte no es un control: mientras
    // las dos copias existan, esta comprobacion es lo que impide que diverjan.
    expect([...SECURITY_AMOE_MODES]).toEqual([...AMOE_MODES]);
  });

  it("el enum de modalidad AMOE no lleva DISABLED: eso lo responde el flag", () => {
    // Dos fuentes de verdad para "hay via AMOE?" no tienen respuesta correcta
    // el dia que discrepan. CLAUDE.md seccion 4.
    expect(parseSqlEnum(flagsSql, "amoe_mode")).not.toContain("DISABLED");
  });

  it("el ledger NO declara un tipo EXPIRATION (DEC-033 lo modela como propiedad)", () => {
    expect(parseSqlEnum(ledgerSql, "entry_transaction_type")).not.toContain("EXPIRATION");
  });
});

describe("paridad del catalogo de feature flags (DEC-013, DEC-032)", () => {
  const seededRows = parseValueTuples(parseInsertBlock(flagsSql, "feature_flags")).map(
    (columns) => ({
      key: columns[0] ?? "",
      enabled: asBoolean(columns[1]),
      dec032Default: asBoolean(columns[2]),
      isLegallyMaterial: asBoolean(columns[3]),
      labelKey: columns[4] ?? "",
      // columns[5] es la descripcion interna, que no forma parte del contrato.
      legalDependency: asNullableText(columns[6]),
    }),
  );

  it("la migracion siembra exactamente los 12 flags del catalogo", () => {
    expect(seededRows.length).toBe(FEATURE_FLAG_SEED_ROWS.length);
    expect(seededRows.map((row) => row.key)).toEqual(FEATURE_FLAG_SEED_ROWS.map((row) => row.key));
  });

  it("cada fila sembrada coincide campo a campo con el catalogo", () => {
    const sqlIndex = new Map(seededRows.map((row) => [row.key, row]));
    for (const expected of FEATURE_FLAG_SEED_ROWS) {
      const fromSql = sqlIndex.get(expected.key);
      expect(fromSql, `flag ausente en SQL: ${expected.key}`).toBeDefined();
      expect(fromSql?.enabled, expected.key).toBe(expected.enabled);
      expect(fromSql?.dec032Default, expected.key).toBe(expected.dec032Default);
      expect(fromSql?.isLegallyMaterial, expected.key).toBe(expected.isLegallyMaterial);
      expect(fromSql?.labelKey, expected.key).toBe(expected.labelKey);
      expect(fromSql?.legalDependency, expected.key).toBe(expected.legalDependency);
    }
  });

  it("solo UN flag arranca encendido, y es el de la segunda aprobacion", () => {
    // Principio 12. Un control que hay que acordarse de activar para estar
    // protegido acaba desactivado; el resto de flags amplian capacidades y su
    // postura segura es la contraria.
    expect(FLAGS_ENABLED_AT_SEED).toEqual(["dual_approval_for_sensitive_actions_enabled"]);
    expect(seededRows.filter((row) => row.enabled).map((row) => row.key)).toEqual([
      "dual_approval_for_sensitive_actions_enabled",
    ]);
  });

  it("el sorteo interno se siembra apagado (DEC-017 cerrojo 1)", () => {
    const draw = seededRows.find((row) => row.key.includes("draw"));
    expect(draw?.enabled).toBe(false);
    expect(draw?.dec032Default).toBe(false);
  });
});

describe("garantias estructurales del entry ledger (DEC-007, DEC-009)", () => {
  it("la tabla del ledger lleva trigger BEFORE UPDATE OR DELETE (capa 2)", () => {
    expect(ledgerSql).toMatch(
      /CREATE\s+TRIGGER\s+entry_transactions_reject_mutation\s+BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+entry_transactions/iu,
    );
  });

  it("el rol de la aplicacion solo recibe SELECT e INSERT sobre el ledger (capa 1)", () => {
    expect(ledgerSql).toMatch(
      /GRANT\s+SELECT,\s*INSERT\s+ON\s+entry_transactions\s+TO\s+lsw_app/iu,
    );
    expect(ledgerSql).toMatch(
      /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+entry_transactions\s+FROM\s+lsw_app/iu,
    );
  });

  it("la idempotencia es una restriccion de unicidad, no un if (DEC-009)", () => {
    expect(ledgerSql).toMatch(
      /UNIQUE\s*\(\s*promotion_id\s*,\s*source_type\s*,\s*source_ref\s*\)/iu,
    );
    expect(ledgerSql).toMatch(/UNIQUE\s*\(\s*provider\s*,\s*provider_event_id\s*\)/iu);
  });

  it("los rangos de numeros no pueden solaparse: exclusion GiST sobre int8range (DEC-009)", () => {
    expect(ledgerSql).toMatch(
      /EXCLUDE\s+USING\s+gist\s*\(\s*promotion_id\s+WITH\s+=\s*,\s*number_range\s+WITH\s+&&\s*\)/iu,
    );
    expect(ledgerSql).toMatch(/pg_advisory_xact_lock/iu);
  });

  it("el ledger no declara ninguna columna de saldo: el saldo es derivado (DEC-007)", () => {
    // El fallo que esto previene es concreto: alguien anade
    // `participants.total_entries` para no recorrer el ledger, y a partir de
    // ese dia hay dos respuestas posibles a cuantas entries tiene alguien.
    expect(ledgerSql).not.toMatch(
      /\b(total_entries|entry_balance|current_entries)\s+(integer|bigint)/iu,
    );
  });

  it("el bloque de numeros no DECLARA cantidad activa mutable", () => {
    // Se busca una declaracion de columna, no la mencion: la cabecera de la
    // migracion explica por escrito por que esa columna no existe, y un test
    // que castigase la explicacion empujaria a borrarla.
    expect(ledgerSql).not.toMatch(/\bactive_quantity\s+(integer|bigint|smallint)\b/iu);
  });

  it("la caducidad existe como columna anulable, no como tipo de movimiento (DEC-033)", () => {
    expect(ledgerSql).toMatch(/expires_at\s+timestamptz\s*,/iu);
    expect(ledgerSql).toMatch(/expires_at\s+IS\s+NULL\s+OR\s+t\.expires_at\s*>\s*p_cutoff/iu);
  });

  it("el predicado del saldo esta escrito UNA sola vez", () => {
    // Dos copias del predicado significan que un dia la vista y la cache
    // responderan cosas distintas sobre el mismo participante.
    const occurrences = ledgerSql.match(/expires_at\s+IS\s+NULL\s+OR\s+t\.expires_at\s*>/giu) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});

describe("paridad del catalogo RBAC unificado (DEC-027, DEC-015)", () => {
  it("las capacidades sembradas son exactamente las de `@lsw/security`", () => {
    const rows = parseSeedRowsAcross("admin_permissions").map((columns) => ({
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
    }));

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

  it("la migracion 0008 asigna a cada capacidad EL flag que la gobierna, no solo si lo hay", () => {
    // Sin esta columna, `apps/api` tendria que escribir el nombre del flag a
    // mano en cada handler: el hardcoding que prohibe el principio 14,
    // repartido en tantos sitios como rutas.
    const flagSql = readMigration("0008_permission_feature_flag_key.sql");

    const assigned = new Map<string, string>();
    for (const match of flagSql.matchAll(
      /UPDATE\s+admin_permissions\s+SET\s+feature_flag_key\s*=\s*'([a-z_]+)'\s+WHERE\s+key\s+(?:=\s*'([a-z_.]+)'|IN\s*\(([^)]*)\))/giu,
    )) {
      const flag = match[1] ?? "";
      const single = match[2];
      const list = match[3];
      const keys =
        single !== undefined
          ? [single]
          : [...(list ?? "").matchAll(/'([a-z_.]+)'/gu)].map((entry) => entry[1] ?? "");
      for (const key of keys) {
        assigned.set(key, flag);
      }
    }

    const expected = new Map<string, string>();
    for (const permission of PERMISSIONS) {
      if (permission.featureFlagKey !== null) {
        expected.set(permission.key, permission.featureFlagKey);
      }
    }

    expect([...assigned.entries()].sort()).toEqual([...expected.entries()].sort());
  });

  it("el booleano deja de poder discrepar de la clave: pasa a ser columna GENERADA", () => {
    // Dos columnas que dicen lo mismo acaban diciendo cosas distintas. Esta se
    // calcula, asi que no puede.
    const flagSql = readMigration("0008_permission_feature_flag_key.sql");
    expect(flagSql).toMatch(
      /depends_on_feature_flag\s+boolean\s+GENERATED\s+ALWAYS\s+AS\s*\(\s*feature_flag_key\s+IS\s+NOT\s+NULL\s*\)/iu,
    );
  });

  it("toda clave de flag citada por una capacidad existe en el catalogo de DEC-032", () => {
    // Sin esto, una errata en el nombre del flag produciria una capacidad que
    // en la practica no esta protegida por nada, y nadie lo notaria hasta la
    // auditoria. En la base de datos lo impide ademas una clave ajena.
    for (const permission of PERMISSIONS) {
      if (permission.featureFlagKey === null) {
        continue;
      }
      expect(
        [...SECURITY_FEATURE_FLAG_KEYS].includes(
          permission.featureFlagKey as (typeof SECURITY_FEATURE_FLAG_KEYS)[number],
        ),
        `${permission.key} depende del flag inexistente ${permission.featureFlagKey}`,
      ).toBe(true);
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
    const rows = parseSeedRowsAcross("admin_role_permissions").map(
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
