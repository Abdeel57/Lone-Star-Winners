/**
 * Pipeline de award.
 *
 * LO QUE ESTA SUITE TIENE QUE DEMOSTRAR
 *
 *   - una orden calificada produce EXACTAMENTE una fila de ledger;
 *   - un reintento -o dos awards concurrentes- producen UNA sola concesion;
 *   - `recorded_at` y `id` son explicitos y coinciden con lo que se hasheara
 *     (DEC-035);
 *   - un calculo que da cero deja snapshot pero NO fila;
 *   - la verificacion de email retiene sin perder la clave de idempotencia;
 *   - el default de verificacion es PROVISIONAL y esta marcado como tal.
 */

import { describe, expect, it } from "vitest";

import {
  AwardService,
  EMAIL_VERIFICATION_REQUIRED_PROVISIONAL_DEFAULT,
  isSweepstakesError,
  resolveEmailVerificationRequirement,
  type AwardServiceDependencies,
} from "../src/index.js";
import {
  ADMIN_ID,
  NOW,
  PARTICIPANT_ID,
  PROMOTION_ID,
  RULES_VERSION_ID,
  baseRulesConfig,
  buildHarness,
  qualifiedOrder,
  type Harness,
  type HarnessOptions,
} from "./fixtures.js";

function service(harness: Harness): AwardService {
  const deps: AwardServiceDependencies = {
    ledger: harness.ledger,
    snapshots: harness.snapshots,
    promotions: harness.promotions,
    identity: harness.identity,
    holds: harness.holds,
    entryNumbers: harness.entryNumbers,
    clock: harness.clock,
    ids: harness.ids,
    audit: harness.audit,
    unitOfWork: harness.unitOfWork,
  };
  return new AwardService(deps);
}

function setup(options: HarnessOptions = {}): { harness: Harness; award: AwardService } {
  const harness = buildHarness(options);
  return { harness, award: service(harness) };
}

describe("otorgamiento basico", () => {
  it("una compra de 50.00 USD genera 50 participaciones y UNA fila", async () => {
    const { harness, award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());

    expect(outcome.status).toBe("AWARDED");
    if (outcome.status !== "AWARDED") {
      return;
    }
    expect(outcome.entries).toBe(50);
    expect(harness.ledger.all()).toHaveLength(1);

    const row = outcome.transaction;
    expect(row.type).toBe("PURCHASE_EARNED");
    expect(row.sourceType).toBe("PURCHASE");
    expect(row.sourceRef).toBe("order:order-0001");
    expect(row.quantityDelta).toBe(50);
    expect(row.rulesVersionId).toBe(RULES_VERSION_ID);
  });

  it("DEC-035: recorded_at es el del reloj inyectado, nunca un DEFAULT del motor", async () => {
    const { award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.transaction.recordedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("DEC-035: el id lo pone el dominio, no el DEFAULT gen_random_uuid()", async () => {
    const { award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    // El generador determinista de los tests produce UUID reconocibles. Lo que
    // importa no es el valor sino que EXISTA antes del INSERT: sin el, el hash
    // de la cadena cubriria un identificador que la fila no tiene.
    expect(outcome.transaction.id).toMatch(/^[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}$/u);
  });

  it("effective_at es el instante en que la orden califico, no el del registro", async () => {
    const qualifiedAt = new Date("2026-09-01T08:30:00.000Z");
    const { award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder({ qualifiedAt }));
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.transaction.effectiveAt.toISOString()).toBe(qualifiedAt.toISOString());
    expect(outcome.transaction.recordedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("persiste el snapshot de calculo con la traza reproducible", async () => {
    const { harness, award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.snapshot.resultQuantity).toBe(50);
    expect(outcome.snapshot.trace).toMatchObject({ eligible_subtotal_minor: "5000" });
    expect(harness.snapshots.all()).toHaveLength(1);
    expect(outcome.transaction.calculationSnapshotId).toBe(outcome.snapshot.id);
  });

  it("emite un AuditEvent con el hecho y sus versiones", async () => {
    const { harness, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const events = harness.audit.byAction("entry.award.created");
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ entries: 50, rules_version_id: RULES_VERSION_ID });
  });
});

describe("idempotencia (DEC-009)", () => {
  it("un reintento del webhook NO duplica participaciones", async () => {
    const { harness, award } = setup();
    const order = qualifiedOrder();

    const first = await award.awardForQualifiedOrder(order);
    const second = await award.awardForQualifiedOrder(order);

    expect(first.status).toBe("AWARDED");
    expect(second.status).toBe("ALREADY_AWARDED");
    expect(harness.ledger.all()).toHaveLength(1);
  });

  it("dos awards CONCURRENTES de la misma orden producen UNA sola fila", async () => {
    const { harness, award } = setup();
    const order = qualifiedOrder();

    // Los dos pasan la lectura previa antes de que ninguno escriba: la lectura
    // no es la garantia. Lo que impide el duplicado es la restriccion de
    // unicidad, y el servicio traduce ese choque a ALREADY_AWARDED.
    const [a, b] = await Promise.all([
      award.awardForQualifiedOrder(order),
      award.awardForQualifiedOrder(order),
    ]);

    expect(harness.ledger.all()).toHaveLength(1);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["ALREADY_AWARDED", "AWARDED"]);
    expect(a.status === "AWARDED" || b.status === "AWARDED").toBe(true);
  });

  it("dos ordenes distintas del mismo participante SI generan dos filas", async () => {
    const { harness, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder({ orderId: "order-A" }));
    await award.awardForQualifiedOrder(qualifiedOrder({ orderId: "order-B" }));
    expect(harness.ledger.all()).toHaveLength(2);
  });
});

describe("un calculo que da cero", () => {
  it("deja snapshot pero NO escribe fila: el ledger prohibe delta cero", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({
        product_eligibility: { mode: "ALLOW_LIST", skus: ["OTRO-SKU"] },
      }),
    });

    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());

    expect(outcome.status).toBe("NO_ENTRIES");
    expect(harness.ledger.all()).toHaveLength(0);
    expect(harness.snapshots.all()).toHaveLength(1);
    // La pregunta "por que esta compra no genero nada" tiene respuesta.
    expect(harness.audit.byAction("entry.award.no_entries")).toHaveLength(1);
  });
});

describe("ventana y estado de la promocion", () => {
  it("una orden calificada FUERA de la ventana se rechaza", async () => {
    const { award } = setup();
    const outside = qualifiedOrder({ qualifiedAt: new Date("2026-12-02T00:00:00.000Z") });
    await expect(award.awardForQualifiedOrder(outside)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "PROMOTION_WINDOW_CLOSED"),
    );
  });

  it("el instante exacto del cierre queda FUERA (ventana semiabierta)", async () => {
    const { award } = setup();
    const atClose = qualifiedOrder({ qualifiedAt: new Date("2026-12-01T06:00:00.000Z") });
    await expect(award.awardForQualifiedOrder(atClose)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "PROMOTION_WINDOW_CLOSED"),
    );
  });

  it("una promocion CLOSED sigue admitiendo una liquidacion tardia dentro de la ventana", async () => {
    // El caso real: el pago liquida despues del cierre pero la orden califico
    // dentro. Rechazarla castigaria al participante por la latencia del
    // proveedor.
    const { award } = setup({ status: "CLOSED" });
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    expect(outcome.status).toBe("AWARDED");
  });

  it("en EXPORT_PREPARATION no entra nada: el universo se esta cerrando", async () => {
    const { award } = setup({ status: "EXPORT_PREPARATION" });
    await expect(award.awardForQualifiedOrder(qualifiedOrder())).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "PROMOTION_NOT_ACCEPTING_ENTRIES"),
    );
  });

  it("una promocion en DRAFT no otorga", async () => {
    const { award } = setup({ status: "DRAFT" });
    await expect(award.awardForQualifiedOrder(qualifiedOrder())).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "PROMOTION_NOT_ACCEPTING_ENTRIES"),
    );
  });
});

describe("topes", () => {
  it("con el flag apagado, un tope configurado NO se aplica", async () => {
    const { award } = setup({
      rulesConfig: baseRulesConfig({
        entry_limits: { per_order_max: 10, per_participant_max: null },
      }),
    });
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.entries).toBe(50);
  });

  it("con el flag encendido, el tope por pedido recorta", async () => {
    const { award } = setup({
      flags: { entry_caps_enabled: true },
      rulesConfig: baseRulesConfig({
        entry_limits: { per_order_max: 10, per_participant_max: null },
      }),
    });
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.entries).toBe(10);
  });

  it("el tope por participante cuenta el saldo YA acumulado", async () => {
    const { award } = setup({
      flags: { entry_caps_enabled: true },
      rulesConfig: baseRulesConfig({
        entry_limits: { per_order_max: null, per_participant_max: 60 },
      }),
    });

    const first = await award.awardForQualifiedOrder(qualifiedOrder({ orderId: "order-A" }));
    const second = await award.awardForQualifiedOrder(qualifiedOrder({ orderId: "order-B" }));

    if (first.status !== "AWARDED" || second.status !== "AWARDED") {
      throw new Error("se esperaban dos concesiones");
    }
    expect(first.entries).toBe(50);
    // Solo caben 10 mas hasta el tope de 60.
    expect(second.entries).toBe(10);
  });
});

describe("numeros visibles", () => {
  it("con el flag apagado NO se asigna ningun rango", async () => {
    const { harness, award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.batch).toBeNull();
    expect(harness.entryNumbers.all()).toHaveLength(0);
  });

  it("con el flag encendido asigna un rango contiguo que no se solapa", async () => {
    const { harness, award } = setup({
      flags: { visible_entry_numbers_enabled: true },
      entryNumberFormat: { prefix: "LSW26", digits: 9 },
    });

    const first = await award.awardForQualifiedOrder(qualifiedOrder({ orderId: "order-A" }));
    const second = await award.awardForQualifiedOrder(qualifiedOrder({ orderId: "order-B" }));

    if (first.status !== "AWARDED" || second.status !== "AWARDED") {
      throw new Error("se esperaban dos concesiones");
    }
    expect(first.batch?.range).toEqual({ start: 1n, end: 51n });
    expect(second.batch?.range).toEqual({ start: 51n, end: 101n });
    expect(harness.entryNumbers.all()).toHaveLength(2);
  });
});

describe("verificacion de email antes de acumular", () => {
  it("el default es PROVISIONAL y esta declarado como tal", () => {
    // docs/LEGAL_PENDING.md -> "Email verification before earning entries" sigue
    // en TBD. Este test existe para que ese `false` no se lea nunca como una
    // decision tomada: si alguien lo cambiara a `true` sin resolver el epigrafe
    // legal, este test falla y obliga a mirar el fichero, donde esta el porque.
    expect(EMAIL_VERIFICATION_REQUIRED_PROVISIONAL_DEFAULT).toBe(false);

    const resolved = resolveEmailVerificationRequirement({});
    expect(resolved.required).toBe(false);
    expect(resolved.source).toBe("PROVISIONAL_DEFAULT");
  });

  it("una clave explicita se lee de la configuracion, no del default", () => {
    expect(
      resolveEmailVerificationRequirement({ eligibility: { email_verification_required: true } }),
    ).toEqual({ required: true, source: "RULES_CONFIG" });

    expect(
      resolveEmailVerificationRequirement({ eligibility: { email_verification_required: false } }),
    ).toEqual({ required: false, source: "RULES_CONFIG" });
  });

  it("con el requisito APAGADO, un email sin verificar no impide nada", async () => {
    const { award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: false } }),
    });
    // Ni siquiera se registra identidad: no se consulta.
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    expect(outcome.status).toBe("AWARDED");
  });

  it("con el requisito ENCENDIDO y el email sin verificar, la orden queda retenida", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, null);

    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());

    expect(outcome.status).toBe("HELD_PENDING_EMAIL_VERIFICATION");
    if (outcome.status !== "HELD_PENDING_EMAIL_VERIFICATION") {
      return;
    }
    expect(outcome.hold.reason).toBe("EMAIL_VERIFICATION_PENDING");
    // La clave de idempotencia se decide AL RETENER, no al liberar.
    expect(outcome.hold.sourceRef).toBe("order:order-0001");
    expect(harness.ledger.all()).toHaveLength(0);
    expect(harness.audit.byAction("entry.award.hold.created")).toHaveLength(1);
  });

  it("con el requisito ENCENDIDO y el email verificado, otorga sin retener", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, new Date("2026-08-20T00:00:00.000Z"));

    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    expect(outcome.status).toBe("AWARDED");
    if (outcome.status !== "AWARDED") {
      return;
    }
    // El origen del requisito viaja a la metadata para que un auditor pueda
    // separar lo otorgado bajo regla explicita de lo otorgado bajo el default.
    expect(outcome.transaction.metadata).toMatchObject({
      email_verification: { required: true, source: "RULES_CONFIG" },
    });
  });

  it("un instante de verificacion POSTERIOR al award no vale como verificado", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
      now: new Date("2026-09-15T12:00:00.000Z"),
    });
    harness.identity.set(PARTICIPANT_ID, new Date("2026-09-16T00:00:00.000Z"));

    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    expect(outcome.status).toBe("HELD_PENDING_EMAIL_VERIFICATION");
  });

  it("retener dos veces la misma orden no crea dos retenciones", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, null);

    await award.awardForQualifiedOrder(qualifiedOrder());
    await award.awardForQualifiedOrder(qualifiedOrder());

    expect(harness.holds.all()).toHaveLength(1);
  });
});

describe("liberacion de la retencion", () => {
  it("al verificarse el email, la liberacion otorga con la MISMA clave de idempotencia", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, null);

    const held = await award.awardForQualifiedOrder(qualifiedOrder());
    expect(held.status).toBe("HELD_PENDING_EMAIL_VERIFICATION");

    harness.identity.set(PARTICIPANT_ID, new Date("2026-09-14T00:00:00.000Z"));
    const released = await award.releaseHold(PROMOTION_ID, "order-0001", qualifiedOrder());

    expect(released.status).toBe("AWARDED");
    if (released.status !== "AWARDED") {
      return;
    }
    expect(released.transaction.sourceRef).toBe("order:order-0001");
    expect(harness.ledger.all()).toHaveLength(1);
    expect(harness.holds.all()[0]?.status).toBe("RELEASED");
  });

  it("liberar DOS VECES produce UNA sola concesion", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, null);
    await award.awardForQualifiedOrder(qualifiedOrder());
    harness.identity.set(PARTICIPANT_ID, new Date("2026-09-14T00:00:00.000Z"));

    const first = await award.releaseHold(PROMOTION_ID, "order-0001", qualifiedOrder());
    const second = await award.releaseHold(PROMOTION_ID, "order-0001", qualifiedOrder());

    expect(first.status).toBe("AWARDED");
    expect(second.status).toBe("ALREADY_AWARDED");
    expect(harness.ledger.all()).toHaveLength(1);
  });

  it("dos liberaciones CONCURRENTES producen UNA sola concesion", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, null);
    await award.awardForQualifiedOrder(qualifiedOrder());
    harness.identity.set(PARTICIPANT_ID, new Date("2026-09-14T00:00:00.000Z"));

    await Promise.all([
      award.releaseHold(PROMOTION_ID, "order-0001", qualifiedOrder()),
      award.releaseHold(PROMOTION_ID, "order-0001", qualifiedOrder()),
    ]);

    expect(harness.ledger.all()).toHaveLength(1);
  });

  it("liberar una retencion que no existe falla con un codigo del contrato", async () => {
    const { award } = setup();
    await expect(
      award.releaseHold(PROMOTION_ID, "order-inexistente", qualifiedOrder()),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AWARD_HOLD_NOT_FOUND"));
  });

  it("si al liberar el email sigue sin verificar, la retencion se mantiene", async () => {
    const { harness, award } = setup({
      rulesConfig: baseRulesConfig({ eligibility: { email_verification_required: true } }),
    });
    harness.identity.set(PARTICIPANT_ID, null);
    await award.awardForQualifiedOrder(qualifiedOrder());

    const outcome = await award.releaseHold(PROMOTION_ID, "order-0001", qualifiedOrder());

    expect(outcome.status).toBe("HELD_PENDING_EMAIL_VERIFICATION");
    expect(harness.holds.all()[0]?.status).toBe("HELD");
    expect(harness.ledger.all()).toHaveLength(0);
  });
});

describe("actor", () => {
  it("un award del sistema no lleva ningun identificador de persona", async () => {
    const { award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder());
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.transaction.actorType).toBe("SYSTEM");
    expect(outcome.transaction.actorAdminUserId).toBeNull();
    expect(outcome.transaction.actorParticipantId).toBeNull();
  });

  it("un award ejecutado por un administrador queda identificado", async () => {
    const { award } = setup();
    const outcome = await award.awardForQualifiedOrder(qualifiedOrder(), {
      type: "ADMIN",
      adminUserId: ADMIN_ID,
    });
    if (outcome.status !== "AWARDED") {
      throw new Error("se esperaba AWARDED");
    }
    expect(outcome.transaction.actorType).toBe("ADMIN");
    expect(outcome.transaction.actorAdminUserId).toBe(ADMIN_ID);
    expect(outcome.transaction.actorParticipantId).toBeNull();
  });
});
