/**
 * `audit_events` CONTRA POSTGRESQL REAL (DEC-007, DEC-008, DEC-009, HO-028).
 *
 * ---------------------------------------------------------------------------
 * ESTADO: ESCRITO, NO EJECUTADO
 * ---------------------------------------------------------------------------
 *
 * En la maquina donde se escribio este archivo NO HAY DOCKER, asi que no se ha
 * ejecutado ni una vez. Se deja escrito y sin `skip`: la suite `integration`
 * esta separada de la unitaria en `vitest.config.ts` y solo corre con
 * `pnpm --filter @lsw/database test:integration`.
 *
 * No se marca como omitido a proposito. Un `describe.skip` diria "esto pasa" en
 * verde y no seria verdad; asi, el dia que alguien tenga Docker, el fichero
 * corre y falla si algo no es como aqui se afirma. La primera ejecucion es
 * parte del trabajo pendiente, y esta anotada como tal.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO PUEDE SER UN TEST UNITARIO
 * ---------------------------------------------------------------------------
 *
 * Ninguna de las garantias de aqui vive en el codigo. Viven en el motor:
 * privilegios por rol, triggers `plpgsql`, un CHECK que ata la clave de cadena a
 * la promocion, un `UNIQUE` compuesto y `pg_advisory_xact_lock`. Un doble las
 * simularia todas correctamente y no probaria ninguna (DEC-018).
 *
 * La otra mitad -que el HASH sea el de DEC-035, que una fila alterada deje de
 * cuadrar- se prueba en `tests/security/src/audit/`, con el puerto de
 * encadenado de produccion y sin base de datos. Cada mitad se prueba donde se
 * puede probar de verdad.
 *
 * ---------------------------------------------------------------------------
 * EL PUERTO DE ENCADENADO DE ESTE FICHERO ES DE JUGUETE, Y ES CORRECTO QUE LO SEA
 * ---------------------------------------------------------------------------
 *
 * `packages/database` no depende de `@lsw/audit` (ver la cabecera de
 * `src/repositories/tpa-ports.ts`), asi que aqui no esta el preimage real. Y no
 * hace falta: lo que este fichero comprueba es que el ADAPTADOR habla bien con
 * el motor -cerrojo, cabeza, INSERT, restricciones-, no que el hash sea
 * correcto. Un puerto de juguete determinista basta para eso y deja claro donde
 * esta la frontera.
 *
 * Requiere Docker. `pnpm --filter @lsw/database test:integration`.
 */

import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import {
  DrizzleAuditEventRepository,
  auditChainKeyFor,
  type AuditEventChainPort,
  type AuditEventFieldsInput,
} from "../../src/repositories/audit-event-repository.js";
import { DrizzleUnitOfWork } from "../../src/repositories/executor.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";

let testDb: TestDatabase;
let app: Database;
let migrator: Database;
let readonlyReport: Database;

let promotionId: string;
let adminUserId: string;

/** Configuracion de PRUEBA. No son valores legales: son fixtures. */
const FIXTURE_CONFIG = {
  eligibility: "FIXTURE_ONLY",
  allowed_jurisdictions: ["FIXTURE_ONLY"],
  minimum_age: 999,
  promotion_start_end_rules: "FIXTURE_ONLY",
  entry_limits: "FIXTURE_ONLY",
  product_eligibility: "FIXTURE_ONLY",
  purchase_entry_formula: "FIXTURE_ONLY",
  official_rules_document: "FIXTURE_ONLY",
  controlling_language: "FIXTURE_ONLY",
  winner_drawing_method: "FIXTURE_ONLY",
  partial_refund_rounding_policy: "FIXTURE_ONLY",
  entry_expiration: "FIXTURE_ONLY",
};

/**
 * Puerto de encadenado DE JUGUETE. No es el preimage de DEC-035.
 *
 * Es determinista y encadenado -el hash de una fila depende del anterior- que
 * es lo unico que este fichero necesita para ejercitar el adaptador. El
 * preimage de verdad vive en `@lsw/audit` y se prueba alli.
 */
const toyChainPort: AuditEventChainPort = {
  canonicalizationVersion: 1,
  genesisHashHex: (chainKey) =>
    createHash("sha256").update(`TOY/GENESIS/${chainKey}`).digest("hex"),
  hashEvent: ({ chainKey, previousHashHex, fields }) =>
    createHash("sha256")
      .update(`TOY/${chainKey}/${previousHashHex}/${fields.id}/${fields.recordedAt}`)
      .digest("hex"),
};

async function singleValue<T>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute<Record<string, T>>(query);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("La consulta no devolvio ninguna fila.");
  }
  const value = Object.values(row)[0];
  if (value === undefined) {
    throw new Error("La consulta no devolvio ninguna columna.");
  }
  return value;
}

function buildFields(
  index: number,
  overrides: Partial<AuditEventFieldsInput> = {},
): AuditEventFieldsInput {
  const minute = index.toString(10).padStart(2, "0");
  return {
    id: randomUUID(),
    occurredAt: `2026-09-02T10:${minute}:00.000Z`,
    recordedAt: `2026-09-02T10:${minute}:01.000Z`,
    actorType: "STAFF",
    actorId: adminUserId,
    actorRoles: ["promotions_manager"],
    action: "entry.adjustment_approved",
    targetEntityType: "Adjustment",
    targetEntityId: `adjustment-${minute}`,
    promotionId,
    requestId: `req-${minute}`,
    before: null,
    after: null,
    reasonCode: "MANUAL_ADJUSTMENT_APPROVED",
    reasonText: null,
    sourceIp: null,
    userAgent: null,
    metadata: { index },
    ...overrides,
  };
}

function repositoryFor(db: Database): DrizzleAuditEventRepository {
  return new DrizzleAuditEventRepository(db, { chainPort: toyChainPort });
}

async function appendThrough(db: Database, fields: AuditEventFieldsInput): Promise<string> {
  const unitOfWork = new DrizzleUnitOfWork(db);
  const repository = repositoryFor(db);
  const appended = await unitOfWork.withTransaction(() => repository.append(fields));
  return appended.chainHashHex;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  migrator = testDb.connectAs("migrator").db;
  readonlyReport = testDb.connectAs("readonly_report").db;

  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES ('audit-fixture@example.invalid', 'ACTIVE') RETURNING id`,
  );
  adminUserId = await singleValue<string>(
    migrator,
    sql`INSERT INTO admin_users (identity_id, status) VALUES (${identityId}, 'ACTIVE') RETURNING id`,
  );
  promotionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone, starts_at, ends_at)
        VALUES ('audit-fixture', 'audit fixture', 'America/Chicago',
                '2026-09-01T05:00:00Z', '2026-10-01T05:00:00Z')
        RETURNING id`,
  );
  await singleValue<string>(
    app,
    sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, created_by_admin_user_id)
        VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_CONFIG)}::jsonb, ${adminUserId})
        RETURNING id`,
  );
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

describe("DEC-007 capa 3: la tabla no se puede editar ni borrar, con NINGUN rol", () => {
  it("el rol de la aplicacion no puede hacer UPDATE", async () => {
    await appendThrough(app, buildFields(1));
    await expect(
      app.execute(sql`UPDATE audit_events SET action = 'promotion.closed'`),
    ).rejects.toThrow();
  });

  it("el rol de la aplicacion no puede hacer DELETE", async () => {
    await expect(app.execute(sql`DELETE FROM audit_events`)).rejects.toThrow();
  });

  it("el MIGRATOR tampoco: ahi es el trigger quien lo impide, no el permiso", async () => {
    // Este es el caso que los privilegios NO cubren, y por el que DEC-007 exige
    // tres capas: el migrator aplica el esquema, asi que tiene privilegios de
    // sobra. Lo detiene `lsw_reject_mutation()`.
    await expect(
      migrator.execute(sql`UPDATE audit_events SET reason_text = 'reescrito'`),
    ).rejects.toThrow(/DEC-007/u);
    await expect(migrator.execute(sql`DELETE FROM audit_events`)).rejects.toThrow(/DEC-007/u);
  });

  it("el rol de informes no puede ni insertar", async () => {
    await expect(
      readonlyReport.execute(
        sql`INSERT INTO audit_events (id, chain_key, occurred_at, recorded_at, actor_type,
                                      actor_roles, action, target_entity_type, metadata,
                                      canonicalization_version, chain_prev_hash, chain_hash)
            VALUES (gen_random_uuid(), 'global', now(), now(), 'SYSTEM', '[]'::jsonb,
                    'audit.integrity_check', 'audit_events', '{}'::jsonb, 1,
                    repeat('0', 64), repeat('1', 64))`,
      ),
    ).rejects.toThrow();
  });
});

describe("DEC-008: la cadena no se puede bifurcar ni desviar", () => {
  it("dos escrituras seguidas encadenan", async () => {
    const first = await appendThrough(app, buildFields(10));
    const second = await appendThrough(app, buildFields(11));

    const rows = await repositoryFor(app).readChain(promotionId);
    const last = rows.at(-1);
    expect(last?.chainHashHex).toBe(second);
    expect(last?.chainPrevHashHex).toBe(first);
  });

  it("un eslabon que no engancha con la cabeza es rechazado por el trigger", async () => {
    const head = await repositoryFor(app).headHash(promotionId);
    expect(head).not.toBeNull();

    await expect(
      app.execute(
        sql`INSERT INTO audit_events (id, chain_key, occurred_at, recorded_at, actor_type,
                                      actor_roles, action, target_entity_type, metadata,
                                      canonicalization_version, chain_prev_hash, chain_hash)
            VALUES (gen_random_uuid(), ${promotionId}, now(), now(), 'SYSTEM', '[]'::jsonb,
                    'audit.integrity_check', 'audit_events', '{}'::jsonb, 1,
                    repeat('a', 64), repeat('b', 64))`,
      ),
    ).rejects.toThrow(/no engancha con la cadena/u);
  });

  it("dos filas no pueden declarar el mismo antecesor", async () => {
    // Se salta el trigger imposible de saltar? No: se comprueba la OTRA capa.
    // El trigger rechazaria por no enganchar, asi que para aislar la
    // restriccion unica se inserta desde la cabeza real DOS veces.
    const head = await repositoryFor(app).headHash(promotionId);

    await app.execute(
      sql`INSERT INTO audit_events (id, chain_key, occurred_at, recorded_at, actor_type,
                                    actor_roles, action, target_entity_type, metadata,
                                    canonicalization_version, chain_prev_hash, chain_hash)
          VALUES (gen_random_uuid(), ${promotionId}, now(), now(), 'SYSTEM', '[]'::jsonb,
                  'audit.integrity_check', 'audit_events', '{}'::jsonb, 1,
                  ${head}, repeat('c', 64))`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO audit_events (id, chain_key, occurred_at, recorded_at, actor_type,
                                      actor_roles, action, target_entity_type, metadata,
                                      canonicalization_version, chain_prev_hash, chain_hash)
            VALUES (gen_random_uuid(), ${promotionId}, now(), now(), 'SYSTEM', '[]'::jsonb,
                    'audit.integrity_check', 'audit_events', '{}'::jsonb, 1,
                    ${head}, repeat('d', 64))`,
      ),
    ).rejects.toThrow();
  });

  it("dos transacciones concurrentes producen una cadena lineal, no una bifurcada", async () => {
    // El caso real: dos peticiones administrativas simultaneas sobre la misma
    // promocion. Sin `pg_advisory_xact_lock` las dos leerian la misma cabeza.
    const before = (await repositoryFor(app).readChain(promotionId)).length;

    await Promise.all([appendThrough(app, buildFields(20)), appendThrough(app, buildFields(21))]);

    const rows = await repositoryFor(app).readChain(promotionId);
    expect(rows).toHaveLength(before + 2);

    // Encadenamiento estricto en orden de `sequence_no`.
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows.at(index)?.chainPrevHashHex).toBe(rows.at(index - 1)?.chainHashHex);
    }
  });

  it("la clave de cadena no puede divergir de la promocion", async () => {
    // `chain_key = 'global'` con `promotion_id` relleno: es la fila que
    // acabaria en la cadena equivocada. El CHECK la rechaza.
    await expect(
      app.execute(
        sql`INSERT INTO audit_events (id, chain_key, promotion_id, occurred_at, recorded_at,
                                      actor_type, actor_roles, action, target_entity_type,
                                      metadata, canonicalization_version, chain_prev_hash,
                                      chain_hash)
            VALUES (gen_random_uuid(), 'global', ${promotionId}, now(), now(), 'SYSTEM',
                    '[]'::jsonb, 'audit.integrity_check', 'audit_events', '{}'::jsonb, 1,
                    repeat('e', 64), repeat('f', 64))`,
      ),
    ).rejects.toThrow();
  });

  it("los hechos sin promocion van a la cadena global", async () => {
    await appendThrough(app, buildFields(30, { promotionId: null, action: "rbac.role_assigned" }));

    expect(auditChainKeyFor(null)).toBe("global");
    const keys = await repositoryFor(app).listChainKeys();
    expect(keys).toContain("global");
    expect(keys).toContain(promotionId);

    const globalChain = await repositoryFor(app).readChain("global");
    expect(globalChain.at(0)?.fields.promotionId).toBeNull();
  });
});

describe("minimizacion y forma de los datos", () => {
  it("source_ip rechaza una direccion IP", async () => {
    await expect(
      appendThrough(app, buildFields(40, { sourceIp: "203.0.113.7" })),
    ).rejects.toThrow();
  });

  it("source_ip acepta un digest de 64 hexadecimales", async () => {
    const digest = createHash("sha256").update("fixture").digest("hex");
    await expect(appendThrough(app, buildFields(41, { sourceIp: digest }))).resolves.toBeTypeOf(
      "string",
    );
  });

  it("metadata tiene que ser un objeto", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO audit_events (id, chain_key, occurred_at, recorded_at, actor_type,
                                      actor_roles, action, target_entity_type, metadata,
                                      canonicalization_version, chain_prev_hash, chain_hash)
            VALUES (gen_random_uuid(), 'global', now(), now(), 'SYSTEM', '[]'::jsonb,
                    'audit.integrity_check', 'audit_events', '[]'::jsonb, 1,
                    repeat('a', 64), repeat('b', 64))`,
      ),
    ).rejects.toThrow();
  });

  it("un actor ANONYMOUS no puede llevar identificador", async () => {
    await expect(
      appendThrough(
        app,
        buildFields(42, { actorType: "ANONYMOUS", actorId: adminUserId, promotionId: null }),
      ),
    ).rejects.toThrow();
  });

  it("una accion que no tiene la forma del catalogo se rechaza", async () => {
    await expect(
      appendThrough(app, buildFields(43, { action: "El administrador aprobo el ajuste" })),
    ).rejects.toThrow();
  });
});

describe("HO-028: sin puerto de encadenado no se escribe nada", () => {
  it("un repositorio sin chainPort se niega en vez de escribir una fila sin hash", async () => {
    const unconfigured = new DrizzleAuditEventRepository(app);
    expect(unconfigured.isConfigured).toBe(false);

    await expect(
      new DrizzleUnitOfWork(app).withTransaction(() => unconfigured.append(buildFields(50))),
    ).rejects.toThrow(/puerto de encadenado/u);
  });

  it("fuera de transaccion tampoco: el evento va con el hecho que audita", async () => {
    await expect(repositoryFor(app).append(buildFields(51))).rejects.toThrow(/transaccion viva/u);
  });
});
