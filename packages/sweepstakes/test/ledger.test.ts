/**
 * Reglas de dominio del entry ledger.
 *
 * ALCANCE Y LIMITE DE ESTE ARCHIVO
 *
 *   Prueba que el DOMINIO entiende las reglas igual que las entiende
 *   PostgreSQL. NO prueba que se cumplan: eso solo lo puede demostrar el motor,
 *   y por eso existe `packages/database/test/integration/entry-ledger.int.test.ts`,
 *   que intenta activamente el UPDATE y el DELETE con los tres roles.
 *
 *   Si estas dos capas divergen, gana la base de datos y el bug esta aqui.
 */

import { describe, expect, it } from "vitest";

import {
  ENTRY_SOURCE_TYPES,
  ENTRY_TRANSACTION_SIGN,
  ENTRY_TRANSACTION_TYPES,
  entryNumberRangeSize,
  entrySourceRef,
  entryTransactionForbidsAnchor,
  entryTransactionRequiresAnchor,
  formatEntryNumber,
  isValidEntryReasonKey,
  parseEntryNumberRange,
  serializeEntryNumberRange,
  validateLedgerEntryDraft,
  type EntryTransactionType,
  type LedgerEntryDraft,
} from "../src/index.js";

function draft(overrides: Partial<LedgerEntryDraft> = {}): LedgerEntryDraft {
  return {
    type: "PURCHASE_EARNED",
    sourceType: "PURCHASE",
    sourceRef: "order:abc",
    quantityDelta: 10,
    reasonKey: "ORDER_QUALIFIED",
    reversesTransactionId: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("procedencia (principio 9)", () => {
  it("compra y AMOE son procedencias del MISMO universo, no dos modelos", () => {
    expect(ENTRY_SOURCE_TYPES).toContain("PURCHASE");
    expect(ENTRY_SOURCE_TYPES).toContain("AMOE");
  });

  it("distingue lo que teclea una persona de lo que emite un job", () => {
    expect(ENTRY_SOURCE_TYPES).toContain("ADMIN");
    expect(ENTRY_SOURCE_TYPES).toContain("SYSTEM");
  });
});

describe("signo y anclaje de cada tipo de movimiento", () => {
  it("todo tipo declara signo", () => {
    for (const type of ENTRY_TRANSACTION_TYPES) {
      expect(ENTRY_TRANSACTION_SIGN[type]).toMatch(/^(POSITIVE|NEGATIVE)$/u);
    }
  });

  it("ningun movimiento positivo puede anclarse: es origen, no correccion", () => {
    for (const type of ENTRY_TRANSACTION_TYPES) {
      if (ENTRY_TRANSACTION_SIGN[type] === "POSITIVE") {
        expect(entryTransactionForbidsAnchor(type)).toBe(true);
        expect(entryTransactionRequiresAnchor(type)).toBe(false);
      }
    }
  });

  it("los cuatro reversales de una transaccion concreta exigen anclaje", () => {
    const anchored: readonly EntryTransactionType[] = [
      "REFUND_REVERSAL",
      "PARTIAL_REFUND_REVERSAL",
      "CHARGEBACK_REVERSAL",
      "FRAUD_REVERSAL",
    ];
    for (const type of anchored) {
      expect(entryTransactionRequiresAnchor(type)).toBe(true);
    }
  });

  it("descalificacion y debito manual NO exigen anclaje, y hay un motivo", () => {
    // Una descalificacion revierte el saldo completo, que puede venir de
    // decenas de transacciones. Obligarla a senalar una sola seria obligarla a
    // mentir sobre que esta revirtiendo.
    expect(entryTransactionRequiresAnchor("DISQUALIFICATION_REVERSAL")).toBe(false);
    expect(entryTransactionRequiresAnchor("MANUAL_DEBIT")).toBe(false);
    expect(entryTransactionForbidsAnchor("DISQUALIFICATION_REVERSAL")).toBe(false);
  });
});

describe("validacion de un movimiento", () => {
  it("acepta un movimiento bien formado", () => {
    expect(validateLedgerEntryDraft(draft(), { entryExpirationEnabled: false })).toEqual([]);
  });

  it("rechaza delta cero: un movimiento que no mueve nada no es un movimiento", () => {
    expect(
      validateLedgerEntryDraft(draft({ quantityDelta: 0 }), { entryExpirationEnabled: false }),
    ).toContain("ENTRY_DELTA_MUST_BE_NON_ZERO_INTEGER");
  });

  it("rechaza un refund que SUMA entries", () => {
    expect(
      validateLedgerEntryDraft(
        draft({ type: "REFUND_REVERSAL", quantityDelta: 5, reversesTransactionId: "t1" }),
        { entryExpirationEnabled: false },
      ),
    ).toContain("ENTRY_DELTA_SIGN_MISMATCH");
  });

  it("rechaza un refund sin transaccion revertida", () => {
    expect(
      validateLedgerEntryDraft(draft({ type: "REFUND_REVERSAL", quantityDelta: -5 }), {
        entryExpirationEnabled: false,
      }),
    ).toContain("ENTRY_ANCHOR_REQUIRED");
  });

  it("rechaza una entry ganada que dice revertir algo", () => {
    expect(
      validateLedgerEntryDraft(draft({ reversesTransactionId: "t1" }), {
        entryExpirationEnabled: false,
      }),
    ).toContain("ENTRY_ANCHOR_FORBIDDEN");
  });

  it("rechaza prosa como motivo: el contrato manda codigos, no texto (DEC-022)", () => {
    expect(
      validateLedgerEntryDraft(draft({ reasonKey: "El cliente devolvio el producto" }), {
        entryExpirationEnabled: false,
      }),
    ).toContain("ENTRY_REASON_KEY_INVALID");
  });

  it("devuelve TODOS los problemas a la vez, no el primero", () => {
    const problems = validateLedgerEntryDraft(
      draft({ type: "REFUND_REVERSAL", quantityDelta: 7, reasonKey: "minusculas" }),
      { entryExpirationEnabled: false },
    );
    expect(problems).toContain("ENTRY_DELTA_SIGN_MISMATCH");
    expect(problems).toContain("ENTRY_ANCHOR_REQUIRED");
    expect(problems).toContain("ENTRY_REASON_KEY_INVALID");
  });
});

describe("caducidad como configuracion apagada (DEC-033)", () => {
  it("con el flag apagado, una fecha de caducidad es un error y no un dato", () => {
    expect(
      validateLedgerEntryDraft(draft({ expiresAt: new Date("2027-01-01T00:00:00Z") }), {
        entryExpirationEnabled: false,
      }),
    ).toContain("ENTRY_EXPIRATION_NOT_ENABLED");
  });

  it("con el flag encendido, la misma fecha se acepta sin tocar nada mas", () => {
    expect(
      validateLedgerEntryDraft(draft({ expiresAt: new Date("2027-01-01T00:00:00Z") }), {
        entryExpirationEnabled: true,
      }),
    ).toEqual([]);
  });

  it("sin caducidad, el movimiento es valido con el flag en cualquier posicion", () => {
    expect(validateLedgerEntryDraft(draft(), { entryExpirationEnabled: true })).toEqual([]);
    expect(validateLedgerEntryDraft(draft(), { entryExpirationEnabled: false })).toEqual([]);
  });
});

describe("referencia idempotente (DEC-009)", () => {
  it("una compra y su devolucion producen referencias DISTINTAS", () => {
    // Si compartieran referencia, la restriccion de idempotencia impediria el
    // reversal legitimo: el fallo contrario al que se busca evitar.
    expect(entrySourceRef("order", "abc")).not.toBe(entrySourceRef("refund", "abc"));
  });

  it("normaliza para que dos escrituras del mismo hecho colisionen de verdad", () => {
    expect(entrySourceRef("ORDER", " abc ")).toBe("order:abc");
  });

  it("rechaza un tipo de referencia con forma libre", () => {
    expect(() => entrySourceRef("orden de compra", "abc")).toThrow(RangeError);
    expect(() => entrySourceRef("order", "")).toThrow(RangeError);
  });
});

describe("motivos estables", () => {
  it("acepta un codigo en mayusculas con guion bajo", () => {
    expect(isValidEntryReasonKey("ORDER_REFUNDED_IN_PART")).toBe(true);
  });

  it("rechaza minusculas, espacios y acentos", () => {
    expect(isValidEntryReasonKey("order_refunded")).toBe(false);
    expect(isValidEntryReasonKey("ORDER REFUNDED")).toBe(false);
    expect(isValidEntryReasonKey("DEVOLUCION_PARCIAL_ARTICULO_ROTO_ANO")).toBe(true);
    expect(isValidEntryReasonKey("DEVOLUCIÓN")).toBe(false);
  });
});

describe("numeros y rangos (DEC-009, DEC-010)", () => {
  it("formatea el identificador visible como texto, nunca como numero", () => {
    expect(formatEntryNumber("LSW26", 9, 450001n)).toBe("LSW26-000450001");
  });

  it("conserva la precision de un numero por encima del rango seguro de number", () => {
    // 999999999999 no es representable como literal `number` sin riesgo en
    // aritmetica; como `bigint` es exacto.
    expect(formatEntryNumber("LSW26", 12, 999999999999n)).toBe("LSW26-999999999999");
  });

  it("falla si el numero no cabe en el ancho declarado, en vez de desbordarlo en silencio", () => {
    // Devolverlo tal cual haria convivir identificadores de dos anchos
    // distintos dentro de la misma promocion.
    expect(() => formatEntryNumber("LSW26", 6, 1234567n)).toThrow(RangeError);
  });

  it("rechaza un prefijo o un ancho fuera de contrato", () => {
    expect(() => formatEntryNumber("lsw", 9, 1n)).toThrow(RangeError);
    expect(() => formatEntryNumber("LSW26", 3, 1n)).toThrow(RangeError);
    expect(() => formatEntryNumber("LSW26", 9, 0n)).toThrow(RangeError);
  });

  it("parsea el int8range semiabierto de PostgreSQL", () => {
    const range = parseEntryNumberRange("[450001,461001)");
    expect(range.start).toBe(450001n);
    expect(range.end).toBe(461001n);
    expect(entryNumberRangeSize(range)).toBe(11000n);
  });

  it("ida y vuelta sin perdida", () => {
    expect(serializeEntryNumberRange(parseEntryNumberRange("[1,11)"))).toBe("[1,11)");
  });

  it("rechaza un rango cerrado o invertido", () => {
    // Con rangos cerrados por ambos lados, dos bloques contiguos se solapan en
    // el extremo y la restriccion de exclusion los rechazaria con razon.
    expect(() => parseEntryNumberRange("[1,11]")).toThrow(RangeError);
    expect(() => parseEntryNumberRange("[11,1)")).toThrow(RangeError);
  });
});
