/**
 * INVARIANTE: la escritura de `audit_events` produce una cadena verificable, y
 * dos escritores concurrentes no la bifurcan.
 *
 * ---------------------------------------------------------------------------
 * LOS TRES FALLOS QUE ESTE FICHERO EXISTE PARA IMPEDIR
 * ---------------------------------------------------------------------------
 *
 * 1. QUE LA CADENA NAZCA ROTA. El escritor hashea unos valores y guarda otros
 *    -un instante con otra precision, un campo olvidado- y la cadena no
 *    verifica desde el primer dia. Se detecta escribiendo por el camino real y
 *    verificando con el verificador real.
 *
 * 2. QUE UNA MANIPULACION PASE DESAPERCIBIDA. Alguien cambia un campo de una
 *    fila. La cadena tiene que decirlo, decir CUAL, y no acusar a las
 *    siguientes: un informe que dice "roto desde marzo" cuando hay UNA fila
 *    tocada no sirve para investigar nada.
 *
 * 3. QUE DOS ESCRITORES CONCURRENTES BIFURQUEN. Es el fallo caracteristico de
 *    una hash chain con concurrencia, y el unico de los tres que no se ve
 *    nunca en desarrollo: aparece en produccion, bajo carga, y deja evidencia
 *    rota sin que haya habido manipulacion.
 */

import {
  AUDIT_CHAIN_GLOBAL_KEY,
  CHAIN_DOMAIN_AUDIT_EVENT,
  auditChainKey,
  createAuditEventChainPort,
  verifyChain,
} from "@lsw/audit";
import { describe, expect, it } from "vitest";

import {
  AUDIT_TEST_PROMOTION_ID,
  ChainForkRejectedError,
  InMemoryAuditChainStore,
  buildAuditFields,
} from "../helpers/audit-chain.js";

const OTHER_PROMOTION_ID = "00000000-0000-4000-8000-00000000bbbb";

function verify(store: InMemoryAuditChainStore, chainKey: string): ReturnType<typeof verifyChain> {
  return verifyChain({
    domain: CHAIN_DOMAIN_AUDIT_EVENT,
    promotionId: chainKey,
    links: store.links(chainKey),
  });
}

describe("DEC-008: la escritura encadena", () => {
  it("tres eventos producen una cadena que verifica", async () => {
    const store = new InMemoryAuditChainStore();
    for (let index = 0; index < 3; index += 1) {
      await store.append(buildAuditFields(index));
    }

    const result = verify(store, AUDIT_TEST_PROMOTION_ID);
    expect(result.breaks).toStrictEqual([]);
    expect(result.ok).toBe(true);
    expect(result.linkCount).toBe(3);
    expect(result.observedHeadHash).not.toBeNull();
  });

  it("cada eslabon declara como antecesor el hash del anterior", async () => {
    const store = new InMemoryAuditChainStore();
    const appended = [];
    for (let index = 0; index < 3; index += 1) {
      appended.push(await store.append(buildAuditFields(index)));
    }

    expect(appended[1]?.chainPrevHashHex).toBe(appended[0]?.chainHashHex);
    expect(appended[2]?.chainPrevHashHex).toBe(appended[1]?.chainHashHex);
  });

  it("la primera fila ancla en el genesis de SU cadena, no en ceros", async () => {
    const store = new InMemoryAuditChainStore();
    const first = await store.append(buildAuditFields(0));

    const genesis = createAuditEventChainPort().genesisHashHex(AUDIT_TEST_PROMOTION_ID);
    expect(first.chainPrevHashHex).toBe(genesis);
    expect(first.chainPrevHashHex).not.toBe("0".repeat(64));

    // El genesis de otra promocion es DISTINTO: por eso una fila de una cadena
    // no puede presentarse como primera fila de otra.
    expect(createAuditEventChainPort().genesisHashHex(OTHER_PROMOTION_ID)).not.toBe(genesis);
  });

  it("los hechos sin promocion van a la cadena global, y es una cadena aparte", async () => {
    const store = new InMemoryAuditChainStore();
    await store.append(buildAuditFields(0));
    await store.append(
      buildAuditFields(1, {
        promotionId: null,
        action: "rbac.role_assigned",
        targetEntityType: "AdminUser",
      }),
    );

    expect(auditChainKey(null)).toBe(AUDIT_CHAIN_GLOBAL_KEY);
    expect(store.listChainKeys()).toStrictEqual(
      [AUDIT_TEST_PROMOTION_ID, AUDIT_CHAIN_GLOBAL_KEY].sort(),
    );
    expect(verify(store, AUDIT_CHAIN_GLOBAL_KEY).ok).toBe(true);
    expect(verify(store, AUDIT_TEST_PROMOTION_ID).ok).toBe(true);

    // Cada una tiene UN eslabon: no se mezclaron.
    expect(verify(store, AUDIT_CHAIN_GLOBAL_KEY).linkCount).toBe(1);
    expect(verify(store, AUDIT_TEST_PROMOTION_ID).linkCount).toBe(1);
  });

  it("un instante sin normalizar se rechaza en vez de normalizarse en silencio", async () => {
    const store = new InMemoryAuditChainStore();
    await expect(
      store.append(buildAuditFields(0, { occurredAt: "2026-03-01T12:00:00Z" })),
    ).rejects.toThrow(/milisegundos exactos/u);
  });
});

describe("DEC-008: una fila alterada deja de cuadrar", () => {
  it("la manipulacion se detecta y se localiza en la fila tocada", async () => {
    const store = new InMemoryAuditChainStore();
    for (let index = 0; index < 4; index += 1) {
      await store.append(buildAuditFields(index));
    }
    expect(verify(store, AUDIT_TEST_PROMOTION_ID).ok).toBe(true);

    // El escenario real: alguien cambia a quien se atribuye una aprobacion.
    store.tamperWith(AUDIT_TEST_PROMOTION_ID, 1, {
      actorId: "00000000-0000-4000-8000-0000000affff",
    });

    const result = verify(store, AUDIT_TEST_PROMOTION_ID);
    expect(result.ok).toBe(false);

    const mismatches = result.breaks.filter((entry) => entry.kind === "HASH_MISMATCH");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.index).toBe(1);

    // Y NO acusa a las siguientes: su encadenamiento sigue intacto, porque el
    // `chain_hash` guardado de la fila tocada no cambio. Distinguir la
    // manipulacion de sus consecuencias es lo que hace util al informe.
    expect(result.breaks.filter((entry) => entry.kind === "LINK_BROKEN")).toStrictEqual([]);
  });

  it("cambiar el motivo tambien rompe el hash: el payload cubre los 18 campos", async () => {
    const store = new InMemoryAuditChainStore();
    await store.append(buildAuditFields(0));
    store.tamperWith(AUDIT_TEST_PROMOTION_ID, 0, { reasonCode: "OTRO_MOTIVO" });

    expect(verify(store, AUDIT_TEST_PROMOTION_ID).ok).toBe(false);
  });
});

describe("DEC-009 sobre DEC-008: dos escritores concurrentes no bifurcan", () => {
  it("con cerrojo, los dos escriben y la cadena queda lineal", async () => {
    const store = new InMemoryAuditChainStore({ useLock: true });

    // Se lanzan SIN await intermedio: es el caso real de dos peticiones
    // administrativas simultaneas sobre la misma promocion.
    const [first, second] = await Promise.all([
      store.append(buildAuditFields(1)),
      store.append(buildAuditFields(2)),
    ]);

    const result = verify(store, AUDIT_TEST_PROMOTION_ID);
    expect(result.ok).toBe(true);
    expect(result.linkCount).toBe(2);

    // Uno de los dos ancla en el genesis y el otro en el primero. Cual de ellos
    // gane la carrera es indiferente; que no haya DOS anclados en lo mismo, no.
    const previous = [first.chainPrevHashHex, second.chainPrevHashHex];
    expect(new Set(previous).size).toBe(2);
  });

  it("sin cerrojo, el segundo escritor es RECHAZADO por la restriccion unica", async () => {
    const store = new InMemoryAuditChainStore({ useLock: false });

    const results = await Promise.allSettled([
      store.append(buildAuditFields(1)),
      store.append(buildAuditFields(2)),
    ]);

    const rejected = results.filter((entry) => entry.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ChainForkRejectedError);

    // Lo que importa: la cadena NO se bifurco. El cerrojo evita el error; la
    // restriccion unica evita la bifurcacion. Son capas distintas y hacen
    // falta las dos.
    const result = verify(store, AUDIT_TEST_PROMOTION_ID);
    expect(result.ok).toBe(true);
    expect(result.linkCount).toBe(1);
  });

  it("dos promociones distintas no se estorban: el cerrojo es por cadena", async () => {
    const store = new InMemoryAuditChainStore({ useLock: true });

    await Promise.all([
      store.append(buildAuditFields(1)),
      store.append(buildAuditFields(2, { promotionId: OTHER_PROMOTION_ID })),
    ]);

    expect(verify(store, AUDIT_TEST_PROMOTION_ID).linkCount).toBe(1);
    expect(verify(store, OTHER_PROMOTION_ID).linkCount).toBe(1);
    expect(verify(store, AUDIT_TEST_PROMOTION_ID).ok).toBe(true);
    expect(verify(store, OTHER_PROMOTION_ID).ok).toBe(true);
  });
});
