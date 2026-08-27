/**
 * DEC-017: los cinco cerrojos del sorteo, comprobados EN NEGATIVO uno a uno.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UN TEST DE "SORTEA BIEN" NO PROBARIA NADA
 * ---------------------------------------------------------------------------
 *
 * Un control de seguridad no se demuestra viendolo permitir: se demuestra
 * viendolo negarse. Un test que solo comprobara el camino feliz pasaria igual
 * con los cinco cerrojos comentados, porque en el camino feliz todos dicen que
 * si.
 *
 * Por eso cada bloque de abajo parte de un escenario VALIDO y estropea
 * exactamente UNA pieza. Si un cerrojo desaparece, su test es el unico que
 * falla, y el mensaje dice cual.
 *
 * Y por eso hay ademas un test del escenario base: si el montaje estuviera
 * roto, todas las negativas pasarian por el motivo equivocado y la bateria
 * entera seria un adorno.
 *
 * ---------------------------------------------------------------------------
 * LA COMPROBACION QUE SE REPITE EN TODOS
 * ---------------------------------------------------------------------------
 *
 * Cada negativa exige tres cosas, no una:
 *   1. que lance con el CODIGO estable correcto;
 *   2. que NO haya escrito ningun registro de sorteo -nada a medias-;
 *   3. que haya dejado un `AuditEvent` `draw.rejected` con ese mismo codigo.
 *
 * La tercera es la que suele faltar en un sistema real. Un intento de sortear
 * sin autorizacion es exactamente el hecho que un auditor querra ver
 * registrado, y es el que se pierde si la negativa se resuelve con un `return`
 * temprano.
 */

import { describe, expect, it } from "vitest";

import {
  DrawRefusedError,
  DRAW_REFUSAL_CODES,
  initiateDraw,
  type InitiateDrawCommand,
} from "@lsw/tpa";

import {
  alwaysOutOfRangeCsprng,
  APPROVER,
  approval,
  authorization,
  command,
  CONTENT_DIGEST,
  FINALIZER,
  INITIATOR,
  manifest,
  RANGES,
  scenario,
  sequenceCsprng,
  shortCsprng,
  SNAPSHOT_ID,
  unevaluatedFlags,
  type Scenario,
  type ScenarioOverrides,
} from "../helpers/draw-fixtures.js";

async function refusalOf(
  overrides: ScenarioOverrides,
  cmd: InitiateDrawCommand = command(),
): Promise<{ readonly error: DrawRefusedError; readonly world: Scenario }> {
  const world = scenario(overrides);
  try {
    await initiateDraw(world.dependencies, cmd);
  } catch (error) {
    if (error instanceof DrawRefusedError) {
      return { error, world };
    }
    throw error;
  }
  throw new Error("Se esperaba una negativa y el sorteo se ejecuto.");
}

async function expectRefusal(
  overrides: ScenarioOverrides,
  code: string,
  cmd: InitiateDrawCommand = command(),
): Promise<DrawRefusedError> {
  const { error, world } = await refusalOf(overrides, cmd);

  expect(error.code, `motivo de la negativa: ${error.message}`).toBe(code);

  expect(
    world.drawings.stored,
    "una negativa no puede dejar un sorteo escrito a medias",
  ).toStrictEqual([]);

  const rejections = world.audit.events.filter((event) => event.action === "draw.rejected");
  expect(rejections, "toda negativa deja AuditEvent").toHaveLength(1);
  expect(rejections.at(0)?.reasonCode).toBe(code);

  return error;
}

describe("el escenario base sortea (si no, las negativas no probarian nada)", () => {
  it("con los cinco cerrojos abiertos, produce registro y ganador potencial", async () => {
    const world = scenario();
    const outcome = await initiateDraw(world.dependencies, command());

    // 0x03 con mascara de 5 bits sobre un universo de 20 -> ordinal 4, que cae
    // en el primer lote [1, 5].
    expect(outcome.selection.value).toBe(4);
    expect(outcome.drawingEvent.selectedOrdinal).toBe(4);
    expect(outcome.drawingEvent.selectedBatchId).toBe("batch-1");
    expect(outcome.drawingEvent.selectedParticipantReference).toBe("LSW26-P-00001");
    expect(outcome.drawingEvent.selectedProvenance).toBe("PURCHASE");
    expect(outcome.entropySource).toBe("CSPRNG");
    expect(outcome.drawingEvent.commitment).toBeNull();

    // El registro queda encadenado: primera fila de la promocion, sin anterior.
    expect(outcome.drawingEvent.previousRecordHash).toBeNull();
    expect(outcome.drawingEvent.recordHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(world.drawings.stored).toHaveLength(1);

    // Seleccionado NO es ganador.
    expect(outcome.potentialWinner.status).toBe("SELECTED");
    expect(outcome.potentialWinner.history).toHaveLength(1);

    const actions = world.audit.events.map((event) => event.action);
    expect(actions).toStrictEqual(["draw.initiated", "draw.completed", "winner.selected"]);
    expect(world.audit.events.filter((event) => event.action === "draw.rejected")).toStrictEqual(
      [],
    );
  });

  it("el evento de seleccion no lleva datos personales", async () => {
    const world = scenario();
    await initiateDraw(world.dependencies, command());

    const selected = world.audit.events.find((event) => event.action === "winner.selected");
    const metadata = JSON.stringify(selected?.metadata ?? {});
    expect(metadata).toContain("LSW26-P-00001");
    expect(metadata).not.toMatch(/@|nombre|email/iu);
  });
});

describe("CERROJO 1 - el flag persistido", () => {
  it("con el flag apagado no se sortea, aunque todo lo demas este en regla", async () => {
    await expectRefusal(
      { flags: { isEnabled: () => Promise.resolve(false) } },
      DRAW_REFUSAL_CODES.FEATURE_DISABLED,
    );
  });

  it("un flag que no se pudo consultar NO es un flag encendido", async () => {
    await expectRefusal(
      { flags: unevaluatedFlags() },
      DRAW_REFUSAL_CODES.FEATURE_FLAG_NOT_EVALUATED,
    );
  });
});

describe("CERROJO 2 - la autorizacion documental", () => {
  it("sin DrawAuthorization no se sortea aunque el flag este encendido", async () => {
    await expectRefusal({ authorization: null }, DRAW_REFUSAL_CODES.AUTHORIZATION_NOT_FOUND);
  });

  it("una autorizacion revocada no autoriza", async () => {
    await expectRefusal(
      {
        authorization: authorization({
          revokedAt: "2026-05-30T00:00:00.000Z",
          revocationReason: "El cliente retiro la aprobacion.",
        }),
      },
      DRAW_REFUSAL_CODES.AUTHORIZATION_REVOKED,
    );
  });

  it("una autorizacion caducada no autoriza", async () => {
    await expectRefusal(
      { authorization: authorization({ validUntil: "2026-05-31T00:00:00.000Z" }) },
      DRAW_REFUSAL_CODES.AUTHORIZATION_EXPIRED,
    );
  });

  it("una autorizacion que aun no ha entrado en vigor no autoriza", async () => {
    await expectRefusal(
      { authorization: authorization({ validFrom: "2026-06-15T00:00:00.000Z" }) },
      DRAW_REFUSAL_CODES.AUTHORIZATION_NOT_YET_VALID,
    );
  });

  it("una autorizacion para otro snapshot no vale para este", async () => {
    await expectRefusal(
      {
        authorization: authorization({
          scope: {
            promotionId: authorization().promotionId,
            snapshotId: "otro-snapshot",
            maxDraws: 1,
            purpose: "Sorteo de otra entrega",
          },
        }),
      },
      DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_MISMATCH,
    );
  });

  it("una autorizacion sin referencia al documento aprobado es un booleano con mas pasos", async () => {
    await expectRefusal(
      { authorization: authorization({ authorizationReference: "   " }) },
      DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_MISMATCH,
    );
  });

  it("el alcance limita cuantos sorteos ampara: no se repite hasta que salga otro", async () => {
    const world = scenario();
    await initiateDraw(world.dependencies, command());

    // Segundo intento, con otra peticion pero la MISMA autorizacion de un solo
    // sorteo. Es el escenario que importa: repetir hasta que salga el que
    // conviene.
    let refused: DrawRefusedError | null = null;
    try {
      await initiateDraw(
        world.dependencies,
        command({
          drawRequestId: "otra-peticion",
          drawingEventId: "drawing-event-2",
          potentialWinnerId: "potential-winner-2",
        }),
      );
    } catch (error) {
      refused = error instanceof DrawRefusedError ? error : null;
    }

    expect(refused?.code).toBe(DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_EXHAUSTED);
    expect(world.drawings.stored).toHaveLength(1);
  });
});

describe("CERROJO 3 - separacion de funciones y segunda aprobacion", () => {
  it("quien finalizo el snapshot no puede iniciar el sorteo", async () => {
    const error = await expectRefusal(
      {},
      DRAW_REFUSAL_CODES.SEPARATION_OF_DUTIES,
      command({ initiatedBy: FINALIZER }),
    );
    expect(error.context.finalized_by).toBe(FINALIZER);
  });

  it("sin segunda aprobacion no se sortea", async () => {
    await expectRefusal({ approval: null }, DRAW_REFUSAL_CODES.SECOND_APPROVAL_MISSING);
  });

  it("una segunda firma propia no es una segunda firma", async () => {
    await expectRefusal(
      { approval: approval({ approvedBy: INITIATOR }) },
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_SAME_ACTOR,
    );
  });

  it("una aprobacion revocada no aprueba", async () => {
    await expectRefusal(
      { approval: approval({ revokedAt: "2026-06-01T11:59:00.000Z" }) },
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_REVOKED,
    );
  });

  it("una aprobacion fuera de su TTL aprueba un contexto que ya no existe", async () => {
    await expectRefusal(
      { approval: approval({ approvedAt: "2026-06-01T10:00:00.000Z" }) },
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_EXPIRED,
    );
  });

  it("sin step-up reciente no se sortea (lo decide @lsw/security, no este dominio)", async () => {
    const error = await expectRefusal(
      {},
      DRAW_REFUSAL_CODES.ACCESS_DENIED,
      command({ secondsSinceLastMfa: 100_000 }),
    );
    expect(error.context.deny_reason).toBe("STEP_UP_REQUIRED");
  });

  it("un rol sin la capacidad no sortea aunque tenga todo lo demas", async () => {
    const error = await expectRefusal(
      {},
      DRAW_REFUSAL_CODES.ACCESS_DENIED,
      command({ initiatorRoles: ["SUPPORT"] }),
    );
    expect(error.context.deny_reason).toBe("CAPABILITY_NOT_GRANTED");
  });

  it("acumular finalizar y sortear en la misma persona lo bloquea la separacion de roles", async () => {
    const error = await expectRefusal(
      {},
      DRAW_REFUSAL_CODES.ACCESS_DENIED,
      // Otro actor distinto del que finalizo, para que el cerrojo por identidad
      // no se dispare antes: lo que se prueba aqui es el cerrojo por ROLES.
      command({
        initiatedBy: "staff-omnipotente",
        initiatorRoles: ["COMPLIANCE_OFFICER", "DRAW_OFFICER"],
      }),
    );
    expect(error.context.deny_reason).toBe("SEPARATION_OF_DUTIES");
  });

  it("sin motivo escrito no se sortea", async () => {
    await expectRefusal({}, DRAW_REFUSAL_CODES.REASON_REQUIRED, command({ reasonText: "  " }));
  });
});

describe("CERROJO 4 - entrada inmutable verificada", () => {
  it("un snapshot que no existe", async () => {
    await expectRefusal(
      { snapshot: { manifest: manifest({ snapshotId: "otro" }) } },
      DRAW_REFUSAL_CODES.SNAPSHOT_NOT_FOUND,
    );
  });

  it("un snapshot en DRAFT: sortear sobre lo que aun puede cambiar es sortear en vivo", async () => {
    await expectRefusal(
      { snapshot: { manifest: manifest({ status: "DRAFT" }) } },
      DRAW_REFUSAL_CODES.SNAPSHOT_NOT_FINALIZED,
    );
  });

  it("un snapshot finalizado sin digest no es evidencia de nada", async () => {
    await expectRefusal(
      { snapshot: { manifest: manifest({ contentDigest: null }) } },
      DRAW_REFUSAL_CODES.SNAPSHOT_DIGEST_MISSING,
    );
  });

  it("el digest se RECALCULA: si no coincide con el manifiesto, no se sortea", async () => {
    const error = await expectRefusal(
      { snapshot: { recomputedDigest: "f".repeat(64) } },
      DRAW_REFUSAL_CODES.SNAPSHOT_DIGEST_MISMATCH,
    );
    expect(error.context.manifest_digest).toBe(CONTENT_DIGEST);
    expect(error.context.recomputed_digest).toBe("f".repeat(64));
  });

  it("un snapshot de otra promocion", async () => {
    await expectRefusal(
      { snapshot: { manifest: manifest({ promotionId: "otra-promocion" }) } },
      DRAW_REFUSAL_CODES.SNAPSHOT_PROMOTION_MISMATCH,
    );
  });

  it("dos tramos solapados: un ordinal que pertenece a dos personas", async () => {
    const solapado = [
      ...RANGES.slice(0, 4),
      {
        batchId: "batch-5",
        participantReference: "LSW26-P-00005",
        provenance: "AMOE",
        firstOrdinal: 16,
        lastOrdinal: 20,
      },
    ];
    const error = await expectRefusal(
      { snapshot: { ranges: solapado } },
      DRAW_REFUSAL_CODES.ENTRY_RANGES_INCONSISTENT,
    );
    expect(error.context.range_error_code).toBe("entry_ranges.overlap");
  });

  it("un hueco en el universo: un ordinal elegible que no es de nadie", async () => {
    const conHueco = [
      ...RANGES.slice(0, 4),
      {
        batchId: "batch-5",
        participantReference: "LSW26-P-00005",
        provenance: "AMOE",
        firstOrdinal: 18,
        lastOrdinal: 20,
      },
    ];
    const error = await expectRefusal(
      { snapshot: { ranges: conHueco } },
      DRAW_REFUSAL_CODES.ENTRY_RANGES_INCONSISTENT,
    );
    expect(error.context.range_error_code).toBe("entry_ranges.gap");
  });

  it("los tramos no suman lo que declara el snapshot", async () => {
    const error = await expectRefusal(
      { snapshot: { manifest: manifest({ totalEligibleEntries: 25 }) } },
      DRAW_REFUSAL_CODES.ENTRY_RANGES_INCONSISTENT,
    );
    expect(error.context.range_error_code).toBe("entry_ranges.total_mismatch");
  });
});

describe("CERROJO 5 - CSPRNG con rechazo de muestreo", () => {
  it("una fuente que devuelve menos bytes de los pedidos no se completa con ceros", async () => {
    const error = await expectRefusal(
      { csprng: shortCsprng() },
      DRAW_REFUSAL_CODES.CSPRNG_UNUSABLE,
    );
    expect(error.context.randomness_error_code).toBe("csprng.contract_violated");
  });

  it("una fuente cuyos valores caen siempre fuera de rango NO se degrada a modulo", async () => {
    const error = await expectRefusal(
      { csprng: alwaysOutOfRangeCsprng() },
      DRAW_REFUSAL_CODES.CSPRNG_UNUSABLE,
    );
    expect(error.context.randomness_error_code).toBe("csprng.rejection_exhausted");
  });

  it("los valores fuera de rango se descartan y se vuelve a tirar", async () => {
    // 0x1f y 0x14 caen fuera de [0, 20) con mascara de 5 bits; 0x00 entra.
    const world = scenario({ csprng: sequenceCsprng([0x1f, 0x14, 0x00]) });
    const outcome = await initiateDraw(world.dependencies, command());

    expect(outcome.selection.attempts).toBe(3);
    expect(outcome.selection.value).toBe(1);
    expect(outcome.drawingEvent.metadata.rejection_attempts).toBe(3);
  });
});

describe("higiene: idempotencia y ausencia de efectos parciales", () => {
  it("la misma peticion no sortea dos veces", async () => {
    const world = scenario({
      authorization: authorization({
        scope: {
          promotionId: authorization().promotionId,
          snapshotId: SNAPSHOT_ID,
          maxDraws: 5,
          purpose: "Principal y alternates",
        },
      }),
    });
    await initiateDraw(world.dependencies, command());

    let refused: DrawRefusedError | null = null;
    try {
      await initiateDraw(world.dependencies, command({ drawingEventId: "drawing-event-2" }));
    } catch (error) {
      refused = error instanceof DrawRefusedError ? error : null;
    }

    expect(refused?.code).toBe(DRAW_REFUSAL_CODES.ALREADY_DRAWN);
    expect(refused?.context.drawing_event_id).toBe("drawing-event-1");
    expect(world.drawings.stored).toHaveLength(1);
  });

  it("el aprobador y el iniciador quedan los dos en el registro", async () => {
    const world = scenario();
    const outcome = await initiateDraw(world.dependencies, command());
    expect(outcome.drawingEvent.initiatedBy).toBe(INITIATOR);
    expect(outcome.drawingEvent.approvedBy).toBe(APPROVER);
  });
});
