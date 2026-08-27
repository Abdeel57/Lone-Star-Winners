/**
 * DEC-017, cerrojo 5: que la seleccion sea UNIFORME, no solo aleatoria.
 *
 * ---------------------------------------------------------------------------
 * EL TEST QUE IMPORTA, Y POR QUE NO ES ESTADISTICO
 * ---------------------------------------------------------------------------
 *
 * La forma habitual de comprobar uniformidad es tirar un millon de veces y
 * mirar si la desviacion es "razonable". Ese test es lento, es inestable, y
 * -lo peor- no detecta un sesgo pequeno, que es justo el que produce el
 * `% N` que este modulo existe para evitar: con 20 entries y un byte, el sesgo
 * del modulo es del 1.6% sobre los primeros ordinales. Un test estadistico con
 * tolerancia lo dejaria pasar todos los dias.
 *
 * Aqui se hace lo contrario: se ENUMERA el espacio completo de entrada. Los 256
 * valores posibles de un byte, uno por uno, con la fuente fijada. El reparto
 * resultante no es "aproximadamente uniforme": es exactamente uniforme, y el
 * test compara ademas contra lo que habria dado el modulo, para que la
 * diferencia quede escrita y nadie la considere un detalle.
 *
 * Sin flakiness posible: no hay azar en el test, solo en lo que el test mide.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildEntryRangeIndex,
  computeCommitment,
  createDrawCommitment,
  createSeedByteSource,
  DEFAULT_DRAW_SERVICE_CONFIG,
  DRAW_REFUSAL_CODES,
  DrawRefusedError,
  initiateDraw,
  locateOrdinal,
  MAX_REJECTION_ATTEMPTS,
  RandomnessContractError,
  RandomnessExhaustedError,
  selectOrdinal,
  uniformBelow,
  UNIFORM_SELECTION_ALGORITHM,
  verifyCommitment,
  verifyDrawReveal,
  type ByteSource,
  type CommitmentStore,
  type DrawCommitmentRecord,
} from "@lsw/tpa";

import {
  command,
  DRAW_REQUEST_ID,
  PROMOTION_ID,
  RANGES,
  scenario,
  sequenceCsprng,
  SNAPSHOT_ID,
  TOTAL_ELIGIBLE_ENTRIES,
  CONTENT_DIGEST,
} from "../helpers/draw-fixtures.js";

/** Fuente que devuelve siempre el mismo byte. Un solo intento permitido. */
function fixedByteSource(byte: number): ByteSource {
  return (length: number) => new Uint8Array(length).fill(byte);
}

describe("uniformidad exacta por enumeracion del espacio de entrada", () => {
  it("los 256 bytes se reparten en partes iguales entre 20 candidatos", () => {
    const counts = new Map<number, number>();
    let rejected = 0;

    for (let byte = 0; byte <= 255; byte += 1) {
      try {
        const selection = uniformBelow(20, fixedByteSource(byte), 1);
        counts.set(selection.value, (counts.get(selection.value) ?? 0) + 1);
      } catch (error) {
        if (!(error instanceof RandomnessExhaustedError)) {
          throw error;
        }
        rejected += 1;
      }
    }

    // 5 bits de mascara -> 32 valores posibles; 8 bytes producen cada uno.
    expect([...counts.keys()].sort((left, right) => left - right)).toStrictEqual(
      Array.from({ length: 20 }, (_unused, index) => index),
    );
    expect([...new Set(counts.values())]).toStrictEqual([8]);
    // Los 12 valores sobrantes (20..31), a 8 bytes cada uno.
    expect(rejected).toBe(96);
  });

  it("el modulo, que es el atajo, NO habria sido uniforme", () => {
    // Este test no prueba nuestro codigo: prueba que el problema existe. Sin el,
    // el rechazo de muestreo parece una complicacion gratuita.
    const moduloCounts = new Map<number, number>();
    for (let byte = 0; byte <= 255; byte += 1) {
      const value = byte % 20;
      moduloCounts.set(value, (moduloCounts.get(value) ?? 0) + 1);
    }
    const distinct = [...new Set(moduloCounts.values())].sort((left, right) => left - right);
    expect(distinct).toStrictEqual([12, 13]);
    // Los primeros 16 ordinales saldrian un 8.3% mas a menudo que los 4 ultimos.
    expect(moduloCounts.get(0)).toBe(13);
    expect(moduloCounts.get(19)).toBe(12);
  });

  it("un universo de una sola entry no consume entropia", () => {
    const selection = uniformBelow(1, () => {
      throw new Error("no deberia pedir bytes");
    });
    expect(selection).toStrictEqual({ value: 0, attempts: 0, bytesPerAttempt: 0 });
  });

  it("el ordinal es 1-based, que es como se ensena a un tercero", () => {
    expect(selectOrdinal(20, fixedByteSource(0x00), 1).value).toBe(1);
    expect(selectOrdinal(20, fixedByteSource(0x13), 1).value).toBe(20);
  });

  it("una fuente que incumple el contrato de longitud lanza, no se rellena", () => {
    expect(() => uniformBelow(1000, () => new Uint8Array(1))).toThrow(RandomnessContractError);
  });

  it("el tope de rechazos existe y no degrada a modulo", () => {
    expect(MAX_REJECTION_ATTEMPTS).toBeGreaterThanOrEqual(64);
    expect(() => uniformBelow(20, fixedByteSource(0xff))).toThrow(RandomnessExhaustedError);
  });

  it("un rango no entero o no positivo se rechaza (DEC-010)", () => {
    expect(() => uniformBelow(0, fixedByteSource(0))).toThrow(RandomnessContractError);
    expect(() => uniformBelow(2.5, fixedByteSource(0))).toThrow(RandomnessContractError);
  });

  it("mas de 32 bits: el mapeo sigue siendo uniforme y sin desbordar", () => {
    const bound = 5_000_000_000;
    const selection = uniformBelow(bound, fixedByteSource(0x01), 1);
    expect(selection.bytesPerAttempt).toBe(5);
    expect(Number.isSafeInteger(selection.value)).toBe(true);
    expect(selection.value).toBeLessThan(bound);
  });
});

describe("el peso de cada participante es su numero de entries", () => {
  const index = buildEntryRangeIndex(RANGES, TOTAL_ELIGIBLE_ENTRIES);

  it("cada ordinal pertenece a exactamente un lote", () => {
    const perBatch = new Map<string, number>();
    for (let ordinal = 1; ordinal <= TOTAL_ELIGIBLE_ENTRIES; ordinal += 1) {
      const batch = locateOrdinal(index, ordinal);
      perBatch.set(batch.batchId, (perBatch.get(batch.batchId) ?? 0) + 1);
    }

    // El reparto reproduce el tamano declarado de cada lote: 5, 4, 1, 6, 4.
    expect([...perBatch.entries()]).toStrictEqual([
      ["batch-1", 5],
      ["batch-2", 4],
      ["batch-3", 1],
      ["batch-4", 6],
      ["batch-5", 4],
    ]);
  });

  it("una entry de AMOE pesa lo mismo que una de compra", () => {
    // Principio #9: comparten universo sin perder procedencia. El sorteo no
    // distingue; el registro del resultado si dice de donde venia.
    expect(locateOrdinal(index, 10).provenance).toBe("AMOE");
    expect(locateOrdinal(index, 1).provenance).toBe("PURCHASE");
    expect(locateOrdinal(index, 10).lastOrdinal - locateOrdinal(index, 10).firstOrdinal).toBe(0);
  });

  it("un ordinal fuera del universo no se mapea a nadie", () => {
    expect(() => locateOrdinal(index, 0)).toThrow();
    expect(() => locateOrdinal(index, TOTAL_ELIGIBLE_ENTRIES + 1)).toThrow();
  });

  it("el algoritmo lleva version explicita en el registro", () => {
    expect(UNIFORM_SELECTION_ALGORITHM).toMatch(/^LSW\/DRAW\//u);
  });
});

// ---------------------------------------------------------------------------
// Commit-reveal: existe, funciona, y esta APAGADO
// ---------------------------------------------------------------------------

function commitmentStore(record: DrawCommitmentRecord): CommitmentStore & {
  readonly consumed: string[];
} {
  const consumed: string[] = [];
  return {
    consumed,
    find: (id) => Promise.resolve(id === record.id ? record : null),
    markConsumed: (id) => {
      consumed.push(id);
      return Promise.resolve();
    },
  };
}

const SEED = "11".repeat(32);

function commitmentRecord(overrides: Partial<DrawCommitmentRecord> = {}): DrawCommitmentRecord {
  return {
    id: "commitment-1",
    promotionId: PROMOTION_ID,
    snapshotId: SNAPSHOT_ID,
    drawRequestId: DRAW_REQUEST_ID,
    commitment: computeCommitment(SEED),
    serverSeed: SEED,
    publishedAt: "2026-06-01T11:00:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

describe("commit-reveal (DEC-017, nota NO vinculante): apagado por defecto", () => {
  it("la configuracion por defecto no lo usa", () => {
    expect(DEFAULT_DRAW_SERVICE_CONFIG.commitRevealMode).toBe("DISABLED");
  });

  it("pasar un compromiso con el esquema apagado es un error, no un adorno", async () => {
    const world = scenario();
    await expect(
      initiateDraw(world.dependencies, command({ commitmentId: "commitment-1" })),
    ).rejects.toMatchObject({ code: DRAW_REFUSAL_CODES.COMMITMENT_NOT_SUPPORTED });
  });

  it("con el esquema obligatorio y sin compromiso, no se sortea", async () => {
    const world = scenario({ config: { commitRevealMode: "REQUIRED" } });
    await expect(initiateDraw(world.dependencies, command())).rejects.toMatchObject({
      code: DRAW_REFUSAL_CODES.COMMITMENT_REQUIRED,
    });
  });
});

describe("commit-reveal: la verificacion que haria un tercero", () => {
  function commitRevealWorld(record: DrawCommitmentRecord = commitmentRecord()): {
    readonly world: ReturnType<typeof scenario>;
    readonly store: ReturnType<typeof commitmentStore>;
  } {
    const store = commitmentStore(record);
    const world = scenario({ config: { commitRevealMode: "REQUIRED" } });
    return {
      world: {
        ...world,
        dependencies: { ...world.dependencies, commitments: store },
      },
      store,
    };
  }

  it("el compromiso publicado antes ata el resultado que sale despues", async () => {
    const { world, store } = commitRevealWorld();
    const outcome = await initiateDraw(
      world.dependencies,
      command({ commitmentId: "commitment-1" }),
    );

    expect(outcome.entropySource).toBe("COMMIT_REVEAL");
    expect(outcome.drawingEvent.commitment).toBe(computeCommitment(SEED));
    expect(store.consumed).toStrictEqual(["commitment-1"]);

    const verification = verifyDrawReveal({
      commitment: outcome.drawingEvent.commitment,
      serverSeed: SEED,
      context: {
        promotionId: PROMOTION_ID,
        snapshotId: SNAPSHOT_ID,
        snapshotContentDigest: CONTENT_DIGEST,
        totalEligibleEntries: TOTAL_ELIGIBLE_ENTRIES,
        drawRequestId: DRAW_REQUEST_ID,
      },
      recordedOrdinal: outcome.drawingEvent.selectedOrdinal,
      selectOrdinalWith: (source) => selectOrdinal(TOTAL_ELIGIBLE_ENTRIES, source).value,
    });

    expect(verification.verdict).toBe("VERIFIED");
    expect(verification.recomputedOrdinal).toBe(outcome.drawingEvent.selectedOrdinal);
  });

  it("una semilla que no es la comprometida no verifica", () => {
    const verification = verifyDrawReveal({
      commitment: computeCommitment(SEED),
      serverSeed: "22".repeat(32),
      context: {
        promotionId: PROMOTION_ID,
        snapshotId: SNAPSHOT_ID,
        snapshotContentDigest: CONTENT_DIGEST,
        totalEligibleEntries: TOTAL_ELIGIBLE_ENTRIES,
        drawRequestId: DRAW_REQUEST_ID,
      },
      recordedOrdinal: 1,
      selectOrdinalWith: (source) => selectOrdinal(TOTAL_ELIGIBLE_ENTRIES, source).value,
    });
    expect(verification.verdict).toBe("COMMITMENT_MISMATCH");
  });

  it("un sorteo sin compromiso no se puede 'revelar' a posteriori", () => {
    const verification = verifyDrawReveal({
      commitment: null,
      serverSeed: SEED,
      context: {
        promotionId: PROMOTION_ID,
        snapshotId: SNAPSHOT_ID,
        snapshotContentDigest: CONTENT_DIGEST,
        totalEligibleEntries: TOTAL_ELIGIBLE_ENTRIES,
        drawRequestId: DRAW_REQUEST_ID,
      },
      recordedOrdinal: 1,
      selectOrdinalWith: (source) => selectOrdinal(TOTAL_ELIGIBLE_ENTRIES, source).value,
    });
    expect(verification.verdict).toBe("NOT_A_COMMIT_REVEAL_DRAW");
  });

  it("un compromiso ya consumido no se reutiliza", async () => {
    const { world } = commitRevealWorld(
      commitmentRecord({ consumedAt: "2026-05-31T00:00:00.000Z" }),
    );
    await expect(
      initiateDraw(world.dependencies, command({ commitmentId: "commitment-1" })),
    ).rejects.toMatchObject({ code: DRAW_REFUSAL_CODES.COMMITMENT_ALREADY_USED });
  });

  it("un compromiso publicado para otro snapshot no vale para este", async () => {
    const { world } = commitRevealWorld(commitmentRecord({ snapshotId: "otro-snapshot" }));
    await expect(
      initiateDraw(world.dependencies, command({ commitmentId: "commitment-1" })),
    ).rejects.toMatchObject({ code: DRAW_REFUSAL_CODES.COMMITMENT_MISMATCH });
  });

  it("la derivacion desde la semilla es determinista y depende del contexto", () => {
    const base = {
      promotionId: PROMOTION_ID,
      snapshotId: SNAPSHOT_ID,
      snapshotContentDigest: CONTENT_DIGEST,
      totalEligibleEntries: TOTAL_ELIGIBLE_ENTRIES,
      drawRequestId: DRAW_REQUEST_ID,
    };
    const first = selectOrdinal(20, createSeedByteSource(SEED, base)).value;
    const again = selectOrdinal(20, createSeedByteSource(SEED, base)).value;
    expect(again).toBe(first);

    const otherDraw = selectOrdinal(
      20,
      createSeedByteSource(SEED, { ...base, drawRequestId: "otra-peticion" }),
    ).value;
    // No es imposible que coincidan por azar; lo que se comprueba es que el
    // contexto entra en la derivacion, y para eso basta con que los flujos de
    // bytes difieran.
    const bytesA = createSeedByteSource(SEED, base)(32);
    const bytesB = createSeedByteSource(SEED, { ...base, drawRequestId: "otra-peticion" })(32);
    expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(false);
    expect(Number.isSafeInteger(otherDraw)).toBe(true);
  });

  it("la semilla sale del CSPRNG y su compromiso es SHA-256 con etiqueta de dominio", () => {
    const csprng = sequenceCsprng(Array.from({ length: 32 }, (_unused, index) => index));
    const commitment = createDrawCommitment(csprng);
    expect(commitment.serverSeed).toHaveLength(64);
    expect(verifyCommitment(commitment.commitment, commitment.serverSeed)).toBe(true);
    expect(verifyCommitment(commitment.commitment, SEED)).toBe(false);
    // El compromiso NO es SHA-256 del seed a secas: lleva etiqueta de dominio,
    // para que el mismo valor no pueda presentarse como hash de otra cosa.
    const sinEtiqueta = createHash("sha256")
      .update(Buffer.from(commitment.serverSeed, "hex"))
      .digest("hex");
    expect(commitment.commitment).not.toBe(sinEtiqueta);
  });
});

describe("los errores del sorteo son de tipo propio, no genericos", () => {
  it("DrawRefusedError lleva codigo estable", () => {
    const error = new DrawRefusedError(DRAW_REFUSAL_CODES.FEATURE_DISABLED, "detalle");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("draw.refused.feature_disabled");
  });
});
