/**
 * "Mis numeros" (DEC-080): `GET /api/v1/account/entry-numbers`.
 *
 * Recorre el handler y la serializacion REALES, con el dominio en memoria (ver
 * la cabecera de `amoe-adjustments.test.ts`). Que la base de datos numere cada
 * transaccion positiva al confirmar lo prueba la suite de integracion de
 * `packages/database`; aqui se prueba lo que ve el participante:
 *
 *   1. que con el flag apagado la funcion no existe (404);
 *   2. que cada participacion trae un numero distinto, el de la permutacion de
 *      la promocion, y que los de una compra devuelta salen anulados;
 *   3. que la paginacion por numeros no repite ni se salta ninguno, tambien
 *      cuando un lote se parte entre dos paginas;
 *   4. que un cursor ajeno o manipulado no da acceso a nada.
 */

import {
  createEntryNumberCipher,
  DEFAULT_SWEEPSTAKES_FLAGS,
  ENTRY_CALCULATION_ENGINE_VERSION,
  ENTRY_REASON_KEYS,
  FixedClock,
  InMemoryEntryNumberPort,
  InMemoryLedgerRepository,
  type EntryTransactionType,
  type IanaTimeZone,
  type PromotionContext,
} from "@lsw/sweepstakes";
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { RequestPrincipal } from "../src/http/principal.js";
import {
  createFakeRepositories,
  PARTICIPANT_ID,
  PROMOTION_ID,
  RULES_VERSION_ID,
} from "./support/in-memory-repositories.js";

const OTHER_PARTICIPANT_ID = "34343434-3434-4343-8343-343434343434";
const NOW = new Date("2026-10-06T12:00:00.000Z");
const URL = `/api/v1/account/entry-numbers?promotion_id=${PROMOTION_ID}`;

const shared: { domain: unknown } = vi.hoisted(() => ({ domain: null }));

vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => shared.domain,
}));

interface EntryNumbersBody {
  digits: number;
  active_numbers: number;
  void_numbers: number;
  items: {
    batch_id: string;
    source_type: string;
    quantity: number;
    active_quantity: number;
    numbers: { number: string; active: boolean }[];
  }[];
  next_cursor: string | null;
}

interface Harness {
  readonly ledger: InMemoryLedgerRepository;
  readonly entryNumbers: InMemoryEntryNumberPort;
  /** Otorga `quantity` participaciones y numera su lote, como hace la compra. */
  award(participantId: string, quantity: number, ref: string): Promise<string>;
  /** Revierte `quantity` de la transaccion `anchorId`, como hace una devolucion. */
  refund(participantId: string, anchorId: string, quantity: number, ref: string): Promise<void>;
}

let nextId = 0;
function id(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function buildDomain(flags: Partial<PromotionContext["flags"]>): Harness {
  const ledger = new InMemoryLedgerRepository();
  const entryNumbers = new InMemoryEntryNumberPort();

  const context: PromotionContext = {
    promotionId: PROMOTION_ID,
    status: "ACTIVE",
    legalTimeZone: "America/Chicago" as IanaTimeZone,
    startsAt: new Date("2026-10-05T05:00:00.000Z"),
    endsAt: new Date("2026-11-09T05:59:59.000Z"),
    currency: "USD",
    rulesVersionId: RULES_VERSION_ID,
    rulesConfig: {},
    flags: { ...DEFAULT_SWEEPSTAKES_FLAGS, ...flags },
    amoeMode: null,
  };

  const promotions = {
    getContext: (promotionId: string) =>
      Promise.resolve(promotionId === PROMOTION_ID ? context : null),
    describeMissingContext: () => Promise.resolve("PROMOTION_NOT_FOUND"),
    readFlags: () => Promise.resolve(context.flags),
  };

  async function append(
    participantId: string,
    type: EntryTransactionType,
    quantityDelta: number,
    ref: string,
    reversesTransactionId: string | null,
  ): Promise<string> {
    const transaction = await ledger.append({
      id: id(),
      promotionId: PROMOTION_ID,
      participantId,
      type,
      sourceType: "PURCHASE",
      sourceRef: ref,
      quantityDelta,
      status: "POSTED",
      effectiveAt: new Date("2026-10-05T18:00:00.000Z"),
      expiresAt: null,
      recordedAt: new Date("2026-10-05T18:00:00.000Z"),
      rulesVersionId: RULES_VERSION_ID,
      engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
      calculationSnapshotId: null,
      reversesTransactionId,
      actorType: "SYSTEM",
      actorAdminUserId: null,
      actorParticipantId: null,
      reasonKey:
        quantityDelta > 0 ? ENTRY_REASON_KEYS.purchaseQualified : ENTRY_REASON_KEYS.refundFull,
      reasonDetail: null,
      metadata: {},
    });
    return transaction.id;
  }

  shared.domain = {
    repositories: { ledger, entryNumbers, promotions },
    clock: new FixedClock(NOW),
  };

  return {
    ledger,
    entryNumbers,
    award: async (participantId, quantity, ref) => {
      const transactionId = await append(participantId, "PURCHASE_EARNED", quantity, ref, null);
      const range = await entryNumbers.allocateRange(PROMOTION_ID, quantity);
      await entryNumbers.saveBatch({
        id: id(),
        entryTransactionId: transactionId,
        promotionId: PROMOTION_ID,
        participantId,
        quantity,
        range,
        allocationStrategy: "SEQUENTIAL_PER_PROMOTION",
        allocationVersion: 1,
        createdAt: NOW,
      });
      return transactionId;
    },
    refund: async (participantId, anchorId, quantity, ref) => {
      await append(participantId, "REFUND_REVERSAL", -quantity, ref, anchorId);
    },
  };
}

const PARTICIPANT: RequestPrincipal = {
  kind: "PARTICIPANT",
  participantId: PARTICIPANT_ID,
  sessionRef: "fixture-session-reference-0001",
};

async function appForParticipant(): Promise<FastifyInstance> {
  const app = await createApp({
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
  } as unknown as AppDependencies);
  app.lswAuthorizer = () => ({ allowed: true });
  app.lswPrincipalResolver = () => PARTICIPANT;
  return app;
}

async function getPage(app: FastifyInstance, query = ""): Promise<EntryNumbersBody> {
  const response = await app.inject({ method: "GET", url: `${URL}${query}` });
  expect(response.statusCode).toBe(200);
  return response.json<EntryNumbersBody>();
}

beforeEach(() => {
  shared.domain = null;
});

describe("GET /api/v1/account/entry-numbers", () => {
  it("con el flag apagado la funcion no existe, aunque los numeros si", async () => {
    const domain = buildDomain({ visible_entry_numbers_enabled: false });
    await domain.award(PARTICIPANT_ID, 10, "order:a");
    const app = await appForParticipant();

    const response = await app.inject({ method: "GET", url: URL });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("un numero distinto por participacion, y los de la compra devuelta anulados", async () => {
    const domain = buildDomain({ visible_entry_numbers_enabled: true });
    const orderA = await domain.award(PARTICIPANT_ID, 10, "order:a");
    await domain.award(OTHER_PARTICIPANT_ID, 4, "order:other");
    await domain.award(PARTICIPANT_ID, 5, "order:b");
    await domain.refund(PARTICIPANT_ID, orderA, 10, "refund:a");
    const app = await appForParticipant();

    const body = await getPage(app);

    expect(body.digits).toBe(8);
    expect(body.active_numbers).toBe(5);
    expect(body.void_numbers).toBe(10);
    expect(body.next_cursor).toBeNull();
    // Solo los lotes del participante, en orden de asignacion.
    expect(body.items.map((item) => [item.quantity, item.active_quantity])).toEqual([
      [10, 0],
      [5, 5],
    ]);
    expect(body.items[0]?.numbers.every((entry) => !entry.active)).toBe(true);
    expect(body.items[1]?.numbers.every((entry) => entry.active)).toBe(true);

    const numbers = body.items.flatMap((item) => item.numbers.map((entry) => entry.number));
    expect(new Set(numbers).size).toBe(15);
    expect(numbers.every((value) => /^\d{8}$/u.test(value))).toBe(true);

    // Son los de la permutacion de la promocion: el lote B empieza en el
    // ordinal 15 (1-10 de A, 11-14 del otro participante).
    const format = await domain.entryNumbers.getFormat(PROMOTION_ID);
    if (format === null) throw new Error("la promocion deberia tener formato");
    const cipher = createEntryNumberCipher(format.key, format.digits);
    expect(body.items[1]?.numbers.map((entry) => entry.number)).toEqual(
      [15, 16, 17, 18, 19].map((ordinal) => cipher.encode(ordinal)),
    );
    await app.close();
  });

  it("pagina por numeros sin repetir ni saltarse ninguno, partiendo lotes", async () => {
    const domain = buildDomain({ visible_entry_numbers_enabled: true });
    await domain.award(PARTICIPANT_ID, 5, "order:a");
    await domain.award(PARTICIPANT_ID, 10, "order:b");
    await domain.award(PARTICIPANT_ID, 3, "order:c");
    const app = await appForParticipant();

    const seen: string[] = [];
    const pages: number[][] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? "&limit=7" : `&limit=7&cursor=${cursor}`;
      const page = await getPage(app, query);
      pages.push(page.items.map((item) => item.numbers.length));
      seen.push(...page.items.flatMap((item) => item.numbers.map((entry) => entry.number)));
      cursor = page.next_cursor;
    } while (cursor !== null);

    // 5 + 2 | 7 | 1 + 3: el lote de 10 se parte en tres paginas.
    expect(pages).toEqual([[5, 2], [7], [1, 3]]);
    expect(seen).toHaveLength(18);
    expect(new Set(seen).size).toBe(18);
    await app.close();
  });

  it("un cursor que no es de un lote propio es un cursor invalido", async () => {
    const domain = buildDomain({ visible_entry_numbers_enabled: true });
    await domain.award(PARTICIPANT_ID, 3, "order:a");
    await domain.award(OTHER_PARTICIPANT_ID, 3, "order:other");
    const app = await appForParticipant();

    const others = await domain.entryNumbers.listBatchesForParticipant(
      PROMOTION_ID,
      OTHER_PARTICIPANT_ID,
    );
    const foreign = Buffer.from(JSON.stringify({ k: others[0]?.id, i: "0" })).toString("base64url");
    const mine = await domain.entryNumbers.listBatchesForParticipant(PROMOTION_ID, PARTICIPANT_ID);
    const outOfRange = Buffer.from(JSON.stringify({ k: mine[0]?.id, i: "3" })).toString(
      "base64url",
    );

    for (const cursor of [foreign, outOfRange, "no-es-un-cursor"]) {
      const response = await app.inject({ method: "GET", url: `${URL}&cursor=${cursor}` });
      expect(response.statusCode).toBe(422);
    }
    await app.close();
  });

  it("sin participaciones devuelve una lista vacia, no un error", async () => {
    buildDomain({ visible_entry_numbers_enabled: true });
    const app = await appForParticipant();

    const body = await getPage(app);

    expect(body).toMatchObject({
      active_numbers: 0,
      void_numbers: 0,
      items: [],
      next_cursor: null,
    });
    await app.close();
  });
});
