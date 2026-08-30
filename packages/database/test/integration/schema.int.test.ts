/**
 * Invariantes del esquema, verificadas contra PostgreSQL 16 REAL (DEC-018).
 *
 * Cada `it` de este archivo comprueba una garantia que solo existe si el motor
 * la impone. Ninguna de ellas es testeable con un doble: son columnas
 * GENERATED, triggers `plpgsql`, `GRANT` por columna y transiciones de estado.
 *
 * Requiere Docker. Se ejecuta con `pnpm --filter @lsw/database test:integration`.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";
import { createTestAdmin } from "../support/admin-fixture.js";
import { dbErrorMatching } from "../support/db-errors.js";

let testDb: TestDatabase;
let app: Database;
/** Propietario de las tablas: solo para demostrar triggers, nunca para preparar datos. */
let owner: Database;

/** Configuracion de PRUEBA con todas las claves resueltas. No son valores legales: son fixtures. */
const FIXTURE_RESOLVED_CONFIG = {
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

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  owner = testDb.connectAsOwner().db;
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

async function createAdminUser(name: string): Promise<string> {
  // INVITED a proposito: estas pruebas ejercen GRANTs y triggers, no el login.
  const created = await createTestAdmin(app, { label: name, status: "INVITED" });
  return created.adminUserId;
}

async function createPromotion(slug: string): Promise<string> {
  const result = await app.execute<{ id: string }>(
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone, starts_at, ends_at)
        VALUES (${slug}, ${`fixture ${slug}`}, 'America/Chicago',
                '2026-09-01T05:00:00Z', '2026-10-01T05:00:00Z')
        RETURNING id`,
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("No se pudo crear la promocion de prueba.");
  }
  return id;
}

describe("DEC-003 - roles y privilegios", () => {
  it("los tres roles existen tras aplicar las migraciones", async () => {
    const result = await app.execute<{ rolname: string }>(
      sql`SELECT rolname FROM pg_roles WHERE rolname LIKE 'lsw_%' ORDER BY rolname`,
    );
    expect(result.rows.map((row) => row.rolname)).toEqual([
      "lsw_app",
      "lsw_migrator",
      "lsw_readonly_report",
    ]);
  });

  it("el rol app no puede crear tablas", async () => {
    await expect(
      app.execute(sql`CREATE TABLE app_should_not_be_able_to_do_this (id int)`),
    ).rejects.toThrow();
  });

  it("el rol app no puede borrar una asignacion de rol administrativo", async () => {
    const adminId = await createAdminUser("delete-probe-admin");
    await app.execute(
      sql`INSERT INTO admin_user_roles (admin_user_id, role_key) VALUES (${adminId}, 'COMPLIANCE_OFFICER')`,
    );
    await expect(
      app.execute(sql`DELETE FROM admin_user_roles WHERE admin_user_id = ${adminId}`),
    ).rejects.toThrow();
  });

  it("el rol app no puede reescribir quien concedio un rol, solo marcar la revocacion", async () => {
    const adminId = await createAdminUser("column-grant-probe-admin");
    await app.execute(
      sql`INSERT INTO admin_user_roles (admin_user_id, role_key) VALUES (${adminId}, 'SUPPORT')`,
    );

    await expect(
      app.execute(
        sql`UPDATE admin_user_roles SET granted_at = now() WHERE admin_user_id = ${adminId}`,
      ),
    ).rejects.toThrow();

    const revoker = await createAdminUser("revoker-admin");
    await expect(
      app.execute(
        sql`UPDATE admin_user_roles
            SET revoked_at = now(), revoked_by_admin_user_id = ${revoker}, revoke_reason = 'fixture'
            WHERE admin_user_id = ${adminId}`,
      ),
    ).resolves.toBeDefined();
  });

  it("el rol readonly_report puede leer pero no escribir", async () => {
    const readonly = testDb.connectAs("readonly_report").db;
    await expect(readonly.execute(sql`SELECT count(*) FROM promotions`)).resolves.toBeDefined();
    await expect(
      readonly.execute(
        sql`INSERT INTO promotions (slug, internal_name, legal_timezone) VALUES ('readonly-probe', 'x', 'UTC')`,
      ),
    ).rejects.toThrow();
  });
});

describe("DEC-006 - identidad y MFA", () => {
  it("el correo se normaliza en el motor y no admite duplicados con distinta caja", async () => {
    await app.execute(
      sql`INSERT INTO identities (email) VALUES ('Duplicado.Prueba@example.invalid')`,
    );
    await expect(
      app.execute(
        sql`INSERT INTO identities (email) VALUES ('  duplicado.prueba@example.invalid  ')`,
      ),
    ).rejects.toThrow();
  });

  it("una cuenta administrativa no puede estar ACTIVE sin MFA inscrito", async () => {
    const identity = await app.execute<{ id: string }>(
      sql`INSERT INTO identities (email, status) VALUES ('sin.mfa@example.invalid', 'ACTIVE') RETURNING id`,
    );
    await expect(
      app.execute(
        sql`INSERT INTO admin_users (identity_id, full_name, status)
            VALUES (${identity.rows[0]?.id}, 'Sin MFA', 'ACTIVE')`,
      ),
    ).rejects.toThrow();
  });
});

describe("DEC-017 - separacion de funciones", () => {
  it("una misma persona no puede acumular COMPLIANCE_OFFICER y DRAW_OFFICER", async () => {
    const adminId = await createAdminUser("separation-probe-admin");
    await app.execute(
      sql`INSERT INTO admin_user_roles (admin_user_id, role_key) VALUES (${adminId}, 'COMPLIANCE_OFFICER')`,
    );
    await expect(
      app.execute(
        sql`INSERT INTO admin_user_roles (admin_user_id, role_key) VALUES (${adminId}, 'DRAW_OFFICER')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/separacion de funciones/iu));
  });

  it("dos personas distintas si pueden tener uno cada una", async () => {
    const complianceId = await createAdminUser("compliance-only-admin");
    const drawId = await createAdminUser("draw-only-admin");
    await expect(
      app.execute(
        sql`INSERT INTO admin_user_roles (admin_user_id, role_key)
            VALUES (${complianceId}, 'COMPLIANCE_OFFICER'), (${drawId}, 'DRAW_OFFICER')`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("DEC-011 - zona horaria legal", () => {
  it("rechaza una zona horaria que el motor no conoce", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO promotions (slug, internal_name, legal_timezone)
            VALUES ('zona-invalida', 'fixture', 'America/Ciudad_Inventada')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/zona horaria IANA/iu));
  });

  it("acepta una zona IANA valida", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO promotions (slug, internal_name, legal_timezone)
            VALUES ('zona-valida', 'fixture', 'America/Chicago')`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("DEC-012 - la configuracion legal como bloqueo verificable", () => {
  it("calcula `unresolved_required_keys` por si misma, sin que la aplicacion la escriba", async () => {
    const promotionId = await createPromotion("claves-sin-resolver");
    const result = await app.execute<{ unresolved_required_keys: string[] }>(
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
          VALUES (${promotionId}, 1, ${JSON.stringify({ minimum_age: "TBD" })}::jsonb)
          RETURNING unresolved_required_keys`,
    );
    const unresolved = result.rows[0]?.unresolved_required_keys ?? [];
    expect(unresolved).toContain("minimum_age");
    expect(unresolved).toContain("eligibility");
    expect(unresolved.length).toBe(12);
  });

  it("la aplicacion no puede escribir `unresolved_required_keys` para fingir que todo esta resuelto", async () => {
    const promotionId = await createPromotion("clave-no-falsificable");
    await expect(
      app.execute(
        sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, unresolved_required_keys)
            VALUES (${promotionId}, 1, '{}'::jsonb, ARRAY[]::text[])`,
      ),
    ).rejects.toThrow();
  });

  it("no permite activar una version de reglas con claves legales sin resolver", async () => {
    const promotionId = await createPromotion("activacion-bloqueada");
    const adminId = await createAdminUser("rules-activator-blocked");
    const version = await app.execute<{ id: string }>(
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
          VALUES (${promotionId}, 1, ${JSON.stringify({ minimum_age: "TBD" })}::jsonb) RETURNING id`,
    );

    await expect(
      app.execute(
        sql`UPDATE promotion_rules_versions
            SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
            WHERE id = ${version.rows[0]?.id}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/Claves legales sin resolver/iu));
  });

  it("no permite activar una promocion sin version de reglas activa", async () => {
    const promotionId = await createPromotion("promo-sin-reglas");
    await app.execute(sql`UPDATE promotions SET status = 'SCHEDULED' WHERE id = ${promotionId}`);
    await expect(
      app.execute(sql`UPDATE promotions SET status = 'ACTIVE' WHERE id = ${promotionId}`),
    ).rejects.toSatisfy(dbErrorMatching(/sin PromotionRulesVersion activa/iu));
  });

  it("permite activar cuando TODAS las claves requeridas estan resueltas", async () => {
    const promotionId = await createPromotion("promo-activable");
    const adminId = await createAdminUser("rules-activator-ok");

    const version = await app.execute<{ id: string; unresolved_required_keys: string[] }>(
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
          VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_RESOLVED_CONFIG)}::jsonb)
          RETURNING id, unresolved_required_keys`,
    );
    expect(version.rows[0]?.unresolved_required_keys).toEqual([]);

    await app.execute(
      sql`UPDATE promotion_rules_versions
          SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
          WHERE id = ${version.rows[0]?.id}`,
    );

    await app.execute(sql`UPDATE promotions SET status = 'SCHEDULED' WHERE id = ${promotionId}`);
    await expect(
      app.execute(
        sql`UPDATE promotions SET status = 'ACTIVE', active_rules_version_id = ${version.rows[0]?.id}
            WHERE id = ${promotionId}`,
      ),
    ).resolves.toBeDefined();
  });

  it("una version de reglas ACTIVE es inmutable salvo para archivarse", async () => {
    const promotionId = await createPromotion("reglas-inmutables");
    const adminId = await createAdminUser("rules-immutability-probe");
    const version = await app.execute<{ id: string }>(
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
          VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_RESOLVED_CONFIG)}::jsonb) RETURNING id`,
    );
    const versionId = version.rows[0]?.id;

    await app.execute(
      sql`UPDATE promotion_rules_versions
          SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
          WHERE id = ${versionId}`,
    );

    await expect(
      app.execute(
        sql`UPDATE promotion_rules_versions SET config = '{"tampered": true}'::jsonb WHERE id = ${versionId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/inmutable/iu));

    // `app` no tiene DELETE sobre la tabla y moriria en el privilegio; la
    // inmutabilidad la demuestra el trigger contra el PROPIETARIO.
    await expect(
      app.execute(sql`DELETE FROM promotion_rules_versions WHERE id = ${versionId}`),
    ).rejects.toSatisfy(dbErrorMatching(/permission denied|42501/iu));
    await expect(
      owner.execute(sql`DELETE FROM promotion_rules_versions WHERE id = ${versionId}`),
    ).rejects.toSatisfy(dbErrorMatching(/no se borra/iu));

    await expect(
      app.execute(
        sql`UPDATE promotion_rules_versions SET status = 'ARCHIVED', archived_at = now() WHERE id = ${versionId}`,
      ),
    ).resolves.toBeDefined();
  });

  it("solo puede haber una version de reglas ACTIVE por promocion", async () => {
    const promotionId = await createPromotion("una-sola-version-activa");
    const adminId = await createAdminUser("single-active-version-probe");

    for (const version of [1, 2]) {
      await app.execute(
        sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
            VALUES (${promotionId}, ${version}, ${JSON.stringify(FIXTURE_RESOLVED_CONFIG)}::jsonb)`,
      );
    }

    await app.execute(
      sql`UPDATE promotion_rules_versions
          SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
          WHERE promotion_id = ${promotionId} AND version = 1`,
    );

    await expect(
      app.execute(
        sql`UPDATE promotion_rules_versions
            SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
            WHERE promotion_id = ${promotionId} AND version = 2`,
      ),
    ).rejects.toThrow();
  });

  /**
   * DEC-054: activar es ARCHIVAR LA ANTERIOR Y ACTIVAR ESTA, en una sola
   * transaccion, mas escribir `promotions.active_rules_version_id`.
   *
   * Se prueba contra PostgreSQL porque lo que hace que la secuencia sea
   * correcta es un cerrojo del motor: el indice unico parcial
   * `promotion_rules_versions_one_active_per_promotion`. Activando ANTES de
   * archivar, la propia transaccion chocaria contra el indice; el test lo
   * demuestra ejecutando el orden bueno y comprobando el estado resultante.
   */
  it("activar una version archiva la anterior y fija active_rules_version_id", async () => {
    const promotionId = await createPromotion("activacion-encadenada");
    const adminId = await createAdminUser("rules-activation-chain");

    const ids: string[] = [];
    for (const version of [1, 2]) {
      const inserted = await app.execute<{ id: string }>(
        sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
            VALUES (${promotionId}, ${version}, ${JSON.stringify(FIXTURE_RESOLVED_CONFIG)}::jsonb)
            RETURNING id`,
      );
      ids.push(inserted.rows[0]?.id ?? "");
    }

    const [first, second] = ids;

    await app.execute(
      sql`UPDATE promotion_rules_versions
          SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
          WHERE id = ${first}`,
    );
    await app.execute(
      sql`UPDATE promotions SET active_rules_version_id = ${first} WHERE id = ${promotionId}`,
    );

    // La secuencia que ejecuta `activateRulesVersion`: archivar, activar,
    // apuntar. En este orden y en la misma transaccion.
    await app.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE promotion_rules_versions
            SET status = 'ARCHIVED', archived_at = now()
            WHERE promotion_id = ${promotionId} AND status = 'ACTIVE'`,
      );
      await tx.execute(
        sql`UPDATE promotion_rules_versions
            SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
            WHERE id = ${second}`,
      );
      await tx.execute(
        sql`UPDATE promotions SET active_rules_version_id = ${second} WHERE id = ${promotionId}`,
      );
    });

    const states = await app.execute<{ id: string; status: string }>(
      sql`SELECT id, status FROM promotion_rules_versions WHERE promotion_id = ${promotionId}`,
    );
    const byId = new Map(states.rows.map((row) => [row.id, row.status]));
    expect(byId.get(first ?? "")).toBe("ARCHIVED");
    expect(byId.get(second ?? "")).toBe("ACTIVE");

    const pointer = await app.execute<{ active_rules_version_id: string | null }>(
      sql`SELECT active_rules_version_id FROM promotions WHERE id = ${promotionId}`,
    );
    expect(pointer.rows[0]?.active_rules_version_id).toBe(second);
  });

  it("un PATCH sobre una version ACTIVE lo rechaza el trigger, no la aplicacion", async () => {
    // Es el cerrojo que hace que la superficie de escritura de DEC-054 sea
    // segura: la API traduce el 409, pero quien se niega es el motor.
    const promotionId = await createPromotion("patch-sobre-activa");
    const adminId = await createAdminUser("rules-patch-probe");

    const inserted = await app.execute<{ id: string }>(
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
          VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_RESOLVED_CONFIG)}::jsonb)
          RETURNING id`,
    );
    const versionId = inserted.rows[0]?.id;

    await app.execute(
      sql`UPDATE promotion_rules_versions
          SET status = 'ACTIVE', activated_at = now(), activated_by_admin_user_id = ${adminId}
          WHERE id = ${versionId}`,
    );

    await expect(
      app.execute(
        sql`UPDATE promotion_rules_versions
            SET attorney_approval_reference = 'REF-NUEVA'
            WHERE id = ${versionId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/inmutable/iu));
  });
});

describe("ciclo de vida de la promocion", () => {
  it("una promocion nace en DRAFT y no admite otro estado inicial", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO promotions (slug, internal_name, legal_timezone, status)
            VALUES ('nace-activa', 'fixture', 'UTC', 'ACTIVE')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/nace en DRAFT/iu));
  });

  it("rechaza una transicion que no figura en promotion_status_transitions", async () => {
    const promotionId = await createPromotion("transicion-invalida");
    await expect(
      app.execute(sql`UPDATE promotions SET status = 'COMPLETED' WHERE id = ${promotionId}`),
    ).rejects.toSatisfy(dbErrorMatching(/Transicion de promocion no permitida/iu));
  });

  it("las transiciones validas se pueden consultar como datos", async () => {
    const result = await app.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM promotion_status_transitions`,
    );
    expect(Number(result.rows[0]?.count ?? "0")).toBeGreaterThan(10);
  });
});

describe("DEC-010 - dinero en enteros", () => {
  it("rechaza una variante cuya moneda no coincide con la de su producto", async () => {
    const product = await app.execute<{ id: string }>(
      sql`INSERT INTO products (sku, slug, currency) VALUES ('FIX-CUR-001', 'fixture-currency', 'USD') RETURNING id`,
    );
    await expect(
      app.execute(
        sql`INSERT INTO product_variants (product_id, sku, price_amount_minor, currency)
            VALUES (${product.rows[0]?.id}, 'FIX-CUR-001-EUR', 1000, 'EUR')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/moneda/iu));
  });

  it("rechaza un precio negativo", async () => {
    const product = await app.execute<{ id: string }>(
      sql`INSERT INTO products (sku, slug, currency) VALUES ('FIX-NEG-001', 'fixture-negative', 'USD') RETURNING id`,
    );
    await expect(
      app.execute(
        sql`INSERT INTO product_variants (product_id, sku, price_amount_minor, currency)
            VALUES (${product.rows[0]?.id}, 'FIX-NEG-001-STD', -1, 'USD')`,
      ),
    ).rejects.toThrow();
  });

  it("conserva un importe por encima de Number.MAX_SAFE_INTEGER sin perder precision", async () => {
    const product = await app.execute<{ id: string }>(
      sql`INSERT INTO products (sku, slug, currency) VALUES ('FIX-BIG-001', 'fixture-bigint', 'USD') RETURNING id`,
    );
    const huge = "9007199254740993";
    const inserted = await app.execute<{ price_amount_minor: string }>(
      sql`INSERT INTO product_variants (product_id, sku, price_amount_minor, currency)
          VALUES (${product.rows[0]?.id}, 'FIX-BIG-001-STD', ${huge}, 'USD')
          RETURNING price_amount_minor::text AS price_amount_minor`,
    );
    expect(inserted.rows[0]?.price_amount_minor).toBe(huge);
  });
});
