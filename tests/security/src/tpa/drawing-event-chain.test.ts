/**
 * El registro del sorteo es inmutable y encadenado (DEC-008 aplicado a DEC-017).
 *
 * ---------------------------------------------------------------------------
 * POR QUE LOS SORTEOS TIENEN CADENA PROPIA
 * ---------------------------------------------------------------------------
 *
 * Podrian haberse escrito como `AuditEvent` mas. No se hizo, y la razon es la
 * misma por la que el ledger tampoco comparte cadena: si dos clases de registro
 * conviven en una, una fila de una puede presentarse como fila de la otra. Un
 * `AuditEvent` lo escribe cualquier accion administrativa; un `DrawingEvent`
 * solo puede existir tras cinco cerrojos. Mezclarlos abarataria el segundo
 * hasta el precio del primero.
 *
 * Aqui se comprueba lo que esa separacion compra: que un registro alterado se
 * detecta, que uno de otra promocion no se puede injertar, y que el mismo
 * payload cambia de hash segun el dominio en el que se presente.
 */

import { describe, expect, it } from "vitest";

import {
  CHAIN_DOMAIN_AUDIT_EVENT,
  CHAIN_DOMAIN_DRAWING_EVENT,
  computeChainHash,
  createDrawingEventChainPort,
  fromHex,
  genesisHash,
  toHex,
  verifyDrawingEventChain,
  type CanonicalObject,
  type StoredChainLink,
} from "@lsw/audit";
import { drawingEventCanonicalPayload, initiateDraw, type DrawingEvent } from "@lsw/tpa";

import {
  approval,
  authorization,
  command,
  PROMOTION_ID,
  scenario,
  sequenceCsprng,
  SNAPSHOT_ID,
} from "../helpers/draw-fixtures.js";

function link(event: DrawingEvent, sequence: number): StoredChainLink {
  return {
    id: event.id,
    sequence: String(sequence),
    canonicalizationVersion: event.canonicalizationVersion,
    row: drawingEventCanonicalPayload(event),
    storedHash: fromHex(event.recordHash),
    storedPreviousHash:
      event.previousRecordHash === null ? null : fromHex(event.previousRecordHash),
  };
}

/** Escenario con autorizacion para dos sorteos (principal y alternate). */
function twoDrawWorld(): ReturnType<typeof scenario> {
  return scenario({
    csprng: sequenceCsprng([0x03, 0x07]),
    authorization: authorization({
      scope: {
        promotionId: PROMOTION_ID,
        snapshotId: SNAPSHOT_ID,
        maxDraws: 2,
        purpose: "Principal y un alternate, segun documento aprobado",
      },
    }),
    // Una aprobacion POR PETICION: el segundo sorteo no se cuela con la firma
    // del primero.
    approvals: [approval(), approval({ id: "approval-2", drawRequestId: "peticion-2" })],
  });
}

describe("dos sorteos de la misma promocion quedan encadenados", () => {
  it("el segundo apunta al primero, y la cadena verifica", async () => {
    const world = twoDrawWorld();

    const first = await initiateDraw(world.dependencies, command());
    const second = await initiateDraw(
      world.dependencies,
      command({
        drawRequestId: "peticion-2",
        drawingEventId: "drawing-event-2",
        potentialWinnerId: "potential-winner-2",
      }),
    );

    expect(first.drawingEvent.previousRecordHash).toBeNull();
    expect(second.drawingEvent.previousRecordHash).toBe(first.drawingEvent.recordHash);

    const verification = verifyDrawingEventChain({
      promotionId: PROMOTION_ID,
      links: [link(first.drawingEvent, 1), link(second.drawingEvent, 2)],
    });

    expect(verification.ok).toBe(true);
    expect(verification.linkCount).toBe(2);
    expect(verification.observedHeadHash).toBe(second.drawingEvent.recordHash);
  });

  it("alterar el ordinal seleccionado rompe la cadena en esa fila", async () => {
    const world = twoDrawWorld();
    const first = await initiateDraw(world.dependencies, command());
    const second = await initiateDraw(
      world.dependencies,
      command({
        drawRequestId: "peticion-2",
        drawingEventId: "drawing-event-2",
        potentialWinnerId: "potential-winner-2",
      }),
    );

    // La manipulacion que importa: cambiar quien salio, conservando el hash.
    const tampered = link(first.drawingEvent, 1);
    const forgedRow = { ...tampered.row, selected_ordinal: 17 };

    const verification = verifyDrawingEventChain({
      promotionId: PROMOTION_ID,
      links: [{ ...tampered, row: forgedRow }, link(second.drawingEvent, 2)],
    });

    expect(verification.ok).toBe(false);
    expect(verification.breaks.map((issue) => issue.kind)).toContain("HASH_MISMATCH");
    // La fila siguiente NO se marca rota: el informe distingue la manipulacion
    // de sus consecuencias.
    expect(verification.breaks).toHaveLength(1);
    expect(verification.breaks.at(0)?.linkId).toBe(first.drawingEvent.id);
  });

  it("un registro de otra promocion no se puede injertar en esta", async () => {
    const world = twoDrawWorld();
    const first = await initiateDraw(world.dependencies, command());

    const verification = verifyDrawingEventChain({
      promotionId: "otra-promocion",
      links: [link(first.drawingEvent, 1)],
    });

    expect(verification.ok).toBe(false);
    // En la PRIMERA fila el genesis es una de las entradas del hash, asi que la
    // rotura aparece como HASH_MISMATCH y el detalle nombra las dos
    // explicaciones posibles: contenido alterado, o fila de otra cadena. Desde
    // el hash no se pueden separar, y el informe no finge que si.
    expect(verification.breaks.map((issue) => issue.kind)).toStrictEqual(["HASH_MISMATCH"]);
    expect(verification.breaks.at(0)?.detail).toContain("otra promocion");
  });
});

describe("separacion de dominios", () => {
  it("el mismo payload no produce el mismo hash como sorteo y como AuditEvent", async () => {
    const world = twoDrawWorld();
    const outcome = await initiateDraw(world.dependencies, command());
    // El cast cruza la frontera entre dos paquetes que no se importan; la
    // forma canonica valida cada valor en ejecucion, asi que no oculta nada.
    const payload = drawingEventCanonicalPayload(outcome.drawingEvent) as CanonicalObject;

    const asDraw = toHex(
      computeChainHash({
        domain: CHAIN_DOMAIN_DRAWING_EVENT,
        promotionId: PROMOTION_ID,
        canonicalizationVersion: 1,
        payload,
        previousHash: null,
      }),
    );
    const asAuditEvent = toHex(
      computeChainHash({
        domain: CHAIN_DOMAIN_AUDIT_EVENT,
        promotionId: PROMOTION_ID,
        canonicalizationVersion: 1,
        payload,
        previousHash: null,
      }),
    );

    expect(asDraw).toBe(outcome.drawingEvent.recordHash);
    expect(asAuditEvent).not.toBe(asDraw);
  });

  it("cada promocion ancla en su propio genesis", () => {
    expect(toHex(genesisHash(CHAIN_DOMAIN_DRAWING_EVENT, PROMOTION_ID))).not.toBe(
      toHex(genesisHash(CHAIN_DOMAIN_DRAWING_EVENT, "otra-promocion")),
    );
    expect(toHex(genesisHash(CHAIN_DOMAIN_DRAWING_EVENT, PROMOTION_ID))).not.toBe(
      toHex(genesisHash(CHAIN_DOMAIN_AUDIT_EVENT, PROMOTION_ID)),
    );
  });

  it("el puerto declara el dominio y la version que usa", () => {
    const port = createDrawingEventChainPort();
    expect(port.domain).toBe(CHAIN_DOMAIN_DRAWING_EVENT);
    expect(port.canonicalizationVersion).toBe(1);
  });
});

describe("el almacen de sorteos es append-only", () => {
  it("no admite escribir dos veces el mismo registro", async () => {
    const world = twoDrawWorld();
    const outcome = await initiateDraw(world.dependencies, command());

    expect(() => world.drawings.append(outcome.drawingEvent)).toThrow(/append-only/u);
    expect(world.drawings.stored).toHaveLength(1);
  });
});
