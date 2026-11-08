/**
 * Tablas de sincronizacion y medicion (DEC-099, migracion 0047).
 *
 * Lo que se protege: que los eventos y las supresiones no se puedan editar, que
 * un mismo evento no entre dos veces, y que la vista con direcciones no la lea
 * el rol de informes.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";
import { dbErrorMatching } from "../support/db-errors.js";

let testDb: TestDatabase;
let app: Database;
let participantId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  const identity = await app.execute<{ id: string }>(
    sql`INSERT INTO identities (email, status)
        VALUES ('mkt-sync@example.invalid', 'ACTIVE') RETURNING id`,
  );
  const participant = await app.execute<{ id: string }>(
    sql`INSERT INTO participants (identity_id, preferred_locale)
        VALUES (${identity.rows[0]?.id}, 'es-US') RETURNING id`,
  );
  participantId = participant.rows[0]?.id ?? "";
});

afterAll(async () => {
  await testDb.stop();
});

describe("DEC-099: solo insercion", () => {
  it("una supresion no se edita ni se borra, tampoco como propietario", async () => {
    await app.execute(
      sql`INSERT INTO marketing_suppressions (participant_id, reason, provider_event_id)
          VALUES (${participantId}, 'HARD_BOUNCE', 'evt-1')`,
    );
    const owner = testDb.connectAsOwner().db;

    await expect(
      app.execute(sql`DELETE FROM marketing_suppressions WHERE provider_event_id = 'evt-1'`),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
    await expect(
      owner.execute(sql`DELETE FROM marketing_suppressions WHERE provider_event_id = 'evt-1'`),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion/u));
  });

  it("un evento no se edita", async () => {
    await app.execute(
      sql`INSERT INTO email_provider_events (provider_event_id, event_type, occurred_at)
          VALUES ('evt-2', 'email.clicked', now())`,
    );

    await expect(
      app.execute(sql`UPDATE email_provider_events SET event_type = 'x'`),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
  });

  it("el mismo evento no entra dos veces", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO email_provider_events (provider_event_id, event_type, occurred_at)
            VALUES ('evt-2', 'email.clicked', now())`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/email_provider_events_event_unique/u));
  });

  it("rechaza una razon de supresion que no existe", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO marketing_suppressions (participant_id, reason, provider_event_id)
            VALUES (${participantId}, 'PORQUE_SI', 'evt-3')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/marketing_suppressions_reason/u));
  });
});

describe("DEC-099: quien puede leer que", () => {
  it("el rol de informes lee las cifras base, no la vista con direcciones", async () => {
    const report = testDb.connectAs("readonly_report").db;

    await expect(report.execute(sql`SELECT 1 FROM email_provider_events`)).resolves.toBeDefined();
    await expect(report.execute(sql`SELECT 1 FROM marketing_eligible_contacts`)).rejects.toSatisfy(
      dbErrorMatching(/42501/u),
    );
  });

  it("la aplicacion lee la vista", async () => {
    await expect(
      app.execute(sql`SELECT 1 FROM marketing_eligible_contacts`),
    ).resolves.toBeDefined();
  });

  it("sin un evento GRANTED nadie aparece en la vista", async () => {
    const rows = await app.execute(
      sql`SELECT 1 FROM marketing_eligible_contacts WHERE participant_id = ${participantId}`,
    );

    expect(rows.rows).toEqual([]);
  });

  it("la vista no devuelve a alguien con supresion aunque tenga permiso", async () => {
    await app.execute(
      sql`INSERT INTO marketing_email_consent_events
            (participant_id, action, text_version, locale, source)
          VALUES (${participantId}, 'GRANTED', 'v', 'es-US', 'SIGNUP')`,
    );
    await app.execute(sql`UPDATE identities SET email_verified_at = now()
                          WHERE email = 'mkt-sync@example.invalid'`);

    const rows = await app.execute(
      sql`SELECT 1 FROM marketing_eligible_contacts WHERE participant_id = ${participantId}`,
    );

    // Tiene la supresion HARD_BOUNCE de la primera prueba.
    expect(rows.rows).toEqual([]);
  });
});
