/**
 * El expediente del ganador potencial: nadie se sustituye en silencio.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTOS TESTS PROTEGEN
 * ---------------------------------------------------------------------------
 *
 * El caso que hay que impedir no es un bug: es un atajo razonable bajo presion.
 * El seleccionado no responde, o resulta no ser elegible, y alguien "pone al
 * siguiente" cambiando una fila. El sistema queda coherente, el sorteo queda
 * intacto, y la unica prueba de que hubo un primer seleccionado desaparece.
 *
 * Por eso hay dos decisiones separadas -descalificar y decidir que hace falta
 * un alternate- y por eso el expediente es inmutable: cada transicion devuelve
 * uno nuevo con su historico, y el anterior sigue existiendo tal cual estaba.
 */

import { describe, expect, it } from "vitest";

import {
  allowedTransitionsFrom,
  AlternateNotAllowedError,
  assertWinnerMayBePublished,
  createAlternateFor,
  createPotentialWinner,
  PotentialWinnerTransitionError,
  transitionPotentialWinner,
  WinnerPublicationNotAllowedError,
  type PotentialWinner,
  type PotentialWinnerStatus,
} from "@lsw/tpa";

const BASE = createPotentialWinner({
  id: "pw-1",
  promotionId: "promo-1",
  drawingEventId: "draw-1",
  source: "INTERNAL_DRAW",
  participantReference: "LSW26-P-00001",
  entryReference: "batch-1#4",
  rank: 1,
  occurredAt: "2026-06-01T12:00:00.000Z",
  actorId: "staff-draw-officer",
  reasonCode: "winner.selected_by_internal_draw",
});

function advance(
  winner: PotentialWinner,
  to: PotentialWinnerStatus,
  reasonCode = "winner.workflow_step",
): PotentialWinner {
  return transitionPotentialWinner(winner, {
    to,
    occurredAt: "2026-06-02T09:00:00.000Z",
    actorId: "staff-compliance-officer",
    reasonCode,
  });
}

describe("el camino completo del expediente", () => {
  it("recorre los estados declarados hasta CONFIRMED", () => {
    let winner = BASE;
    const path: readonly PotentialWinnerStatus[] = [
      "CONTACT_PENDING",
      "CONTACTED",
      "DOCUMENTS_PENDING",
      "ELIGIBILITY_REVIEW",
      "VERIFIED",
      "CONFIRMED",
    ];
    for (const status of path) {
      winner = advance(winner, status);
    }

    expect(winner.status).toBe("CONFIRMED");
    // Una entrada por la apertura mas una por cada transicion.
    expect(winner.history).toHaveLength(path.length + 1);
    expect(winner.history.at(0)?.from).toBeNull();
    expect(winner.history.at(-1)?.to).toBe("CONFIRMED");
  });

  it("SELECTED no salta a CONFIRMED ni a VERIFIED", () => {
    expect(() => advance(BASE, "CONFIRMED")).toThrow(PotentialWinnerTransitionError);
    expect(() => advance(BASE, "VERIFIED")).toThrow(PotentialWinnerTransitionError);
  });

  it("los estados terminales no tienen salida", () => {
    expect(allowedTransitionsFrom("CONFIRMED")).toStrictEqual([]);
    expect(allowedTransitionsFrom("ALTERNATE_REQUIRED")).toStrictEqual([]);
  });

  it("toda transicion exige codigo de motivo", () => {
    expect(() => advance(BASE, "CONTACT_PENDING", "   ")).toThrow(PotentialWinnerTransitionError);
  });

  it("la descalificacion es alcanzable desde cualquier paso previo a CONFIRMED", () => {
    const noTerminales: readonly PotentialWinnerStatus[] = [
      "SELECTED",
      "CONTACT_PENDING",
      "CONTACTED",
      "DOCUMENTS_PENDING",
      "ELIGIBILITY_REVIEW",
      "VERIFIED",
    ];
    for (const status of noTerminales) {
      expect(allowedTransitionsFrom(status), status).toContain("DISQUALIFIED");
    }
    expect(allowedTransitionsFrom("CONFIRMED")).not.toContain("DISQUALIFIED");
  });
});

describe("una descalificacion conserva el historico", () => {
  it("no muta el expediente anterior", () => {
    const disqualified = advance(BASE, "DISQUALIFIED", "winner.ineligible_jurisdiction");

    expect(BASE.status).toBe("SELECTED");
    expect(BASE.history).toHaveLength(1);
    expect(disqualified.status).toBe("DISQUALIFIED");
    expect(disqualified.statusReasonCode).toBe("winner.ineligible_jurisdiction");
    expect(disqualified.history).toHaveLength(2);
    expect(disqualified.history.at(-1)).toMatchObject({
      from: "SELECTED",
      to: "DISQUALIFIED",
      actorId: "staff-compliance-officer",
      reasonCode: "winner.ineligible_jurisdiction",
    });
  });

  it("el registro de quien selecciono sigue en el historico tras descalificar", () => {
    const disqualified = advance(BASE, "DISQUALIFIED", "winner.ineligible_jurisdiction");
    expect(disqualified.history.at(0)?.actorId).toBe("staff-draw-officer");
    expect(disqualified.participantReference).toBe("LSW26-P-00001");
  });
});

describe("el alternate es una decision aparte", () => {
  const disqualified = advance(BASE, "DISQUALIFIED", "winner.ineligible_jurisdiction");

  it("descalificar NO basta para nombrar sustituto", () => {
    expect(() =>
      createAlternateFor(disqualified, {
        id: "pw-2",
        drawingEventId: "draw-1",
        participantReference: "LSW26-P-00002",
        entryReference: "batch-2#7",
        occurredAt: "2026-06-03T09:00:00.000Z",
        actorId: "staff-compliance-officer",
        reasonCode: "winner.alternate_selected",
      }),
    ).toThrow(AlternateNotAllowedError);
  });

  it("tras ALTERNATE_REQUIRED, el alternate es un expediente nuevo que apunta al anterior", () => {
    const requiresAlternate = transitionPotentialWinner(disqualified, {
      to: "ALTERNATE_REQUIRED",
      occurredAt: "2026-06-03T08:00:00.000Z",
      actorId: "staff-compliance-officer",
      reasonCode: "winner.alternate_required",
    });

    const alternate = createAlternateFor(requiresAlternate, {
      id: "pw-2",
      drawingEventId: "draw-2",
      participantReference: "LSW26-P-00002",
      entryReference: "batch-2#7",
      occurredAt: "2026-06-03T09:00:00.000Z",
      actorId: "staff-compliance-officer",
      reasonCode: "winner.alternate_selected",
    });

    expect(alternate.id).toBe("pw-2");
    expect(alternate.status).toBe("SELECTED");
    expect(alternate.rank).toBe(2);
    expect(alternate.replacesPotentialWinnerId).toBe("pw-1");
    // Historico propio, no heredado: son dos casos, no uno continuado.
    expect(alternate.history).toHaveLength(1);
    // Y el expediente anterior sigue existiendo, intacto.
    expect(requiresAlternate.status).toBe("ALTERNATE_REQUIRED");
    expect(requiresAlternate.participantReference).toBe("LSW26-P-00001");
  });

  it("el alternate no puede ser la misma persona recien descalificada", () => {
    const requiresAlternate = transitionPotentialWinner(disqualified, {
      to: "ALTERNATE_REQUIRED",
      occurredAt: "2026-06-03T08:00:00.000Z",
      actorId: "staff-compliance-officer",
      reasonCode: "winner.alternate_required",
    });

    expect(() =>
      createAlternateFor(requiresAlternate, {
        id: "pw-3",
        drawingEventId: "draw-2",
        participantReference: "LSW26-P-00001",
        entryReference: "batch-1#4",
        occurredAt: "2026-06-03T09:00:00.000Z",
        actorId: "staff-compliance-officer",
        reasonCode: "winner.alternate_selected",
      }),
    ).toThrow(AlternateNotAllowedError);
  });
});

describe("publicar no es confirmar (DEC-032: winner_publication_enabled)", () => {
  const confirmed = [
    "CONTACT_PENDING",
    "CONTACTED",
    "DOCUMENTS_PENDING",
    "ELIGIBILITY_REVIEW",
    "VERIFIED",
    "CONFIRMED",
  ].reduce<PotentialWinner>(
    (winner, status) => advance(winner, status as PotentialWinnerStatus),
    BASE,
  );

  it("con el flag apagado no se publica un ganador confirmado", () => {
    expect(() =>
      assertWinnerMayBePublished({ winner: confirmed, publicationEnabled: false }),
    ).toThrow(WinnerPublicationNotAllowedError);
  });

  it("un flag no evaluado tampoco publica: no hay forma de retirar lo publicado", () => {
    try {
      assertWinnerMayBePublished({ winner: confirmed, publicationEnabled: null });
      throw new Error("deberia haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(WinnerPublicationNotAllowedError);
      expect((error as WinnerPublicationNotAllowedError).code).toBe(
        "winner.publication_flag_not_evaluated",
      );
    }
  });

  it("con el flag encendido, un seleccionado sin verificar sigue sin publicarse", () => {
    try {
      assertWinnerMayBePublished({ winner: BASE, publicationEnabled: true });
      throw new Error("deberia haber lanzado");
    } catch (error) {
      expect((error as WinnerPublicationNotAllowedError).code).toBe("winner.not_confirmed");
    }
  });

  it("confirmado y con el flag encendido, se permite", () => {
    expect(() =>
      assertWinnerMayBePublished({ winner: confirmed, publicationEnabled: true }),
    ).not.toThrow();
  });
});
