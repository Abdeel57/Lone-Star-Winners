/**
 * Via AMOE.
 *
 * DOS AFIRMACIONES QUE ESTA SUITE TIENE QUE SOSTENER
 *
 *   1. Una participacion AMOE aprobada vive en EL MISMO ledger que una de
 *      compra, con la misma forma, distinguida solo por `source_type`
 *      (principio 9). No hay contador aparte ni universo paralelo.
 *
 *   2. El subsistema esta COMPLETO aunque el flag arranque apagado
 *      (principio 8), y ninguna decision legal esta tomada: modalidad,
 *      cantidad, ventana, limite y revision salen de la configuracion.
 */

import { describe, expect, it } from "vitest";

import {
  AmoeService,
  AwardService,
  computeBalanceAt,
  isSweepstakesError,
  periodBucket,
  amoeFingerprint,
  type AmoeConfig,
  type Principal,
} from "../src/index.js";
import {
  ADMIN_ID,
  LEGAL_TIME_ZONE,
  NOW,
  PARTICIPANT_ID,
  PROMOTION_ID,
  baseRulesConfig,
  buildHarness,
  qualifiedOrder,
  type Harness,
  type HarnessOptions,
} from "./fixtures.js";

/** Configuracion AMOE de prueba. Ningun valor de aqui es un requisito legal. */
function amoeConfig(overrides: Partial<AmoeConfig> = {}): Record<string, unknown> {
  return {
    mode: "ONLINE_FORM",
    submission_window: {
      starts_at: "2026-08-01T05:00:00.000Z",
      ends_at: "2026-12-01T06:00:00.000Z",
    },
    entries_per_approved_submission: 5,
    requires_review: false,
    limit: { max_per_participant_per_period: 1, period: "DAY" },
    duplicate_policy: "REJECT",
    identity_requirements: ["full_name", "postal_code"],
    ...overrides,
  };
}

interface Setup {
  readonly harness: Harness;
  readonly amoe: AmoeService;
  readonly award: AwardService;
}

function setup(options: HarnessOptions = {}): Setup {
  const harness = buildHarness(options);
  return {
    harness,
    amoe: new AmoeService({
      submissions: harness.submissions,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    }),
    award: new AwardService({
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
    }),
  };
}

function enabled(configOverrides: Partial<AmoeConfig> = {}, options: HarnessOptions = {}): Setup {
  // `...options` va PRIMERO, por el mismo motivo que en adjustment.test.ts.
  return setup({
    ...options,
    flags: { amoe_enabled: true, ...options.flags },
    rulesConfig: options.rulesConfig ?? baseRulesConfig({ amoe: amoeConfig(configOverrides) }),
  });
}

const PAYLOAD = { full_name: "Ada Lovelace", postal_code: "78701" } as const;

const reviewer: Principal = {
  actor: { type: "ADMIN", adminUserId: ADMIN_ID },
  scope: "STAFF",
  capabilities: ["amoe.review.read", "amoe.review.approve", "amoe.review.reject"],
};

const powerless: Principal = {
  actor: { type: "ADMIN", adminUserId: ADMIN_ID },
  scope: "STAFF",
  capabilities: [],
};

describe("el flag manda", () => {
  it("con amoe_enabled apagado, enviar es un error", async () => {
    const { amoe } = setup();
    await expect(
      amoe.submit({ promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, payload: PAYLOAD }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_NOT_ENABLED"));
  });

  it("con el flag apagado, la vista publica no filtra ninguna configuracion", async () => {
    const { amoe } = setup({ rulesConfig: baseRulesConfig({ amoe: amoeConfig() }) });
    const view = await amoe.configView(PROMOTION_ID);
    expect(view.enabled).toBe(false);
    expect(view.mode).toBeNull();
    expect(view.entriesPerApprovedSubmission).toBeNull();
    expect(view.identityRequirements).toEqual([]);
  });

  it("con el flag encendido pero sin configuracion, falla en vez de suponer", async () => {
    const { amoe } = setup({ flags: { amoe_enabled: true } });
    await expect(amoe.configView(PROMOTION_ID)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "AMOE_MODE_NOT_CONFIGURED"),
    );
  });

  it("la vista publica expone lo que el participante necesita y nada mas", async () => {
    const { amoe } = enabled();
    const view = await amoe.configView(PROMOTION_ID);
    expect(view).toEqual({
      enabled: true,
      promotionId: PROMOTION_ID,
      mode: "ONLINE_FORM",
      windowStartsAt: "2026-08-01T05:00:00.000Z",
      windowEndsAt: "2026-12-01T06:00:00.000Z",
      entriesPerApprovedSubmission: 5,
      requiresReview: false,
      identityRequirements: ["full_name", "postal_code"],
      maxPerParticipantPerPeriod: 1,
      limitPeriod: "DAY",
      // Sin descriptores en la configuracion, cada campo cae en su default
      // honesto: control de texto -que es lo que el transporte acepta-, la
      // propia clave como puntero de copy, y el tope del transporte.
      requiredFields: [
        { key: "full_name", type: "TEXT", required: true, labelKey: "full_name", maxLength: 500 },
        {
          key: "postal_code",
          type: "TEXT",
          required: true,
          labelKey: "postal_code",
          maxLength: 500,
        },
      ],
      // El abogado no ha publicado ninguna de las dos cosas. `null`, no texto
      // de relleno.
      instructions: null,
      externalUrl: null,
    });
    // La politica de duplicados NO se publica: seria regalar el mapa de los
    // controles antifraude.
    expect(view).not.toHaveProperty("duplicatePolicy");
  });
});

describe("las cuatro modalidades", () => {
  it.each(["ONLINE_FORM", "CODE", "EXTERNAL_INSTRUCTIONS"] as const)(
    "%s se acepta sin revision si la configuracion lo dice",
    async (mode) => {
      const { amoe } = enabled({ mode, requires_review: false });
      const outcome = await amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: PAYLOAD,
      });
      expect(outcome.status).toBe("APPROVED");
    },
  );

  it("MAIL_IN_REVIEW exige revision por su propia naturaleza", async () => {
    // Alguien tiene que leer un sobre. Configurarlo sin revision no es una
    // opcion legitima, y el esquema lo rechaza en vez de dejarlo pasar.
    const { amoe } = enabled({ mode: "MAIL_IN_REVIEW", requires_review: false });
    await expect(
      amoe.submit({ promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, payload: PAYLOAD }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_CONFIG_INVALID"));
  });

  it("MAIL_IN_REVIEW con revision entra en la cola", async () => {
    const { amoe } = enabled({ mode: "MAIL_IN_REVIEW", requires_review: true });
    const outcome = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    expect(outcome.status).toBe("PENDING_REVIEW");
  });

  it("una discrepancia entre el flag y la version de reglas falla ruidosamente", async () => {
    // Dos fuentes de verdad sobre la modalidad. Se hace control en vez de
    // riesgo: manda la version de reglas, y si no coinciden nadie adivina.
    const { amoe } = setup({
      flags: { amoe_enabled: true },
      rulesConfig: baseRulesConfig({ amoe: amoeConfig({ mode: "ONLINE_FORM" }) }),
      amoeMode: "CODE",
    });
    await expect(
      amoe.submit({ promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, payload: PAYLOAD }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_CONFIG_INVALID"));
  });
});

describe("un envio aprobado entra en el MISMO universo", () => {
  it("escribe una fila AMOE_EARNED con source_type AMOE", async () => {
    const { harness, amoe } = enabled();
    const outcome = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    if (outcome.status !== "APPROVED") {
      throw new Error("se esperaba APPROVED");
    }
    expect(outcome.transaction.type).toBe("AMOE_EARNED");
    expect(outcome.transaction.sourceType).toBe("AMOE");
    expect(outcome.transaction.sourceRef).toBe(`amoe:${outcome.submission.id}`);
    expect(outcome.entries).toBe(5);
    expect(harness.ledger.all()).toHaveLength(1);
  });

  it("compra y AMOE conviven y el desglose cuadra", async () => {
    const { harness, amoe, award } = enabled();
    await award.awardForQualifiedOrder(qualifiedOrder());
    await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });

    const balance = computeBalanceAt(harness.ledger.all(), PROMOTION_ID, PARTICIPANT_ID, NOW);
    expect(balance.activeEntries).toBe(55);
    expect(balance.purchaseEntries).toBe(50);
    expect(balance.amoeEntries).toBe(5);
    // Un solo ledger, dos procedencias.
    expect(harness.ledger.all()).toHaveLength(2);
  });

  it("effective_at es el instante del ENVIO, no el de la revision", async () => {
    // Si fuera el de la revision, el retraso de la cola decidiria en que
    // ventana temporal cae la participacion.
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    const outcome = await amoe.approve(submitted.submission.id, reviewer);
    if (outcome.status !== "APPROVED") {
      throw new Error("se esperaba APPROVED");
    }
    expect(outcome.transaction.effectiveAt.toISOString()).toBe(
      submitted.submission.submittedAt.toISOString(),
    );
    expect(harness.ledger.all()[0]?.recordedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("una aprobacion automatica se registra como SYSTEM, no como el participante", async () => {
    const { amoe } = enabled({ requires_review: false });
    const outcome = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    if (outcome.status !== "APPROVED") {
      throw new Error("se esperaba APPROVED");
    }
    expect(outcome.transaction.actorType).toBe("SYSTEM");
    expect(outcome.transaction.actorParticipantId).toBeNull();
  });
});

describe("ventana de envio", () => {
  it("fuera de la ventana no se admite", async () => {
    const { amoe } = enabled({}, { now: new Date("2026-12-02T00:00:00.000Z") });
    await expect(
      amoe.submit({ promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, payload: PAYLOAD }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_WINDOW_CLOSED"));
  });

  it("el instante exacto del cierre queda FUERA (ventana semiabierta)", async () => {
    const { amoe } = enabled({}, { now: new Date("2026-12-01T06:00:00.000Z") });
    await expect(
      amoe.submit({ promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, payload: PAYLOAD }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_WINDOW_CLOSED"));
  });

  it("el instante exacto de apertura SI entra", async () => {
    const { amoe } = enabled({}, { now: new Date("2026-08-01T05:00:00.000Z") });
    const outcome = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    expect(outcome.status).toBe("APPROVED");
  });
});

describe("requisitos de identidad", () => {
  it("falta una clave requerida: se rechaza diciendo cual", async () => {
    const { amoe } = enabled();
    await expect(
      amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { full_name: "Ada Lovelace" },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSweepstakesError(error, "AMOE_PAYLOAD_INVALID") &&
        JSON.stringify(error.details).includes("postal_code"),
    );
  });

  it("un valor en blanco cuenta como ausente", async () => {
    const { amoe } = enabled();
    await expect(
      amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { full_name: "Ada Lovelace", postal_code: "   " },
      }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_PAYLOAD_INVALID"));
  });
});

describe("huella y duplicados", () => {
  it("la huella NO depende del participante: detecta el mismo envio desde dos cuentas", () => {
    const a = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", PAYLOAD);
    const b = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", { ...PAYLOAD });
    expect(a).toBe(b);
  });

  it("normaliza espacios, mayusculas y forma Unicode", () => {
    const a = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", { full_name: "Jose  PEREZ " });
    const b = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", {
      full_name: "José perez".normalize("NFD").replace("́", ""),
    });
    expect(a).toBe(b);
  });

  it("el orden de las claves no cambia la huella", () => {
    const a = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", { x: "1", y: "2" });
    const b = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", { y: "2", x: "1" });
    expect(a).toBe(b);
  });

  it("longitudes explicitas: {a:'bc'} y {ab:'c'} NO colisionan", () => {
    // Sin prefijo de longitud, ambos se concatenarian a "abc" y produzirian la
    // misma huella, de modo que dos envios distintos se trataran como
    // duplicados.
    const a = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", { a: "bc" });
    const b = amoeFingerprint(PROMOTION_ID, "ONLINE_FORM", { ab: "c" });
    expect(a).not.toBe(b);
  });

  it("promociones distintas producen huellas distintas para el mismo contenido", () => {
    const a = amoeFingerprint("promo-a", "ONLINE_FORM", PAYLOAD);
    const b = amoeFingerprint("promo-b", "ONLINE_FORM", PAYLOAD);
    expect(a).not.toBe(b);
  });

  it("politica REJECT: el duplicado se rechaza", async () => {
    const { amoe } = enabled({
      duplicate_policy: "REJECT",
      limit: { max_per_participant_per_period: null, period: "PROMOTION" },
    });
    await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await expect(
      amoe.submit({ promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, payload: PAYLOAD }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_DUPLICATE_SUBMISSION"));
  });

  it("politica FLAG_FOR_REVIEW: el duplicado entra pero marcado y a revision", async () => {
    const { amoe } = enabled({
      duplicate_policy: "FLAG_FOR_REVIEW",
      requires_review: false,
      limit: { max_per_participant_per_period: null, period: "PROMOTION" },
    });
    const first = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    const second = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });

    expect(first.status).toBe("APPROVED");
    // Aunque la configuracion no exija revision, un duplicado marcado va SIEMPRE
    // a una persona: si se aprobara solo, la politica no tendria ningun efecto.
    expect(second.status).toBe("PENDING_REVIEW");
    expect(second.submission.metadata).toMatchObject({
      duplicate_of_submission_id: first.submission.id,
    });
  });
});

describe("limite por periodo, en la ZONA LEGAL de la promocion", () => {
  it("dos envios el mismo dia local se bloquean aunque sean dias UTC distintos", async () => {
    // 2026-09-15T20:00Z = 15:00 en Chicago; 2026-09-16T02:00Z = 21:00 del MISMO
    // dia en Chicago. Contando en UTC pareceria dos dias y el limite se saltaria.
    const first = enabled({}, { now: new Date("2026-09-15T20:00:00.000Z") });
    await first.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });

    const bucketA = periodBucket(new Date("2026-09-15T20:00:00.000Z"), LEGAL_TIME_ZONE, "DAY");
    const bucketB = periodBucket(new Date("2026-09-16T02:00:00.000Z"), LEGAL_TIME_ZONE, "DAY");
    expect(bucketA).toBe("2026-09-15");
    expect(bucketB).toBe("2026-09-15");
    expect(bucketA).toBe(bucketB);
  });

  it("dos envios en dias locales distintos se admiten aunque sea el mismo dia UTC", () => {
    // 2026-09-15T04:00Z = 23:00 del 14 en Chicago; 2026-09-15T06:00Z = 01:00 del
    // 15. Mismo dia en UTC, dos dias legales distintos.
    const bucketA = periodBucket(new Date("2026-09-15T04:00:00.000Z"), LEGAL_TIME_ZONE, "DAY");
    const bucketB = periodBucket(new Date("2026-09-15T06:00:00.000Z"), LEGAL_TIME_ZONE, "DAY");
    expect(bucketA).toBe("2026-09-14");
    expect(bucketB).toBe("2026-09-15");
  });

  it("alcanzado el limite, el siguiente envio se rechaza", async () => {
    const { amoe } = enabled({
      limit: { max_per_participant_per_period: 1, period: "DAY" },
      duplicate_policy: "FLAG_FOR_REVIEW",
    });
    await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await expect(
      amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { full_name: "Ada L", postal_code: "78702" },
      }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_PERIOD_LIMIT_REACHED"));
  });

  it("un envio PENDIENTE de revision consume cuota", async () => {
    // Si no consumiera, bastaria con enviar cien veces mientras la cola avanza.
    const { amoe } = enabled({
      requires_review: true,
      limit: { max_per_participant_per_period: 1, period: "DAY" },
    });
    await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await expect(
      amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { full_name: "Otra", postal_code: "78703" },
      }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "AMOE_PERIOD_LIMIT_REACHED"));
  });

  it("un envio RECHAZADO libera la cuota", async () => {
    // Un rechazo por una errata no puede dejar a la persona sin poder
    // participar ese dia: cerraria la via gratuita por un error administrativo.
    const { amoe } = enabled({
      requires_review: true,
      limit: { max_per_participant_per_period: 1, period: "DAY" },
    });
    const first = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await amoe.reject(first.submission.id, reviewer, "AMOE_DATA_INCOMPLETE");

    const second = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", postal_code: "78704" },
    });
    expect(second.status).toBe("PENDING_REVIEW");
  });

  it("un envio CANCELADO por el participante libera la cuota", async () => {
    const { amoe } = enabled({
      requires_review: true,
      limit: { max_per_participant_per_period: 1, period: "DAY" },
    });
    const first = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await amoe.cancel(first.submission.id, PARTICIPANT_ID);

    const second = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", postal_code: "78705" },
    });
    expect(second.status).toBe("PENDING_REVIEW");
  });

  it("sin limite declarado no se bloquea nada", async () => {
    const { amoe } = enabled({
      limit: { max_per_participant_per_period: null, period: "PROMOTION" },
      duplicate_policy: "FLAG_FOR_REVIEW",
    });
    for (let i = 0; i < 3; i += 1) {
      const outcome = await amoe.submit({
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { full_name: "Ada", postal_code: `7870${String(i)}` },
      });
      expect(["APPROVED", "PENDING_REVIEW"]).toContain(outcome.status);
    }
  });
});

describe("cubos de periodo", () => {
  const instant = new Date("2026-09-15T20:00:00.000Z");

  it("DAY produce la fecha local", () => {
    expect(periodBucket(instant, LEGAL_TIME_ZONE, "DAY")).toBe("2026-09-15");
  });

  it("MONTH produce el mes local", () => {
    expect(periodBucket(instant, LEGAL_TIME_ZONE, "MONTH")).toBe("2026-09");
  });

  it("WEEK produce la semana ISO", () => {
    expect(periodBucket(instant, LEGAL_TIME_ZONE, "WEEK")).toBe("2026-W38");
  });

  it("PROMOTION es un unico cubo", () => {
    expect(periodBucket(instant, LEGAL_TIME_ZONE, "PROMOTION")).toBe("PROMOTION");
  });

  it("la semana ISO cruza correctamente el cambio de ano", () => {
    // El 1 de enero de 2027 es viernes: pertenece a la semana 53 de 2026.
    expect(periodBucket(new Date("2027-01-01T18:00:00.000Z"), LEGAL_TIME_ZONE, "WEEK")).toBe(
      "2026-W53",
    );
  });
});

describe("cola de revision y permisos", () => {
  it("leer la cola exige amoe.review.read", async () => {
    const { amoe } = enabled({ requires_review: true });
    await expect(amoe.reviewQueue(PROMOTION_ID, powerless)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "CAPABILITY_REQUIRED"),
    );
  });

  it("la cola devuelve los pendientes en orden de llegada", async () => {
    const { amoe } = enabled({
      requires_review: true,
      limit: { max_per_participant_per_period: null, period: "PROMOTION" },
    });
    const a = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "A", postal_code: "1" },
    });
    const b = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "B", postal_code: "2" },
    });
    const queue = await amoe.reviewQueue(PROMOTION_ID, reviewer);
    expect(queue.map((item) => item.id)).toEqual([a.submission.id, b.submission.id]);
  });

  it("aprobar exige amoe.review.approve", async () => {
    const { amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await expect(amoe.approve(submitted.submission.id, powerless)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "CAPABILITY_REQUIRED"),
    );
  });

  it("aprobar deja constancia de quien reviso", async () => {
    const { amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    const outcome = await amoe.approve(submitted.submission.id, reviewer, "sobre legible");
    if (outcome.status !== "APPROVED") {
      throw new Error("se esperaba APPROVED");
    }
    expect(outcome.submission.status).toBe("APPROVED");
    expect(outcome.submission.reviewedByAdminUserId).toBe(ADMIN_ID);
    expect(outcome.submission.entryTransactionId).toBe(outcome.transaction.id);
    expect(outcome.transaction.actorAdminUserId).toBe(ADMIN_ID);
  });

  it("aprobar DOS VECES el mismo envio produce UNA sola concesion", async () => {
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await amoe.approve(submitted.submission.id, reviewer);
    await expect(amoe.approve(submitted.submission.id, reviewer)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "AMOE_SUBMISSION_NOT_REVIEWABLE"),
    );
    expect(harness.ledger.all()).toHaveLength(1);
  });

  it("dos revisores aprobando A LA VEZ producen UNA sola concesion", async () => {
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    // Los dos pasan la comprobacion de estado antes de que ninguno escriba. Lo
    // que impide la doble concesion es la restriccion de unicidad del ledger.
    await Promise.all([
      amoe.approve(submitted.submission.id, reviewer),
      amoe.approve(submitted.submission.id, reviewer),
    ]);
    expect(harness.ledger.all()).toHaveLength(1);
  });

  it("rechazar exige un motivo con forma de clave", async () => {
    const { amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await expect(amoe.reject(submitted.submission.id, reviewer, "  ")).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "REASON_KEY_REQUIRED"),
    );
  });

  it("un rechazo no escribe nada en el ledger", async () => {
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await amoe.reject(submitted.submission.id, reviewer, "AMOE_OUT_OF_WINDOW");
    expect(harness.ledger.all()).toHaveLength(0);
    expect(harness.audit.byAction("amoe.submission.rejected")).toHaveLength(1);
  });

  it("un participante no puede cancelar el envio de otro", async () => {
    const { amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    // Mismo codigo que "no existe": contestar "existe pero no es tuyo"
    // convertiria el endpoint en un oraculo de identificadores ajenos.
    await expect(amoe.cancel(submitted.submission.id, "otro-participante")).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "AMOE_SUBMISSION_NOT_FOUND"),
    );
  });

  it("no se puede cancelar un envio ya aprobado", async () => {
    const { amoe } = enabled();
    const outcome = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    await expect(amoe.cancel(outcome.submission.id, PARTICIPANT_ID)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "AMOE_SUBMISSION_NOT_REVIEWABLE"),
    );
  });
});

/**
 * HO-031: lo que la via gratuita necesita para pintarse sin inventar nada.
 *
 * La lista de campos y las instrucciones son las dos piezas que impiden que el
 * frontend redacte el formulario o el sobre. Ninguna de las dos la produce el
 * codigo: salen de `PromotionRulesVersion.config`, y donde no estan, la
 * respuesta es `null`.
 */
describe("campos del formulario, instrucciones y destino externo", () => {
  it("sin descriptores, cada campo cae en su valor por defecto honesto", async () => {
    const { amoe } = enabled();
    const view = await amoe.configView(PROMOTION_ID);

    // `TEXT` no es una suposicion sobre el dato: es lo que el transporte acepta
    // y lo que el dominio valida. La clave del payload hace de puntero de copy
    // porque inventar una traduccion aqui seria redactar interfaz.
    expect(view.requiredFields).toEqual([
      { key: "full_name", type: "TEXT", required: true, labelKey: "full_name", maxLength: 500 },
      { key: "postal_code", type: "TEXT", required: true, labelKey: "postal_code", maxLength: 500 },
    ]);
  });

  it("un descriptor cambia el control y la etiqueta, nunca la lista", async () => {
    const { amoe } = enabled({
      identity_fields: {
        postal_code: { type: "TEXT", label_key: "postalCode", max_length: 10 },
        // Descriptor de una clave que NO esta en `identity_requirements`: no
        // anade ningun campo. Que datos se piden es materia legal y lo dice esa
        // lista, no este mapa.
        social_security_number: { type: "TEXT", label_key: "ssn" },
      },
    });

    const view = await amoe.configView(PROMOTION_ID);

    expect(view.requiredFields?.map((field) => field.key)).toEqual(["full_name", "postal_code"]);
    expect(view.requiredFields?.[1]).toEqual({
      key: "postal_code",
      type: "TEXT",
      required: true,
      labelKey: "postalCode",
      maxLength: 10,
    });
  });

  it("el orden es el de la lista legal, no el del mapa de descriptores", async () => {
    const { amoe } = enabled({
      identity_requirements: ["postal_code", "full_name"],
      identity_fields: { full_name: { type: "TEXT" }, postal_code: { type: "TEXT" } },
    });

    const view = await amoe.configView(PROMOTION_ID);
    expect(view.requiredFields?.map((field) => field.key)).toEqual(["postal_code", "full_name"]);
  });

  it("una clave `__proto__` en la lista no lee la cadena de prototipos", async () => {
    const { amoe } = enabled({ identity_requirements: ["__proto__"] });
    const view = await amoe.configView(PROMOTION_ID);

    expect(view.requiredFields).toEqual([
      { key: "__proto__", type: "TEXT", required: true, labelKey: "__proto__", maxLength: 500 },
    ]);
  });

  it("las instrucciones se publican tal cual, en los dos idiomas", async () => {
    const { amoe } = enabled({
      instructions: { "en-US": "FIXTURE ONLY.", "es-US": "SOLO FIXTURE." },
    });

    const view = await amoe.configView(PROMOTION_ID);
    expect(view.instructions).toEqual({ "en-US": "FIXTURE ONLY.", "es-US": "SOLO FIXTURE." });
  });

  it("unas instrucciones en un solo idioma rompen la configuracion", async () => {
    // DEC-021: ninguno de los dos locales es traduccion secundaria del otro.
    // Publicar la via gratuita solo en ingles es cerrarla para la mitad de los
    // participantes, y eso no puede pasar por un descuido de configuracion.
    const { amoe } = enabled({
      instructions: { "en-US": "FIXTURE ONLY." } as unknown as AmoeConfig["instructions"],
    });

    await expect(amoe.configView(PROMOTION_ID)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "AMOE_CONFIG_INVALID"),
    );
  });

  it("un destino externo que no es https rompe la configuracion", async () => {
    // Un `javascript:` renderizado como `href` es ejecucion de codigo de
    // terceros en la pagina. Se rechaza donde se LEE la configuracion, para que
    // no dependa de que el frontend se acuerde de mirarlo.
    const { amoe } = enabled({ external_url: `${"java"}script:alert(1)` });

    await expect(amoe.configView(PROMOTION_ID)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "AMOE_CONFIG_INVALID"),
    );
  });

  it("un destino http tampoco pasa", async () => {
    const { amoe } = enabled({ external_url: "http://example.test/free" });

    await expect(amoe.configView(PROMOTION_ID)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "AMOE_CONFIG_INVALID"),
    );
  });

  it("con la via apagada no se filtra ni la lista de campos ni las instrucciones", async () => {
    const { amoe } = setup({
      rulesConfig: baseRulesConfig({
        amoe: amoeConfig({
          instructions: { "en-US": "FIXTURE ONLY.", "es-US": "SOLO FIXTURE." },
          external_url: "https://example.test/free",
        }),
      }),
    });

    const view = await amoe.configView(PROMOTION_ID);
    expect(view.enabled).toBe(false);
    expect(view.requiredFields).toBeNull();
    expect(view.instructions).toBeNull();
    expect(view.externalUrl).toBeNull();
    // La promocion por la que se pregunto SI viaja: no es un parametro de AMOE.
    expect(view.promotionId).toBe(PROMOTION_ID);
  });
});

/**
 * HO-031: antes y despues de una aprobacion, calculados por el motor.
 *
 * El panel no puede producir ninguna de las dos cifras: el saldo previo esta en
 * el ledger y la cantidad la fija la version de reglas DEL ENVIO.
 */
describe("proyeccion de la aprobacion", () => {
  it("suma sobre el saldo real del participante", async () => {
    const { harness, amoe, award } = enabled({ requires_review: true });
    await award.awardForQualifiedOrder(qualifiedOrder());

    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });

    const before = computeBalanceAt(harness.ledger.all(), PROMOTION_ID, PARTICIPANT_ID, NOW);
    expect(before.activeEntries).toBeGreaterThan(0);

    const projections = await amoe.approvalProjections([submitted.submission]);
    const projection = projections.get(submitted.submission.id);

    expect(projection?.entriesBefore).toBe(before.activeEntries);
    expect(projection?.entriesIfApproved).toBe(5);
    expect(projection?.entriesAfterIfApproved).toBe(before.activeEntries + 5);
  });

  it("la cantidad sale de la version de reglas DEL ENVIO, no de la vigente", async () => {
    // Es el mismo principio que gobierna la aprobacion: aplicar la version
    // nueva cambiaria retroactivamente lo que valia un envio ya hecho.
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });

    const historic = "55555555-5555-4555-8555-555555555555";
    harness.promotions.registerRulesVersion(
      historic,
      baseRulesConfig({ amoe: amoeConfig({ entries_per_approved_submission: 42 }) }),
    );

    const projections = await amoe.approvalProjections([
      { ...submitted.submission, rulesVersionId: historic },
    ]);

    expect(projections.get(submitted.submission.id)?.entriesIfApproved).toBe(42);
  });

  it("una version de reglas sin AMOE legible proyecta null en vez de una cifra falsa", async () => {
    // La aprobacion de ESE envio fallara. Ensenar un numero que no se va a
    // cumplir es peor que no ensenar ninguno, y una excepcion aqui dejaria al
    // revisor sin pantalla por culpa de una sola fila.
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });

    const broken = "66666666-6666-4666-8666-666666666666";
    harness.promotions.registerRulesVersion(broken, baseRulesConfig());

    const projections = await amoe.approvalProjections([
      { ...submitted.submission, rulesVersionId: broken },
    ]);
    const projection = projections.get(submitted.submission.id);

    // El saldo previo SI se conoce: no depende de la configuracion.
    expect(projection?.entriesBefore).toBe(0);
    expect(projection?.entriesIfApproved).toBeNull();
    expect(projection?.entriesAfterIfApproved).toBeNull();
  });

  it("no escribe nada: es una lectura", async () => {
    const { harness, amoe } = enabled({ requires_review: true });
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: PAYLOAD,
    });
    const rowsBefore = harness.ledger.all().length;
    const eventsBefore = harness.audit.events.length;

    await amoe.approvalProjections([submitted.submission]);

    expect(harness.ledger.all()).toHaveLength(rowsBefore);
    expect(harness.audit.events).toHaveLength(eventsBefore);
  });

  it("una cola vacia devuelve un mapa vacio, no falla", async () => {
    const { amoe } = enabled({ requires_review: true });
    await expect(amoe.approvalProjections([])).resolves.toHaveProperty("size", 0);
  });
});
