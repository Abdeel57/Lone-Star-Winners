/**
 * Permiso opcional para correo promocional (DEC-098, migracion 0046).
 *
 * Lo que se protege aqui es la PRUEBA del consentimiento:
 *
 *   1. que nadie pueda editar ni borrar un evento, tampoco el propietario;
 *   2. que un permiso sin el texto que se vio no se pueda guardar;
 *   3. que solo la propia persona pueda DAR el permiso, y que retirarlo pueda
 *      llegar desde cualquier via;
 *   4. que la vista devuelva el ULTIMO evento, y que quien no tiene ninguno no
 *      aparezca (sin filas = sin permiso).
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";
import { dbErrorMatching } from "../support/db-errors.js";

let testDb: TestDatabase;
let app: Database;
let participantSeq = 0;

async function singleValue<T>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute<Record<string, T>>(query);
  const row = result.rows[0];
  if (row === undefined) throw new Error("La consulta no devolvio ninguna fila.");
  const value = Object.values(row)[0];
  if (value === undefined) throw new Error("La consulta no devolvio ninguna columna.");
  return value;
}

async function newParticipant(): Promise<string> {
  participantSeq += 1;
  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES (${`mkt-${String(participantSeq)}@example.invalid`}, 'ACTIVE') RETURNING id`,
  );
  return singleValue<string>(
    app,
    sql`INSERT INTO participants (identity_id, preferred_locale)
        VALUES (${identityId}, 'es-US') RETURNING id`,
  );
}

async function grant(participantId: string, source = "ACCOUNT_SETTINGS"): Promise<void> {
  await app.execute(
    sql`INSERT INTO marketing_email_consent_events
          (participant_id, action, text_version, locale, source)
        VALUES (${participantId}, 'GRANTED', '2026-11-07', 'es-US', ${source})`,
  );
}

async function withdraw(participantId: string, source = "ACCOUNT_SETTINGS"): Promise<void> {
  await app.execute(
    sql`INSERT INTO marketing_email_consent_events (participant_id, action, source)
        VALUES (${participantId}, 'WITHDRAWN', ${source})`,
  );
}

async function currentStatus(participantId: string): Promise<string | null> {
  const result = await app.execute<{ status: string }>(
    sql`SELECT status FROM marketing_email_consent_current WHERE participant_id = ${participantId}`,
  );
  return result.rows[0]?.status ?? null;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
});

afterAll(async () => {
  await testDb.stop();
});

describe("DEC-098: solo insercion", () => {
  it("el rol app puede insertar y leer, pero no editar ni borrar", async () => {
    const participantId = await newParticipant();
    await grant(participantId);

    await expect(
      app.execute(
        sql`UPDATE marketing_email_consent_events SET action = 'WITHDRAWN'
            WHERE participant_id = ${participantId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
    await expect(
      app.execute(
        sql`DELETE FROM marketing_email_consent_events WHERE participant_id = ${participantId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
  });

  it("ni siquiera el propietario de la tabla puede editarla: lo impide el trigger", async () => {
    const participantId = await newParticipant();
    await grant(participantId);
    const owner = testDb.connectAsOwner().db;

    await expect(
      owner.execute(
        sql`UPDATE marketing_email_consent_events SET text_version = 'otra'
            WHERE participant_id = ${participantId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion/u));
    await expect(
      owner.execute(
        sql`DELETE FROM marketing_email_consent_events WHERE participant_id = ${participantId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion/u));
  });

  it("el rol de informes lee la tabla y la vista, y no escribe", async () => {
    const participantId = await newParticipant();
    await grant(participantId);
    const report = testDb.connectAs("readonly_report").db;

    const events = await report.execute(
      sql`SELECT count(*)::int AS n FROM marketing_email_consent_events
          WHERE participant_id = ${participantId}`,
    );
    expect(events.rows[0]).toEqual({ n: 1 });
    const current = await report.execute(
      sql`SELECT status FROM marketing_email_consent_current
          WHERE participant_id = ${participantId}`,
    );
    expect(current.rows[0]).toEqual({ status: "GRANTED" });
    await expect(
      report.execute(
        sql`INSERT INTO marketing_email_consent_events (participant_id, action, source)
            VALUES (${participantId}, 'WITHDRAWN', 'SUPPORT')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
  });
});

describe("DEC-098: que prueba cada fila", () => {
  it("un permiso sin version de texto o sin idioma no se guarda", async () => {
    const participantId = await newParticipant();

    await expect(
      app.execute(
        sql`INSERT INTO marketing_email_consent_events (participant_id, action, locale, source)
            VALUES (${participantId}, 'GRANTED', 'es-US', 'SIGNUP')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/marketing_email_consent_events_granted_evidence/u));
    await expect(
      app.execute(
        sql`INSERT INTO marketing_email_consent_events
              (participant_id, action, text_version, source)
            VALUES (${participantId}, 'GRANTED', '2026-11-07', 'SIGNUP')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/marketing_email_consent_events_granted_evidence/u));
  });

  it("el permiso solo lo da la persona: ni el proveedor ni el personal pueden darlo", async () => {
    const participantId = await newParticipant();

    for (const source of ["EMAIL_PROVIDER", "SUPPORT", "UNSUBSCRIBE_LINK"]) {
      await expect(grant(participantId, source)).rejects.toSatisfy(
        dbErrorMatching(/marketing_email_consent_events_granted_by_participant/u),
      );
    }
  });

  it("retirarlo si puede llegar por cualquier via", async () => {
    const participantId = await newParticipant();
    await grant(participantId, "SIGNUP");

    for (const source of ["UNSUBSCRIBE_LINK", "EMAIL_PROVIDER", "SUPPORT", "ACCOUNT_SETTINGS"]) {
      await withdraw(participantId, source);
    }

    expect(await currentStatus(participantId)).toBe("WITHDRAWN");
  });

  it("rechaza una accion o un origen que no existen", async () => {
    const participantId = await newParticipant();

    await expect(
      app.execute(
        sql`INSERT INTO marketing_email_consent_events (participant_id, action, source)
            VALUES (${participantId}, 'PAUSED', 'SUPPORT')`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/marketing_email_consent_events_action/u));
    await expect(withdraw(participantId, "IMPORT")).rejects.toSatisfy(
      dbErrorMatching(/marketing_email_consent_events_source/u),
    );
  });
});

describe("DEC-098: el estado vigente", () => {
  it("quien nunca decidio nada no aparece en la vista: no tiene permiso", async () => {
    const participantId = await newParticipant();

    expect(await currentStatus(participantId)).toBeNull();
  });

  it("manda el ULTIMO evento: dar, retirar y volver a dar con el mismo texto", async () => {
    const participantId = await newParticipant();

    await grant(participantId, "SIGNUP");
    expect(await currentStatus(participantId)).toBe("GRANTED");

    await withdraw(participantId, "UNSUBSCRIBE_LINK");
    expect(await currentStatus(participantId)).toBe("WITHDRAWN");

    // La misma version otra vez: con la UNIQUE de `participant_consents` esto
    // no se podria guardar, y por eso el permiso tiene su propia tabla.
    await grant(participantId, "ACCOUNT_SETTINGS");
    expect(await currentStatus(participantId)).toBe("GRANTED");

    const history = await app.execute<{ action: string; source: string }>(
      sql`SELECT action, source FROM marketing_email_consent_events
          WHERE participant_id = ${participantId} ORDER BY seq`,
    );
    expect(history.rows).toEqual([
      { action: "GRANTED", source: "SIGNUP" },
      { action: "WITHDRAWN", source: "UNSUBSCRIBE_LINK" },
      { action: "GRANTED", source: "ACCOUNT_SETTINGS" },
    ]);
  });

  it("el orden lo da `seq`, no el reloj: dos eventos con el mismo instante", async () => {
    const participantId = await newParticipant();
    const at = new Date("2026-11-07T18:00:00.000Z");

    await app.execute(
      sql`INSERT INTO marketing_email_consent_events
            (participant_id, action, text_version, locale, source, occurred_at)
          VALUES (${participantId}, 'GRANTED', '2026-11-07', 'en-US', 'SIGNUP', ${at})`,
    );
    await app.execute(
      sql`INSERT INTO marketing_email_consent_events
            (participant_id, action, source, occurred_at)
          VALUES (${participantId}, 'WITHDRAWN', 'ACCOUNT_SETTINGS', ${at})`,
    );

    expect(await currentStatus(participantId)).toBe("WITHDRAWN");
  });
});
