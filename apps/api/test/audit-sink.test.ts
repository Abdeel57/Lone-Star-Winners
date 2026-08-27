/**
 * INVARIANTE: el sumidero de auditoria no confirma nada que no pueda registrar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE FICHERO EXISTE
 * ---------------------------------------------------------------------------
 *
 * La regla del principio 12 -"si el evento no se puede persistir, el efecto no
 * se confirma"- es una sola linea de codigo: la AUSENCIA de un `try/catch`. Y
 * las ausencias no se defienden solas. Basta que alguien vea un error en
 * produccion, envuelva la escritura en un `catch` que registre y siga, y el
 * sistema pase a confirmar operaciones administrativas sin dejar rastro. El
 * cambio parecera una mejora de robustez.
 *
 * Este test convierte esa ausencia en algo que se rompe si desaparece.
 *
 * Las otras dos afirmaciones que aqui se fijan son del mismo tipo:
 *
 *   - el diff NO se escribe si no hay saneador montado. La tabla es
 *     append-only: lo que entre sin revisar se queda para siempre;
 *   - `reason_detail` no va al log. Es texto libre del operador, puede llevar
 *     datos de una persona, y un log acaba en cualquier agregador.
 */

import { describe, expect, it } from "vitest";

import {
  PersistentAuditSink,
  UnconfiguredAuditSink,
  createAuditSink,
  withAuditContext,
  type AuditEventWriter,
  type AuditMirrorLogger,
  type AuditUnitOfWork,
} from "../src/services/audit-sink.js";
import type { AppendedAuditEventRecord, AuditEventFieldsInput } from "@lsw/database";
import type { DomainAuditEvent } from "@lsw/sweepstakes";

const PROMOTION_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER_ID = "22222222-2222-4222-8222-222222222222";

function domainEvent(overrides: Partial<DomainAuditEvent> = {}): DomainAuditEvent {
  return {
    action: "entry.adjustment_approved",
    actor: { type: "ADMIN", adminUserId: ADMIN_USER_ID },
    promotionId: PROMOTION_ID,
    targetEntityType: "Adjustment",
    targetEntityId: "33333333-3333-4333-8333-333333333333",
    reasonKey: "MANUAL_ADJUSTMENT_APPROVED",
    reasonDetail: "Ana Perez llamo por telefono",
    occurredAt: new Date("2026-03-01T12:00:00.000Z"),
    metadata: { quantity_delta: 5 },
    ...overrides,
  };
}

class RecordingWriter implements AuditEventWriter {
  public readonly isConfigured = true;
  public readonly appended: AuditEventFieldsInput[] = [];
  private readonly failure: Error | null;

  public constructor(failure: Error | null = null) {
    this.failure = failure;
  }

  public append(fields: AuditEventFieldsInput): Promise<AppendedAuditEventRecord> {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    this.appended.push(fields);
    return Promise.resolve({
      id: fields.id,
      sequence: String(this.appended.length),
      chainKey: fields.promotionId ?? "global",
      chainHashHex: "a".repeat(64),
      chainPrevHashHex: "b".repeat(64),
    });
  }
}

class RecordingLogger implements AuditMirrorLogger {
  public readonly lines: Readonly<Record<string, unknown>>[] = [];

  public info(payload: Readonly<Record<string, unknown>>): void {
    this.lines.push(payload);
  }
}

/** Reproduce `DrizzleUnitOfWork`: reutiliza la transaccion viva si la hay. */
class CountingUnitOfWork implements AuditUnitOfWork {
  public calls = 0;

  public async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return await work();
  }
}

function sinkWith(writer: AuditEventWriter): {
  readonly sink: PersistentAuditSink;
  readonly logger: RecordingLogger;
  readonly unitOfWork: CountingUnitOfWork;
} {
  const logger = new RecordingLogger();
  const unitOfWork = new CountingUnitOfWork();
  return {
    sink: new PersistentAuditSink({ repository: writer, unitOfWork, logger }),
    logger,
    unitOfWork,
  };
}

describe("principio 12: si el evento no se puede registrar, el error se propaga", () => {
  it("un fallo de escritura NO se traga", async () => {
    const writer = new RecordingWriter(new Error("la base de datos rechazo la fila"));
    const { sink } = sinkWith(writer);

    await expect(sink.emit(domainEvent())).rejects.toThrow(/rechazo la fila/u);
  });

  it("un sumidero sin puerto de encadenado se niega en vez de descartar", async () => {
    const sink = createAuditSink({
      repository: { isConfigured: false, append: () => Promise.reject(new Error("no")) },
      unitOfWork: new CountingUnitOfWork(),
      logger: new RecordingLogger(),
    });

    expect(sink).toBeInstanceOf(UnconfiguredAuditSink);
    await expect(sink.emit(domainEvent())).rejects.toThrow(/no se confirma/u);
  });

  it("la escritura pasa por la unidad de trabajo, que reutiliza la transaccion viva", async () => {
    const writer = new RecordingWriter();
    const { sink, unitOfWork } = sinkWith(writer);

    await sink.emit(domainEvent());

    expect(unitOfWork.calls).toBe(1);
    expect(writer.appended).toHaveLength(1);
  });
});

describe("proyeccion del hecho a las columnas de audit_events", () => {
  it("el actor ADMIN del dominio se registra como STAFF", async () => {
    const writer = new RecordingWriter();
    const { sink } = sinkWith(writer);

    await sink.emit(domainEvent());

    // ADMIN en el ledger, STAFF en la auditoria: la traduccion vive en un solo
    // sitio y el enum `audit_actor_type` la impone.
    expect(writer.appended[0]?.actorType).toBe("STAFF");
    expect(writer.appended[0]?.actorId).toBe(ADMIN_USER_ID);
  });

  it("los instantes viajan con milisegundos exactos, que es lo que exige el preimage", async () => {
    const writer = new RecordingWriter();
    const { sink } = sinkWith(writer);

    await sink.emit(domainEvent());

    const fields = writer.appended[0];
    expect(fields?.occurredAt).toBe("2026-03-01T12:00:00.000Z");
    expect(fields?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  });

  it("sin contexto de peticion, los campos de transporte son null y no se inventan", async () => {
    const writer = new RecordingWriter();
    const { sink } = sinkWith(writer);

    await sink.emit(domainEvent());

    const fields = writer.appended[0];
    expect(fields?.requestId).toBeNull();
    expect(fields?.sourceIp).toBeNull();
    expect(fields?.userAgent).toBeNull();
    expect(fields?.actorRoles).toStrictEqual([]);
  });

  it("con contexto de peticion, los campos de transporte viajan", async () => {
    const writer = new RecordingWriter();
    const { sink } = sinkWith(writer);

    await withAuditContext(
      {
        requestId: "req_abc",
        actorRoles: ["promotions_manager"],
        sourceIpDigest: "c".repeat(64),
        userAgent: "curl/8",
      },
      async () => {
        await sink.emit(domainEvent());
      },
    );

    const fields = writer.appended[0];
    expect(fields?.requestId).toBe("req_abc");
    expect(fields?.actorRoles).toStrictEqual(["promotions_manager"]);
    expect(fields?.sourceIp).toBe("c".repeat(64));
    expect(fields?.userAgent).toBe("curl/8");
  });
});

describe("minimizacion", () => {
  it("sin saneador montado NO se escribe diff, y queda constancia de por que", async () => {
    const writer = new RecordingWriter();
    const { sink } = sinkWith(writer);

    await withAuditContext(
      {
        requestId: null,
        actorRoles: [],
        sourceIpDigest: null,
        userAgent: null,
        diff: { allow: ["status"], before: { status: "PENDING" }, after: { status: "APPROVED" } },
      },
      async () => {
        await sink.emit(domainEvent());
      },
    );

    const fields = writer.appended[0];
    expect(fields?.before).toBeNull();
    expect(fields?.after).toBeNull();
    // Un diff que desapareciera en silencio seria indistinguible de un hecho
    // que no tenia estado. Queda dicho en `metadata`.
    expect(fields?.metadata).toMatchObject({ audit_diff_suppressed: "NO_REDACTOR_CONFIGURED" });
  });

  it("con saneador, el diff se guarda saneado y lo descartado se cuenta", async () => {
    const writer = new RecordingWriter();
    const logger = new RecordingLogger();
    const sink = new PersistentAuditSink({
      repository: writer,
      unitOfWork: new CountingUnitOfWork(),
      logger,
      // El de produccion es `redactDiff` de `@lsw/audit`; aqui basta con uno
      // que cumpla el contrato, porque lo que se prueba es el cableado.
      redactor: {
        redact: () => ({
          before: { status: "PENDING" },
          after: { status: "APPROVED" },
          droppedKeys: ["internal_note"],
          truncatedKeys: [],
        }),
      },
    });

    await withAuditContext(
      {
        requestId: null,
        actorRoles: [],
        sourceIpDigest: null,
        userAgent: null,
        diff: { allow: ["status"], before: {}, after: {} },
      },
      async () => {
        await sink.emit(domainEvent());
      },
    );

    const fields = writer.appended[0];
    expect(fields?.before).toStrictEqual({ status: "PENDING" });
    expect(fields?.metadata).toMatchObject({ audit_diff_dropped_keys: ["internal_note"] });
  });

  it("reason_detail va a la tabla y NUNCA al log", async () => {
    const writer = new RecordingWriter();
    const { sink, logger } = sinkWith(writer);

    await sink.emit(domainEvent());

    expect(writer.appended[0]?.reasonText).toBe("Ana Perez llamo por telefono");

    const line = logger.lines[0];
    expect(line?.event).toBe("audit.recorded");
    expect(Object.keys(line ?? {})).not.toContain("reason_text");
    expect(JSON.stringify(line)).not.toContain("Ana Perez");
  });

  it("el espejo del log se escribe DESPUES de persistir, no antes", async () => {
    const writer = new RecordingWriter(new Error("fallo"));
    const { sink, logger } = sinkWith(writer);

    await expect(sink.emit(domainEvent())).rejects.toThrow();

    // Un log que dijera "registrado" antes de confirmar mentiria en cuanto
    // hubiera un rollback.
    expect(logger.lines).toHaveLength(0);
  });
});
