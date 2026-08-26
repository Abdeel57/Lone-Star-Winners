/**
 * INVARIANTE: la hash chain DETECTA la manipulacion. No basta con que corra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE FICHERO ESTA ESCRITO ASI
 * ---------------------------------------------------------------------------
 *
 * Un test que construya una cadena honesta y compruebe que verifica demuestra
 * una sola cosa: que el codigo es consistente consigo mismo. Es exactamente el
 * mismo fallo que ya tumbo dos veces los escaneres de este repositorio -un
 * detector que reporta verde por AUSENCIA de busqueda- y en un control de
 * integridad tiene consecuencias peores, porque el informe que produce se
 * ensena a un tercero.
 *
 * Asi que aqui se manipula de verdad, de las siete formas en que un atacante
 * lo intentaria, y se exige que cada una salga en el informe con el nombre
 * correcto. Un control que nadie intenta romper no esta probado.
 *
 * La septima es la importante: reescribir la cadena ENTERA de forma coherente.
 * Contra esa, `verifyChain` no puede hacer nada -y el test lo afirma sin
 * rodeos- y la unica defensa es el sello externo de DEC-008.
 */

import { describe, expect, it } from "vitest";

import {
  CHAIN_DOMAIN_AUDIT_EVENT,
  CHAIN_DOMAIN_ENTRY_LEDGER,
  CURRENT_CANONICALIZATION_VERSION,
  compareWithSeal,
  computeRowHash,
  genesisHash,
  runChainIntegrityCheck,
  toHex,
  verifyChain,
} from "@lsw/audit";
import type { AuditActor, ChainBreakKind, ChainHeadSeal, StoredChainLink } from "@lsw/audit";

import {
  LEDGER_PROMOTION_ID,
  buildLedgerRow,
  chainRows,
  honestChain,
} from "../helpers/ledger-chain.js";

const PROMOTION = LEDGER_PROMOTION_ID;
const OTHER_PROMOTION = "00000000-0000-4000-8000-00000000cccc";

const AUDITOR: AuditActor = { type: "SYSTEM", id: "integrity-job", roles: ["SYSTEM"] };
const WHEN = "2026-04-01T00:00:00.000Z";

function verify(links: readonly StoredChainLink[], promotionId: string = PROMOTION) {
  return verifyChain({ domain: CHAIN_DOMAIN_ENTRY_LEDGER, promotionId, links });
}

function kinds(
  links: readonly StoredChainLink[],
  promotionId: string = PROMOTION,
): readonly ChainBreakKind[] {
  return verify(links, promotionId).breaks.map((entry) => entry.kind);
}

/** Sello externo tomado de una cadena honesta, antes de que nadie la toque. */
function sealOf(links: readonly StoredChainLink[]): ChainHeadSeal {
  const head = verify(links);
  const last = links.at(-1);
  if (head.observedHeadHash === null || last === undefined) {
    throw new Error("La cadena de partida deberia tener head.");
  }
  return {
    domain: CHAIN_DOMAIN_ENTRY_LEDGER,
    promotionId: PROMOTION,
    headHash: head.observedHeadHash,
    linkCount: links.length,
    lastSequence: last.sequence,
    canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
    sealedAt: "2026-03-20T03:00:00.000Z",
    sealedBy: "sealing-job",
    storeId: "write-once-de-prueba",
    externalReference: "seal-0001",
  };
}

describe("DEC-008: la cadena honesta verifica", () => {
  it("una cadena sin tocar no produce ni una rotura", () => {
    const result = verify(honestChain(8));
    expect(result.ok).toBe(true);
    expect(result.breaks).toStrictEqual([]);
    expect(result.linkCount).toBe(8);
    expect(result.observedHeadHash).not.toBeNull();
  });

  it("el head cambia si cambia cualquier fila anterior", () => {
    const original = verify(honestChain(5)).observedHeadHash;
    const otro = chainRows([
      buildLedgerRow(1),
      buildLedgerRow(2, { quantity_delta: 11 }),
      buildLedgerRow(3),
      buildLedgerRow(4),
      buildLedgerRow(5),
    ]);
    expect(verify(otro).observedHeadHash).not.toBe(original);
  });
});

describe("DEC-008: manipulacion detectada", () => {
  it("1. alterar un campo de una fila intermedia", () => {
    const links = [...honestChain(6)];
    const target = links[3];
    if (target === undefined) {
      throw new Error("fixture");
    }
    // El caso mas rentable para un atacante: subirse las entries.
    links[3] = { ...target, row: { ...target.row, quantity_delta: 9999 } };

    const result = verify(links);
    expect(result.ok).toBe(false);
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks.at(0)?.kind).toBe("HASH_MISMATCH");
    expect(result.breaks.at(0)?.index).toBe(3);
  });

  it("1.bis una sola fila tocada produce UNA rotura, no una cascada", () => {
    // Si el verificador recalculase en cascada, las tres filas siguientes
    // aparecerian como rotas y el informe diria "la cadena esta rota
    // desde marzo" donde hay UNA fila alterada. Un informe que confunde la
    // manipulacion con sus consecuencias no sirve para investigar.
    const links = [...honestChain(10)];
    const target = links[2];
    if (target === undefined) {
      throw new Error("fixture");
    }
    links[2] = { ...target, row: { ...target.row, reason_key: "entry.manual_credit" } };

    expect(verify(links).breaks).toHaveLength(1);
  });

  it("2. borrar una fila intermedia rompe el encadenamiento", () => {
    const links = honestChain(6);
    const sinLaCuarta = [...links.slice(0, 3), ...links.slice(4)];

    expect(kinds(sinLaCuarta)).toContain("LINK_BROKEN");
  });

  it("3. reordenar dos filas se detecta aunque ninguna se altere", () => {
    const links = [...honestChain(6)];
    const a = links[2];
    const b = links[3];
    if (a === undefined || b === undefined) {
      throw new Error("fixture");
    }
    links[2] = b;
    links[3] = a;

    const result = verify(links);
    expect(result.ok).toBe(false);
    expect(result.breaks.map((entry) => entry.kind)).toContain("LINK_BROKEN");
  });

  it("4. insertar una fila fabricada en medio", () => {
    const links = honestChain(6);
    const anterior = links.at(2);
    if (anterior === undefined) {
      throw new Error("fixture");
    }

    // El atacante hace las cosas bien: engancha su fila al hash anterior y
    // calcula su propio hash correctamente. Lo que no puede es arreglar la
    // fila SIGUIENTE, cuyo `chain_prev_hash` sigue apuntando al de antes.
    const row = buildLedgerRow(99, { quantity_delta: 500 });
    const forjada: StoredChainLink = {
      id: String(row.id),
      sequence: "4",
      canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
      row,
      storedHash: computeRowHash({
        domain: CHAIN_DOMAIN_ENTRY_LEDGER,
        promotionId: PROMOTION,
        row,
        previousHash: anterior.storedHash,
      }),
      storedPreviousHash: anterior.storedHash,
    };

    const conForjada = [...links.slice(0, 3), forjada, ...links.slice(3)];
    expect(kinds(conForjada)).toContain("LINK_BROKEN");
  });

  it("5. reetiquetar la version de canonicalizacion no da un aprobado", () => {
    // Sustitucion de version: marcar la fila como "v2" para presentar despues
    // una canonicalizacion mas permisiva. La fila NO queda verificada, y eso
    // tiene que decirse; callarlo seria dar por buena una fila no mirada.
    const links = [...honestChain(4)];
    const target = links[1];
    if (target === undefined) {
      throw new Error("fixture");
    }
    links[1] = { ...target, canonicalizationVersion: 2 };

    expect(kinds(links)).toContain("UNSUPPORTED_VERSION");
  });

  it("6. injertar la cadena de otra promocion", () => {
    // El genesis se deriva de (dominio, promocion). Con 32 ceros como ancla
    // -que es lo que se escribe cuando nadie piensa en esto- las filas de una
    // promocion valdrian como primeras filas de otra, con sus hashes intactos.
    expect(toHex(genesisHash(CHAIN_DOMAIN_ENTRY_LEDGER, PROMOTION))).not.toBe(
      toHex(genesisHash(CHAIN_DOMAIN_ENTRY_LEDGER, OTHER_PROMOTION)),
    );

    const ajena = honestChain(4, OTHER_PROMOTION);
    const result = verify(ajena, PROMOTION);

    expect(result.ok).toBe(false);
    // El injerto se manifiesta en la PRIMERA fila, porque el genesis es una de
    // las entradas de su hash. Desde el hash no se puede distinguir "fila
    // alterada" de "fila de otra cadena", y el informe no finge que si: dice
    // las dos posibilidades.
    expect(result.breaks.at(0)?.kind).toBe("HASH_MISMATCH");
    expect(result.breaks.at(0)?.detail).toContain("otra promocion");
  });

  it("6.ter un dominio distinto tampoco comparte ancla", () => {
    // La misma promocion, otra cadena: el ledger y los AuditEvent no pueden
    // prestarse filas entre si.
    expect(toHex(genesisHash(CHAIN_DOMAIN_ENTRY_LEDGER, PROMOTION))).not.toBe(
      toHex(genesisHash(CHAIN_DOMAIN_AUDIT_EVENT, PROMOTION)),
    );
  });

  it("un sequence_no con basura se informa, no tumba al verificador", () => {
    // Las entradas del verificador salen de una base de datos que, por la
    // hipotesis del propio control, puede estar bajo el control de quien
    // manipula. Un verificador que lanza ante un dato torcido es un
    // verificador que se puede apagar desde la tabla que vigila.
    const links = [...honestChain(3)];
    const target = links[1];
    if (target === undefined) {
      throw new Error("fixture");
    }
    links[1] = { ...target, sequence: "3.5" };

    expect(() => verify(links)).not.toThrow();
    expect(kinds(links)).toContain("MALFORMED_SEQUENCE");
  });

  it("6.bis la misma cadena verifica bajo su propia promocion", () => {
    expect(verify(honestChain(4, OTHER_PROMOTION), OTHER_PROMOTION).ok).toBe(true);
  });

  it("un campo omitido no se rellena con null: falla", () => {
    const links = [...honestChain(3)];
    const target = links[1];
    if (target === undefined) {
      throw new Error("fixture");
    }
    const sinReason = { ...target.row };
    delete sinReason.reason_key;
    links[1] = { ...target, row: sinReason };

    expect(kinds(links)).toContain("PAYLOAD_UNCANONICALIZABLE");
  });
});

describe("DEC-008: la reescritura completa NO la detecta la cadena, la detecta el sello", () => {
  it("7. una cadena recalculada entera verifica sin una sola rotura", () => {
    // Este es el limite honesto de la hash chain, y conviene que este escrito
    // como test y no como comentario: quien tenga acceso de escritura total
    // puede cambiar el pasado y rehacer los hashes. El resultado es
    // internamente PERFECTO. Si el sistema se quedara aqui, DEC-008 seria
    // append-only con pasos extra.
    const reescrita = chainRows([
      buildLedgerRow(1),
      buildLedgerRow(2, { quantity_delta: 9999 }),
      buildLedgerRow(3),
      buildLedgerRow(4),
      buildLedgerRow(5),
    ]);

    expect(verify(reescrita).ok).toBe(true);
  });

  it("7.bis el sello externo si la detecta", () => {
    const original = honestChain(5);
    const sello = sealOf(original);

    const reescrita = chainRows([
      buildLedgerRow(1),
      buildLedgerRow(2, { quantity_delta: 9999 }),
      buildLedgerRow(3),
      buildLedgerRow(4),
      buildLedgerRow(5),
    ]);
    const head = verify(reescrita);

    const comparacion = compareWithSeal({
      seal: sello,
      observedLinkCount: reescrita.length,
      observedHeadAtSealedLength: toHex(
        reescrita.at(sello.linkCount - 1)?.storedHash ?? new Uint8Array(),
      ),
      observedHeadHash: head.observedHeadHash,
    });

    expect(comparacion.verdict).toBe("HISTORY_REWRITTEN");
  });

  it("7.ter el job emite INTEGRITY_FAILURE ante una reescritura coherente", () => {
    const sello = sealOf(honestChain(5));
    const reescrita = chainRows([
      buildLedgerRow(1),
      buildLedgerRow(2, { quantity_delta: 9999 }),
      buildLedgerRow(3),
      buildLedgerRow(4),
      buildLedgerRow(5),
    ]);

    const informe = runChainIntegrityCheck({
      domain: CHAIN_DOMAIN_ENTRY_LEDGER,
      promotionId: PROMOTION,
      links: reescrita,
      seal: sello,
      occurredAt: WHEN,
      actor: AUDITOR,
    });

    expect(informe.chain.ok).toBe(true);
    expect(informe.verdict).toBe("COMPROMISED");
    expect(informe.auditEvent.action).toBe("audit.integrity_failure");
    expect(informe.auditEvent.reasonCode).toBe("integrity.seal_mismatch");
  });

  it("borrar la cola de la cadena se detecta como truncamiento", () => {
    const original = honestChain(8);
    const sello = sealOf(original);
    const truncada = original.slice(0, 5);

    const informe = runChainIntegrityCheck({
      domain: CHAIN_DOMAIN_ENTRY_LEDGER,
      promotionId: PROMOTION,
      links: truncada,
      seal: sello,
      occurredAt: WHEN,
      actor: AUDITOR,
    });

    expect(informe.seal.verdict).toBe("TRUNCATED");
    expect(informe.verdict).toBe("COMPROMISED");
  });
});

describe("DEC-008: sin sello externo el veredicto no puede ser 'INTACT'", () => {
  it("una cadena consistente pero no anclada se informa como UNSEALED", () => {
    const informe = runChainIntegrityCheck({
      domain: CHAIN_DOMAIN_ENTRY_LEDGER,
      promotionId: PROMOTION,
      links: honestChain(5),
      seal: null,
      occurredAt: WHEN,
      actor: AUDITOR,
    });

    expect(informe.chain.ok).toBe(true);
    // Lo importante de esta linea: NO es "INTACT". Un verde aqui invitaria a
    // no montar nunca el almacen write-once, y entonces la unica defensa
    // contra la reescritura completa no existiria.
    expect(informe.verdict).toBe("UNSEALED");
    expect(informe.auditEvent.action).toBe("audit.integrity_check");
    expect(informe.auditEvent.reasonCode).toBe("integrity.chain_unsealed");
  });

  it("con sello coincidente el veredicto es INTACT", () => {
    const links = honestChain(5);
    const informe = runChainIntegrityCheck({
      domain: CHAIN_DOMAIN_ENTRY_LEDGER,
      promotionId: PROMOTION,
      links,
      seal: sealOf(links),
      occurredAt: WHEN,
      actor: AUDITOR,
    });

    expect(informe.verdict).toBe("INTACT");
    expect(informe.seal.verdict).toBe("MATCHES");
  });

  it("una cadena que crecio desde el sello sigue siendo valida", () => {
    const original = honestChain(5);
    const sello = sealOf(original);
    const crecida = honestChain(9);

    const informe = runChainIntegrityCheck({
      domain: CHAIN_DOMAIN_ENTRY_LEDGER,
      promotionId: PROMOTION,
      links: crecida,
      seal: sello,
      occurredAt: WHEN,
      actor: AUDITOR,
    });

    expect(informe.seal.verdict).toBe("AHEAD_OF_SEAL");
    expect(informe.verdict).toBe("INTACT");
  });
});
