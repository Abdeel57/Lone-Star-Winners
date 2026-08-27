/**
 * INVARIANTE: el verificador de las cadenas de auditoria dice la verdad, y la
 * dice completa.
 *
 * ---------------------------------------------------------------------------
 * LO QUE SE COMPRUEBA AQUI, Y POR QUE CADA COSA
 * ---------------------------------------------------------------------------
 *
 * 1. SIN SELLO EXTERNO, EL VEREDICTO NO ES `INTACT` (DEC-037). Es la pieza mas
 *    facil de aflojar del sistema entero: basta que alguien decida que
 *    `UNSEALED` "es ruido" y lo mapee a verde. Ese dia la unica defensa contra
 *    una reescritura completa y coherente deja de existir, y nadie se entera,
 *    porque el informe se pone bonito.
 *
 * 2. EL VEREDICTO DEL CONJUNTO ES EL PEOR DE LOS INDIVIDUALES. Una cadena
 *    comprometida entre veinte sanas no es "un 95% bien".
 *
 * 3. LA COMPROBACION SE REGISTRA. Si no dejara rastro, quien tiene acceso
 *    podria ejecutar el verificador, ver que le ha pillado, y no dejar
 *    constancia de haberlo ejecutado.
 *
 * 4. SI EL REGISTRO NO SE PUEDE ESCRIBIR, EL JOB FALLA. Un verificador que
 *    informa "todo bien" sin haber podido dejar constancia no ha verificado
 *    nada comprobable.
 */

import {
  AUDIT_ACTIONS,
  AUDIT_CHAIN_GLOBAL_KEY,
  CHAIN_DOMAIN_AUDIT_EVENT,
  createUnconfiguredChainHeadSealStore,
  verifyAuditChains,
} from "@lsw/audit";
import type { AuditActor, AuditEventDraft, ChainIntegrityJobPort } from "@lsw/audit";
import { describe, expect, it } from "vitest";

import {
  AUDIT_TEST_PROMOTION_ID,
  InMemoryAuditChainStore,
  buildAuditFields,
} from "../helpers/audit-chain.js";

const OCCURRED_AT = "2026-03-02T09:00:00.000Z";

const SYSTEM_ACTOR: AuditActor = { type: "SYSTEM", id: null, roles: [] };

function portFor(store: InMemoryAuditChainStore): ChainIntegrityJobPort {
  return {
    listPromotionIds: (domain) => {
      expect(domain).toBe(CHAIN_DOMAIN_AUDIT_EVENT);
      return Promise.resolve(store.listChainKeys());
    },
    loadLinks: (_domain, chainKey) => Promise.resolve(store.links(chainKey)),
  };
}

async function storeWithTwoChains(): Promise<InMemoryAuditChainStore> {
  const store = new InMemoryAuditChainStore();
  await store.append(buildAuditFields(0));
  await store.append(buildAuditFields(1));
  await store.append(
    buildAuditFields(2, {
      promotionId: null,
      action: "rbac.role_assigned",
      targetEntityType: "AdminUser",
    }),
  );
  return store;
}

describe("DEC-037: sin sello externo el veredicto es UNSEALED, nunca INTACT", () => {
  it("una cadena intacta y sin sellar NO aprueba", async () => {
    const store = await storeWithTwoChains();

    const result = await verifyAuditChains({
      port: portFor(store),
      sealStore: createUnconfiguredChainHeadSealStore(),
      occurredAt: OCCURRED_AT,
      actor: SYSTEM_ACTOR,
    });

    expect(result.verdict).toBe("UNSEALED");
    expect(result.checkedChainCount).toBe(2);
    expect([...result.unsealedChainKeys].sort()).toStrictEqual(
      [AUDIT_TEST_PROMOTION_ID, AUDIT_CHAIN_GLOBAL_KEY].sort(),
    );
    expect(result.compromisedChainKeys).toStrictEqual([]);

    // Y las cadenas SI son consistentes consigo mismas. El veredicto no dice
    // que esten rotas: dice que la consistencia interna no basta.
    for (const report of result.reports) {
      expect(report.chain.ok).toBe(true);
    }
  });

  it("el almacen de sellos que se niega se trata como 'sin sello', no como fallo", async () => {
    const store = await storeWithTwoChains();
    const sealStore = createUnconfiguredChainHeadSealStore();

    // El almacen por defecto LANZA de forma sincrona. Que el job siga adelante
    // no es tragarse un error: es la unica forma de seguir comprobando lo que
    // si se puede comprobar hoy, y el veredicto lo declara.
    expect(() => sealStore.latestSeal(CHAIN_DOMAIN_AUDIT_EVENT, "x")).toThrow(
      /almacen write-once/u,
    );

    await expect(
      verifyAuditChains({
        port: portFor(store),
        sealStore,
        occurredAt: OCCURRED_AT,
        actor: SYSTEM_ACTOR,
      }),
    ).resolves.toMatchObject({ verdict: "UNSEALED" });
  });
});

describe("el veredicto del conjunto es el peor de los individuales", () => {
  it("una cadena manipulada compromete el informe entero", async () => {
    const store = await storeWithTwoChains();
    store.tamperWith(AUDIT_TEST_PROMOTION_ID, 0, { reasonText: "reescrito" });

    const result = await verifyAuditChains({
      port: portFor(store),
      sealStore: createUnconfiguredChainHeadSealStore(),
      occurredAt: OCCURRED_AT,
      actor: SYSTEM_ACTOR,
    });

    expect(result.verdict).toBe("COMPROMISED");
    expect(result.compromisedChainKeys).toStrictEqual([AUDIT_TEST_PROMOTION_ID]);

    // La cadena global sigue sana, y el informe lo dice fila a fila. Un
    // veredicto global comprometido no debe borrar el detalle.
    const globalReport = result.reports.find(
      (report) => report.promotionId === AUDIT_CHAIN_GLOBAL_KEY,
    );
    expect(globalReport?.verdict).toBe("UNSEALED");
  });
});

describe("la comprobacion se registra como hecho auditable", () => {
  it("emite INTEGRITY_CHECK por cadena, con la clave en target_entity_id", async () => {
    const store = await storeWithTwoChains();
    const recorded: AuditEventDraft[] = [];

    const result = await verifyAuditChains({
      port: portFor(store),
      sealStore: createUnconfiguredChainHeadSealStore(),
      occurredAt: OCCURRED_AT,
      actor: SYSTEM_ACTOR,
      recordEvent: (event) => {
        recorded.push(event);
        return Promise.resolve();
      },
    });

    expect(recorded).toHaveLength(2);
    expect(result.events).toStrictEqual(recorded);

    for (const event of recorded) {
      expect(event.action).toBe(AUDIT_ACTIONS.INTEGRITY_CHECK);
      expect(event.occurredAt).toBe(OCCURRED_AT);
      expect(event.targetEntityType).toBe(CHAIN_DOMAIN_AUDIT_EVENT);
      expect(event.metadata).toMatchObject({ verdict: "UNSEALED" });
    }

    // La cadena `global` no tiene promocion: `promotion_id` es NULL y la clave
    // viaja en `target_entity_id`. Escribir la cadena 'global' en una columna
    // `uuid` reventaria el INSERT; inventarse una promocion seria peor.
    const globalEvent = recorded.find((event) => event.targetEntityId === AUDIT_CHAIN_GLOBAL_KEY);
    expect(globalEvent).toBeDefined();
    expect(globalEvent?.promotionId).toBeNull();

    const promotionEvent = recorded.find(
      (event) => event.targetEntityId === AUDIT_TEST_PROMOTION_ID,
    );
    expect(promotionEvent?.promotionId).toBe(AUDIT_TEST_PROMOTION_ID);
  });

  it("una cadena comprometida emite INTEGRITY_FAILURE, que es otra accion", async () => {
    const store = await storeWithTwoChains();
    store.tamperWith(AUDIT_TEST_PROMOTION_ID, 1, { actorId: null, actorType: "SYSTEM" });

    const result = await verifyAuditChains({
      port: portFor(store),
      sealStore: createUnconfiguredChainHeadSealStore(),
      occurredAt: OCCURRED_AT,
      actor: SYSTEM_ACTOR,
    });

    const failure = result.events.find((event) => event.targetEntityId === AUDIT_TEST_PROMOTION_ID);
    expect(failure?.action).toBe(AUDIT_ACTIONS.INTEGRITY_FAILURE);
    expect(failure?.metadata).toMatchObject({ verdict: "COMPROMISED" });
  });

  it("si el registro no se puede escribir, el job FALLA", async () => {
    const store = await storeWithTwoChains();

    await expect(
      verifyAuditChains({
        port: portFor(store),
        sealStore: createUnconfiguredChainHeadSealStore(),
        occurredAt: OCCURRED_AT,
        actor: SYSTEM_ACTOR,
        recordEvent: () => Promise.reject(new Error("base de datos caida")),
      }),
    ).rejects.toThrow(/base de datos caida/u);
  });
});
