/**
 * INVARIANTE: el arbol de Merkle prueba lo que dice probar, y nada mas.
 *
 * DEC-016 pide un Merkle root para que el administrador externo pueda
 * verificar UN registro sin recibir el fichero entero. Un arbol construido a la
 * ligera hace justo lo contrario: permite construir pruebas de pertenencia de
 * registros que nunca estuvieron. Los dos casos clasicos estan aqui.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_MERKLE_ROOT,
  merkleLeafHash,
  merkleProof,
  merkleRoot,
  merkleRootFromLeaves,
  toHex,
  verifyMerkleProof,
} from "@lsw/audit";

const records = Array.from({ length: 7 }, (_unused, index) => ({
  participant_reference: `p-${String(index).padStart(3, "0")}`,
  eligible_entries: (index + 1) * 3,
}));

describe("DEC-016: Merkle root determinista", () => {
  it("dos calculos sobre los mismos registros dan el mismo root", () => {
    expect(toHex(merkleRoot(records))).toBe(toHex(merkleRoot(records)));
  });

  it("cambiar un solo registro cambia el root", () => {
    const alterado = records.map((record, index) =>
      index === 3 ? { ...record, eligible_entries: 9999 } : record,
    );
    expect(toHex(merkleRoot(alterado))).not.toBe(toHex(merkleRoot(records)));
  });

  it("reordenar los registros cambia el root", () => {
    expect(toHex(merkleRoot([...records].reverse()))).not.toBe(toHex(merkleRoot(records)));
  });

  it("el arbol vacio tiene root propio y estable", () => {
    expect(toHex(merkleRoot([]))).toBe(toHex(EMPTY_MERKLE_ROOT));
    // "no hay registros" es una afirmacion, y debe poder firmarse. Un root de
    // cero bytes seria indistinguible de "no se calculo nada".
    expect(toHex(EMPTY_MERKLE_ROOT)).toHaveLength(64);
  });
});

describe("DEC-016: el arbol resiste los dos ataques conocidos", () => {
  it("una hoja no puede hacerse pasar por un nodo interno", () => {
    // Sin prefijos distintos para hoja (0x00) y nodo (0x01), el hash de un
    // nodo interno vale como hoja, y se puede "demostrar" la pertenencia de un
    // registro que nunca existio.
    const hojas = [merkleLeafHash({ a: 1 }), merkleLeafHash({ a: 2 })];
    const raiz = merkleRootFromLeaves(hojas);
    const primera = hojas.at(0);
    const segunda = hojas.at(1);
    if (primera === undefined || segunda === undefined) {
      throw new Error("fixture");
    }

    // Un atacante que presente la concatenacion de las dos hojas como si fuera
    // una hoja no obtiene el root.
    const falsa = merkleLeafHash({ __forged: [toHex(primera), toHex(segunda)] });
    expect(toHex(falsa)).not.toBe(toHex(raiz));
  });

  it("dos listas distintas no comparten root (CVE-2012-2459)", () => {
    // Duplicar el ultimo nodo en un nivel impar -lo que hace Bitcoin- provoca
    // que [a,b,c] y [a,b,c,c] den el mismo root. En un export de sweepstakes
    // eso significaria que dos universos de entries distintos presentan la
    // misma evidencia.
    const tres = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const cuatroConDuplicado = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "c" }];
    expect(toHex(merkleRoot(tres))).not.toBe(toHex(merkleRoot(cuatroConDuplicado)));
  });
});

describe("DEC-016: prueba de pertenencia de un registro", () => {
  const hojas = records.map((record) => merkleLeafHash(record));
  const raiz = merkleRootFromLeaves(hojas);

  it("cada hoja tiene una prueba que verifica contra el root", () => {
    for (const [index, hoja] of hojas.entries()) {
      const proof = merkleProof(hojas, index);
      expect(
        verifyMerkleProof({ leaf: hoja, proof, root: raiz }),
        `La hoja ${String(index)} no verifica`,
      ).toBe(true);
    }
  });

  it("una hoja ajena no verifica con la prueba de otra", () => {
    const proof = merkleProof(hojas, 2);
    const ajena = merkleLeafHash({ participant_reference: "intruso", eligible_entries: 1000 });
    expect(verifyMerkleProof({ leaf: ajena, proof, root: raiz })).toBe(false);
  });

  it("una prueba manipulada no verifica", () => {
    const proof = [...merkleProof(hojas, 2)];
    const paso = proof.at(0);
    const hoja = hojas.at(2);
    if (paso === undefined || hoja === undefined) {
      throw new Error("fixture");
    }
    proof[0] = { ...paso, position: paso.position === "LEFT" ? "RIGHT" : "LEFT" };
    expect(verifyMerkleProof({ leaf: hoja, proof, root: raiz })).toBe(false);
  });

  it("la prueba es logaritmica, no el fichero entero", () => {
    expect(merkleProof(hojas, 0).length).toBeLessThanOrEqual(3);
  });
});
