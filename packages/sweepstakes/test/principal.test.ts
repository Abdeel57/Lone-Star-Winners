/**
 * Resolucion de la sesion a principal.
 *
 * LA PREGUNTA QUE CONTESTA ESTA SUITE
 *
 *   "Quien puede hacer esto?" Y sobre todo: "quien PARECE que puede y no puede".
 *
 * `MFA_PENDING` es ese caso. La sesion existe, tiene ambito, tiene correo y
 * tiene roles, asi que se parece muchisimo a una sesion valida. No lo es: falta
 * el segundo factor, y quien la tiene solo ha demostrado saber una contrasena.
 */

import { describe, expect, it } from "vitest";

import {
  AdjustmentService,
  AmoeService,
  AwardService,
  SESSION_STATES,
  isSweepstakesError,
  principalFromSession,
  principalIsStaff,
  sessionStateAuthenticates,
  type Principal,
} from "../src/index.js";
import {
  ADMIN_ID,
  PARTICIPANT_ID,
  PROMOTION_ID,
  baseRulesConfig,
  buildHarness,
  qualifiedOrder,
  type Harness,
} from "./fixtures.js";

describe("que estado de sesion autentica", () => {
  it("solo ACTIVE", () => {
    expect(sessionStateAuthenticates("ACTIVE")).toBe(true);
    expect(sessionStateAuthenticates("ANONYMOUS")).toBe(false);
    expect(sessionStateAuthenticates("MFA_PENDING")).toBe(false);
  });

  it("los tres estados del contrato estan cubiertos", () => {
    for (const state of SESSION_STATES) {
      expect(typeof sessionStateAuthenticates(state)).toBe("boolean");
    }
  });

  it("MFA_PENDING no produce principal: se trata igual que un anonimo", () => {
    // Devolver `null` -y no un principal sin capacidades- obliga a decidir en la
    // frontera. Un principal vacio se puede pasar a un servicio y fallaria mas
    // adelante con un error de permisos, sugiriendo que falta un rol cuando lo
    // que falta es el segundo factor.
    expect(
      principalFromSession({
        state: "MFA_PENDING",
        scope: "STAFF",
        actor: { type: "ADMIN", adminUserId: ADMIN_ID },
        capabilities: ["entry.adjust.create", "entry.adjust.approve"],
      }),
    ).toBeNull();
  });

  it("ANONYMOUS tampoco", () => {
    expect(
      principalFromSession({
        state: "ANONYMOUS",
        scope: "PARTICIPANT",
        actor: { type: "PARTICIPANT", participantId: PARTICIPANT_ID },
        capabilities: [],
      }),
    ).toBeNull();
  });

  it("ACTIVE si, conservando ambito y capacidades", () => {
    const principal = principalFromSession({
      state: "ACTIVE",
      scope: "STAFF",
      actor: { type: "ADMIN", adminUserId: ADMIN_ID },
      capabilities: ["amoe.review.approve"],
    });
    expect(principal).not.toBeNull();
    expect(principal?.scope).toBe("STAFF");
    expect(principal?.capabilities).toEqual(["amoe.review.approve"]);
  });
});

describe("el ambito separa personal de participante", () => {
  it("principalIsStaff distingue los dos", () => {
    const staff: Principal = {
      actor: { type: "ADMIN", adminUserId: ADMIN_ID },
      scope: "STAFF",
      capabilities: [],
    };
    const participant: Principal = {
      actor: { type: "PARTICIPANT", participantId: PARTICIPANT_ID },
      scope: "PARTICIPANT",
      capabilities: [],
    };
    expect(principalIsStaff(staff)).toBe(true);
    expect(principalIsStaff(participant)).toBe(false);
  });
});

/**
 * El caso que el ambito existe para cubrir: un principal de PARTICIPANTE con
 * una capacidad de administracion pegada.
 *
 * Con solo la comprobacion de capacidad, pasaria. El ambito lo fija el modulo
 * de identidad al resolver la sesion y no se puede fabricar desde el lado del
 * participante.
 */
const IMPOSTOR: Principal = {
  actor: { type: "ADMIN", adminUserId: ADMIN_ID },
  scope: "PARTICIPANT",
  capabilities: [
    "entry.adjust.create",
    "entry.adjust.approve",
    "participant.disqualify",
    "amoe.review.read",
    "amoe.review.approve",
    "amoe.review.reject",
  ],
};

function services(harness: Harness): {
  readonly adjustments: AdjustmentService;
  readonly amoe: AmoeService;
  readonly award: AwardService;
} {
  return {
    adjustments: new AdjustmentService({
      adjustments: harness.adjustments,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    }),
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

function expectScopeRefusal(error: unknown): boolean {
  return (
    isSweepstakesError(error, "CAPABILITY_REQUIRED") &&
    JSON.stringify(error.details).includes("staff_scope_required")
  );
}

describe("un principal de participante no opera en administracion", () => {
  it("no puede pedir un ajuste, aunque lleve la capacidad", async () => {
    const harness = buildHarness({ flags: { manual_adjustments_enabled: true } });
    const { adjustments } = services(harness);
    await expect(
      adjustments.request(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 5,
          reasonKey: "ADMIN_GOODWILL_CREDIT",
          reasonDetail: null,
        },
        IMPOSTOR,
      ),
    ).rejects.toSatisfy(expectScopeRefusal);
  });

  it("no puede descalificar", async () => {
    const harness = buildHarness();
    const { adjustments, award } = services(harness);
    await award.awardForQualifiedOrder(qualifiedOrder());
    await expect(
      adjustments.disqualify(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          decisionId: "case-1",
          reasonKey: "PARTICIPANT_DISQUALIFIED",
          reasonDetail: "multiples cuentas",
        },
        IMPOSTOR,
      ),
    ).rejects.toSatisfy(expectScopeRefusal);
  });

  it("no puede leer la cola de revision AMOE", async () => {
    const harness = buildHarness({
      flags: { amoe_enabled: true },
      rulesConfig: baseRulesConfig({
        amoe: {
          mode: "ONLINE_FORM",
          submission_window: {
            starts_at: "2026-08-01T05:00:00.000Z",
            ends_at: "2026-12-01T06:00:00.000Z",
          },
          entries_per_approved_submission: 5,
          requires_review: true,
          limit: { max_per_participant_per_period: null, period: "PROMOTION" },
          duplicate_policy: "REJECT",
          identity_requirements: [],
        },
      }),
    });
    const { amoe } = services(harness);
    await expect(amoe.reviewQueue(PROMOTION_ID, IMPOSTOR)).rejects.toSatisfy(expectScopeRefusal);
  });

  it("no puede aprobar un envio AMOE", async () => {
    const harness = buildHarness({
      flags: { amoe_enabled: true },
      rulesConfig: baseRulesConfig({
        amoe: {
          mode: "ONLINE_FORM",
          submission_window: {
            starts_at: "2026-08-01T05:00:00.000Z",
            ends_at: "2026-12-01T06:00:00.000Z",
          },
          entries_per_approved_submission: 5,
          requires_review: true,
          limit: { max_per_participant_per_period: null, period: "PROMOTION" },
          duplicate_policy: "REJECT",
          identity_requirements: [],
        },
      }),
    });
    const { amoe } = services(harness);
    const submitted = await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { note: "x" },
    });
    await expect(amoe.approve(submitted.submission.id, IMPOSTOR)).rejects.toSatisfy(
      expectScopeRefusal,
    );
    expect(harness.ledger.all()).toHaveLength(0);
  });
});
