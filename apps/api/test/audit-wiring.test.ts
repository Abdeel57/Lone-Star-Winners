/**
 * HO-028, punto 2: la auditoria persistente esta MONTADA y encadena de verdad.
 *
 * ---------------------------------------------------------------------------
 * QUE DEMUESTRA ESTA SUITE, Y POR QUE ASI
 * ---------------------------------------------------------------------------
 *
 * Que una ruta AUDITADA -rechazar un envio AMOE- deja un hecho en la cadena, y
 * que el `chain_hash` de ese hecho lo calculo `createAuditEventChainPort()` de
 * `@lsw/audit`: el puerto REAL, no un doble.
 *
 * La comprobacion no es "hay un hash". Un hash cualquiera lo produce cualquier
 * cosa. Es que el hash coincide EXACTAMENTE con el que se obtiene recalculando
 * con el mismo puerto sobre los mismos campos, y que el eslabon anterior es el
 * GENESIS derivado del par (dominio, promocion) y no una cadena de ceros.
 *
 * ---------------------------------------------------------------------------
 * REPOSITORIO EN MEMORIA, PUERTO DE VERDAD
 * ---------------------------------------------------------------------------
 *
 * Lo que se sustituye es el SQL -no hay PostgreSQL aqui, DEC-018 pone la linea-
 * pero NO la construccion del hash. Si el doble hasheara por su cuenta, esta
 * suite comprobaria que el doble se pone de acuerdo consigo mismo, que es lo
 * unico que no interesa saber.
 *
 * El doble reproduce ademas las dos reglas que hacen util a la tabla real: la
 * cabeza se lee por CLAVE DE CADENA -una por promocion, mas la global- y una
 * fila escrita nunca se reescribe.
 */

import { createAuditEventChainPort, redactDiff, type AuditEventFields } from "@lsw/audit";
import type { AppendedAuditEventRecord, AuditEventFieldsInput } from "@lsw/database";
import {
  AmoeService,
  DEFAULT_SWEEPSTAKES_FLAGS,
  FixedClock,
  InMemoryAmoeSubmissionRepository,
  InMemoryLedgerRepository,
  InMemoryPromotionContextPort,
  InMemoryUnitOfWork,
  SequentialIdGenerator,
  type IanaTimeZone,
  type Principal,
  type PromotionContext,
} from "@lsw/sweepstakes";
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { createAuditSink, type AuditEventWriter } from "../src/services/audit-sink.js";
import {
  createFakeRepositories,
  PARTICIPANT_ID,
  PROMOTION_ID,
  RULES_VERSION_ID,
} from "./support/in-memory-repositories.js";

const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-09-15T12:00:00.000Z");

const shared: { domain: unknown; staff: unknown } = vi.hoisted(() => ({
  domain: null,
  staff: null,
}));

vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => shared.domain,
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () => {
    if (shared.staff === null) {
      throw new Error("El test no ha declarado principal de personal.");
    }
    return Promise.resolve(shared.staff);
  },
  requireStaffContext: () => Promise.resolve({ principal: shared.staff }),
}));

// ---------------------------------------------------------------------------
// El doble: SQL en memoria, cadena real
// ---------------------------------------------------------------------------

interface AppendedRow {
  readonly record: AppendedAuditEventRecord;
  readonly fields: AuditEventFieldsInput;
}

interface RecordingWriter extends AuditEventWriter {
  readonly rows: AppendedRow[];
}

/**
 * Frontera entre las dos declaraciones de los mismos campos.
 *
 * `@lsw/database` describe `before`/`after`/`metadata` como objetos JSON
 * genericos porque no depende de `@lsw/audit` y no conoce su `CanonicalValue`.
 * La validacion no se pierde: la canonicalizacion recorre cada valor al hashear
 * y lanza ante un `undefined`, un `Date` o un decimal.
 */
function asAuditFields(fields: AuditEventFieldsInput): AuditEventFields {
  return fields as unknown as AuditEventFields;
}

/** Igual que `auditChainKeyFor` de `@lsw/database`: sin promocion, cadena global. */
function chainKeyFor(promotionId: string | null): string {
  return promotionId ?? "global";
}

function recordingWriter(): RecordingWriter {
  const chainPort = createAuditEventChainPort();
  const rows: AppendedRow[] = [];
  const heads = new Map<string, string>();

  return {
    rows,
    isConfigured: true,
    append: (fields: AuditEventFieldsInput): Promise<AppendedAuditEventRecord> => {
      const chainKey = chainKeyFor(fields.promotionId);
      const previousHashHex = heads.get(chainKey) ?? chainPort.genesisHashHex(chainKey);
      const chainHashHex = chainPort.hashEvent({
        chainKey,
        previousHashHex,
        fields: asAuditFields(fields),
      });
      heads.set(chainKey, chainHashHex);

      const record: AppendedAuditEventRecord = {
        id: fields.id,
        sequence: String(rows.length + 1),
        chainKey,
        chainHashHex,
        chainPrevHashHex: previousHashHex,
      };
      rows.push({ record, fields });
      return Promise.resolve(record);
    },
  };
}

/** Repositorio SIN puerto de encadenado. Es el estado de antes de HO-028. */
function unconfiguredWriter(): AuditEventWriter {
  return {
    isConfigured: false,
    append: () => Promise.reject(new Error("no deberia llamarse")),
  };
}

const silentLogger = { info: (): void => undefined };

// ---------------------------------------------------------------------------
// Dominio minimo: lo justo para que la ruta de rechazo funcione
// ---------------------------------------------------------------------------

function rulesConfigFixture(): Record<string, unknown> {
  return {
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      rounding_policy: "FLOOR",
    },
    entry_limits: { per_order_max: null, per_participant_max: null },
    partial_refund_rounding_policy: "FLOOR",
    order_qualification: { qualifying_payment_state: "PAID" },
    // NINGUN valor de aqui es un requisito legal: es una fixture.
    amoe: {
      mode: "ONLINE_FORM",
      submission_window: {
        starts_at: "2026-08-01T05:00:00.000Z",
        ends_at: "2026-12-01T06:00:00.000Z",
      },
      entries_per_approved_submission: 5,
      requires_review: true,
      limit: { max_per_participant_per_period: 3, period: "DAY" },
      duplicate_policy: "REJECT",
      identity_requirements: ["email"],
    },
  };
}

interface Harness {
  readonly writer: RecordingWriter;
  readonly amoe: AmoeService;
  submit(): Promise<string>;
  /**
   * Deja el dominio con un sumidero que SE NIEGA, conservando los mismos datos.
   *
   * Existe porque el envio tambien es un hecho auditable: con el sumidero roto
   * desde el principio no se podria ni sembrar el caso, y el test comprobaria
   * el fallo equivocado.
   */
  breakAuditSink(): void;
}

function buildDomain(writer: AuditEventWriter): Harness {
  const ledger = new InMemoryLedgerRepository();
  const submissions = new InMemoryAmoeSubmissionRepository();
  const promotions = new InMemoryPromotionContextPort();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator();
  const unitOfWork = new InMemoryUnitOfWork();

  const context: PromotionContext = {
    promotionId: PROMOTION_ID,
    status: "ACTIVE",
    legalTimeZone: "America/Chicago" as IanaTimeZone,
    startsAt: new Date("2026-08-01T05:00:00.000Z"),
    endsAt: new Date("2026-12-01T06:00:00.000Z"),
    currency: "USD",
    rulesVersionId: RULES_VERSION_ID,
    rulesConfig: rulesConfigFixture(),
    flags: { ...DEFAULT_SWEEPSTAKES_FLAGS, amoe_enabled: true },
    amoeMode: null,
  };
  promotions.register(context);

  // AQUI esta lo que se prueba: el sumidero REAL, con el saneador REAL, sobre
  // un escritor que encadena con el puerto REAL.
  const audit = createAuditSink({
    repository: writer,
    unitOfWork,
    logger: silentLogger,
    redactor: { redact: redactDiff },
  });

  const amoe = new AmoeService({
    ledger,
    promotions,
    clock,
    ids,
    audit,
    unitOfWork,
    submissions,
  });

  const ports = { ledger, promotions, clock, ids, unitOfWork, submissions };
  shared.domain = { repositories: { ledger, amoe: submissions, unitOfWork }, clock, ids, amoe };

  return {
    writer: writer as RecordingWriter,
    amoe,
    submit: async (): Promise<string> => {
      const created = await amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { email: "ada@example.test" },
      });
      return created.submission.id;
    },
    breakAuditSink: (): void => {
      const broken = new AmoeService({
        ...ports,
        audit: createAuditSink({
          repository: unconfiguredWriter(),
          unitOfWork,
          logger: silentLogger,
        }),
      });
      shared.domain = {
        repositories: { ledger, amoe: submissions, unitOfWork },
        clock,
        ids,
        amoe: broken,
      };
    },
  };
}

function staffWith(capabilities: readonly string[]): Principal {
  return {
    actor: { type: "ADMIN", adminUserId: ADMIN_ID },
    scope: "STAFF",
    capabilities: [...capabilities],
  };
}

function buildDependencies(): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
  } as unknown as AppDependencies;
}

async function appAllowingPermissions(): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies());
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

beforeEach(() => {
  shared.domain = null;
  shared.staff = null;
});

// ---------------------------------------------------------------------------

describe("HO-028: una ruta auditada deja un eslabon encadenado", () => {
  it("rechazar un envio AMOE escribe el hecho con el chain_hash del puerto real", async () => {
    const writer = recordingWriter();
    const harness = buildDomain(writer);
    shared.staff = staffWith(["amoe.review.reject"]);

    const submissionId = await harness.submit();
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/amoe-submissions/${submissionId}/reject`,
      payload: { reason_key: "AMOE_DUPLICATE_SUBMISSION", notes: "Fixture." },
    });

    expect(response.statusCode).toBe(200);

    const rejected = writer.rows.find((row) => row.fields.action === "amoe.submission.rejected");
    expect(rejected).toBeDefined();
    if (rejected === undefined) {
      return;
    }

    // 1. Va a la cadena de SU promocion, no a la global.
    expect(rejected.record.chainKey).toBe(PROMOTION_ID);

    // 2. La cadena ARRANCA en el genesis derivado del par (dominio, cadena) y
    //    cada eslabon apunta al anterior. Comprobar el genesis importa: unos
    //    ceros harian que dos promociones arrancaran del mismo punto y una
    //    cadena se pudiera injertar en otra.
    const chainPort = createAuditEventChainPort();
    const genesis = chainPort.genesisHashHex(PROMOTION_ID);
    expect(genesis).not.toBe("0".repeat(64));

    const first = writer.rows[0];
    expect(first?.fields.action).toBe("amoe.submission.created");
    expect(first?.record.chainPrevHashHex).toBe(genesis);
    // El rechazo cuelga del envio: es el segundo eslabon de la misma cadena.
    expect(rejected.record.chainPrevHashHex).toBe(first?.record.chainHashHex);

    // 3. Y EL HASH ES EL DEL PUERTO REAL: se recalcula por fuera, con los
    //    mismos campos y el mismo anterior, y tiene que salir identico.
    expect(rejected.record.chainHashHex).toBe(
      chainPort.hashEvent({
        chainKey: PROMOTION_ID,
        previousHashHex: rejected.record.chainPrevHashHex,
        fields: asAuditFields(rejected.fields),
      }),
    );
    expect(rejected.record.chainHashHex).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("el hash depende de los campos: cambiar uno cambia el eslabon", async () => {
    const writer = recordingWriter();
    const harness = buildDomain(writer);
    shared.staff = staffWith(["amoe.review.reject"]);

    const submissionId = await harness.submit();
    const app = await appAllowingPermissions();
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/amoe-submissions/${submissionId}/reject`,
      payload: { reason_key: "AMOE_DUPLICATE_SUBMISSION", notes: "Fixture." },
    });

    const rejected = writer.rows.find((row) => row.fields.action === "amoe.submission.rejected");
    if (rejected === undefined) {
      throw new Error("no se registro el rechazo");
    }

    // Un hash que no cambiara al cambiar el motivo no estaria cubriendo el
    // motivo, y el registro dejaria de probar lo que dice probar.
    const chainPort = createAuditEventChainPort();
    const tampered = chainPort.hashEvent({
      chainKey: PROMOTION_ID,
      previousHashHex: rejected.record.chainPrevHashHex,
      fields: asAuditFields({ ...rejected.fields, reasonCode: "AMOE_OTHER_REASON" }),
    });

    expect(tampered).not.toBe(rejected.record.chainHashHex);
  });

  it("`reason_detail` va a la tabla, y el diff se sanea con la allowlist", async () => {
    const writer = recordingWriter();
    const harness = buildDomain(writer);
    shared.staff = staffWith(["amoe.review.reject"]);

    const submissionId = await harness.submit();
    const app = await appAllowingPermissions();
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/amoe-submissions/${submissionId}/reject`,
      payload: { reason_key: "AMOE_DUPLICATE_SUBMISSION", notes: "Texto libre del operador." },
    });

    const rejected = writer.rows.find((row) => row.fields.action === "amoe.submission.rejected");
    expect(rejected?.fields.reasonText).toBe("Texto libre del operador.");

    // Con saneador montado y SIN diff pedido, `before`/`after` son nulos y NO
    // se marca supresion: no habia nada que sanear.
    expect(rejected?.fields.before).toBeNull();
    expect(rejected?.fields.after).toBeNull();
    expect(rejected?.fields.metadata).not.toHaveProperty("audit_diff_suppressed");

    // La direccion no se guarda mientras no exista digest con clave (HO-032).
    expect(rejected?.fields.sourceIp).toBeNull();
  });
});

describe("sin puerto de encadenado, la ruta auditada FALLA en vez de confirmar", () => {
  it("el sumidero se niega y el rechazo no se da por bueno", async () => {
    const harness = buildDomain(recordingWriter());
    shared.staff = staffWith(["amoe.review.reject"]);

    // Se siembra con la cadena montada -el envio tambien se audita- y solo
    // DESPUES se rompe el sumidero, que es el escenario que interesa.
    const submissionId = await harness.submit();
    harness.breakAuditSink();
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/amoe-submissions/${submissionId}/reject`,
      payload: { reason_key: "AMOE_DUPLICATE_SUBMISSION", notes: null },
    });

    // 500, no 200. Un sistema regulado que confirma efectos sin poder
    // registrarlos no es un detalle de configuracion, es un incidente.
    expect(response.statusCode).toBe(500);
  });
});
