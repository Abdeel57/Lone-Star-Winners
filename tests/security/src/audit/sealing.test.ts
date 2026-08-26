/**
 * INVARIANTE: sin almacen write-once configurado no se finge que hay sello.
 *
 * DEC-008 exige anclar el `chain_head_hash` fuera del alcance del rol de la
 * aplicacion. Ese almacen todavia no esta elegido: es una decision de
 * infraestructura del cliente.
 *
 * Lo peligroso de ese estado no es no poder sellar. Es tener un stub que
 * responde "sellado" y que alguien lo crea: el informe de integridad diria que
 * el head esta anclado, nadie iria a comprobar donde, y la unica defensa contra
 * la reescritura completa del historico seria una linea de log.
 */

import { describe, expect, it } from "vitest";

import {
  CHAIN_DOMAIN_ENTRY_LEDGER,
  ChainSealStoreNotConfiguredError,
  createUnconfiguredChainHeadSealStore,
  sealChainHead,
} from "@lsw/audit";
import type { AuditActor } from "@lsw/audit";

import {
  LEDGER_PROMOTION_ID,
  buildLedgerRow,
  chainRows,
  honestChain,
} from "../helpers/ledger-chain.js";

const ACTOR: AuditActor = { type: "SYSTEM", id: "sealing-job", roles: ["SYSTEM"] };

describe("DEC-008: el almacen de sellos por defecto se niega", () => {
  const store = createUnconfiguredChainHeadSealStore();

  it("se identifica como no configurado", () => {
    expect(store.storeId).toBe("unconfigured");
  });

  it("ninguna operacion tiene exito en silencio", () => {
    // Rechaza de forma SINCRONA, igual que `createUnconfiguredTpaAdapter`. No
    // es un descuido: una promesa rechazada se puede perder -un `.catch` vacio,
    // un `void` mal puesto, un `Promise.allSettled`- y la ausencia de sello
    // pasaria por un fallo transitorio. Una excepcion sincrona no se traga.
    const operations: readonly (() => unknown)[] = [
      () =>
        store.seal({
          domain: CHAIN_DOMAIN_ENTRY_LEDGER,
          promotionId: LEDGER_PROMOTION_ID,
          headHash: "00".repeat(32),
          linkCount: 1,
          lastSequence: "1",
          canonicalizationVersion: 1,
          sealedBy: "test",
        }),
      () => store.latestSeal(CHAIN_DOMAIN_ENTRY_LEDGER, LEDGER_PROMOTION_ID),
      () => store.listSeals(CHAIN_DOMAIN_ENTRY_LEDGER, LEDGER_PROMOTION_ID),
    ];

    for (const operation of operations) {
      expect(operation).toThrow(ChainSealStoreNotConfiguredError);
    }
  });

  it("el mensaje explica QUE se pierde, no solo que falta configuracion", () => {
    // Un "no configurado" seco invita a configurarlo con lo primero que haya a
    // mano. El mensaje tiene que decir contra que protege.
    const error = new ChainSealStoreNotConfiguredError("seal");
    expect(error.message).toContain("reescritura completa");
    expect(error.message).toContain("DEC-008");
  });
});

describe("DEC-008: no se sella una cadena rota", () => {
  it("sellar exige que la cadena verifique primero", async () => {
    // Sellar una cadena manipulada fijaria la manipulacion como nuevo punto de
    // referencia y borraria la unica prueba de que hubo un antes distinto.
    const links = [...honestChain(4)];
    const target = links[1];
    if (target === undefined) {
      throw new Error("fixture");
    }
    links[1] = { ...target, row: { ...target.row, quantity_delta: 7777 } };

    await expect(
      sealChainHead({
        domain: CHAIN_DOMAIN_ENTRY_LEDGER,
        promotionId: LEDGER_PROMOTION_ID,
        links,
        sealStore: createUnconfiguredChainHeadSealStore(),
        canonicalizationVersion: 1,
        sealedBy: "sealing-job",
        occurredAt: "2026-04-01T03:00:00.000Z",
        actor: ACTOR,
      }),
    ).rejects.toThrow(/cadena presenta/u);
  });

  it("con una cadena intacta llega hasta el almacen (y es el almacen quien falta)", async () => {
    await expect(
      sealChainHead({
        domain: CHAIN_DOMAIN_ENTRY_LEDGER,
        promotionId: LEDGER_PROMOTION_ID,
        links: chainRows([buildLedgerRow(1), buildLedgerRow(2)]),
        sealStore: createUnconfiguredChainHeadSealStore(),
        canonicalizationVersion: 1,
        sealedBy: "sealing-job",
        occurredAt: "2026-04-01T03:00:00.000Z",
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ChainSealStoreNotConfiguredError);
  });
});
