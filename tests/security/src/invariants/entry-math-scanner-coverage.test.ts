/**
 * EL ESCANER `no-client-entry-math` TIENE QUE CONOCER LOS CAMPOS NUEVOS (R13).
 *
 * EL PROBLEMA QUE ESTA RED RESUELVE
 * ---------------------------------
 * `apps/web/src/test/no-client-entry-math.test.ts` impide que el frontend
 * derive una cifra de participaciones, y lo hace comparando el fuente contra
 * una LISTA EXPLICITA de nombres de campo (`ENTRY_FIELDS`). Esa lista es su
 * fuerza -es deliberada, no adivina- y tambien su punto ciego: un campo del
 * contrato que no este en la lista se puede multiplicar en el cliente sin que
 * el escaner diga nada, y el escaner seguira en verde. Verde por ausencia,
 * otra vez.
 *
 * La seccion 13.4 anade exactamente ese riesgo. `entry_offer` publica DOS
 * cifras por variante -`base_entries` (sin multiplicador) y `entries_now` (con
 * los bonus vigentes)- precisamente para que la ficha del producto no tenga que
 * calcular nada. La tentacion evidente es `base_entries * multiplier`, o
 * `base_entries * quantity` en el selector de cantidad. Las dos darian hoy el
 * mismo numero que el backend y dejarian de darlo en cuanto haya un tope, una
 * caducidad o un bonus con ambito.
 *
 * POR QUE VIVE AQUI Y NO EN `apps/web`
 * ------------------------------------
 * El escaner es de `frontend` (`docs/TASK_OWNERSHIP.md`) y `security` no edita
 * su codigo. Lo que si puede hacer -y es su papel de auditor transversal- es
 * comprobar desde fuera que la red del otro cubre lo que el contrato publica, y
 * convertir "habria que ampliarlo" en un fallo con nombre y apellidos en vez de
 * en una nota de un informe que nadie relee.
 */

import { describe, expect, it } from "vitest";

import { readRepoFile, repoPathExists } from "../helpers/repo.js";

const SCANNER_PATH = "apps/web/src/test/no-client-entry-math.test.ts";

/**
 * Campos de cifra de participaciones que publica el contrato y que el escaner
 * debe vigilar.
 *
 * Los dos primeros son los de la seccion 13.4 (HO-041); el resto ya estaban y se
 * repiten aqui para que quitar uno de la lista del escaner tambien falle.
 */
const CONTRACT_ENTRY_FIELDS: readonly string[] = [
  // Seccion 13.4, `entry_offer` por variante.
  "base_entries",
  "entries_now",
  // Los que ya vigilaba (secciones 5, 6, 11.3 y 11.4).
  "active_entries",
  "purchase_entries",
  "amoe_entries",
  "entries_before_caps",
  "final_entries",
  "entries_granted",
  "quantity_delta",
  "entries_after",
  "entries_before",
  "entries_awarded",
  "entries_if_approved",
  "entries_after_if_approved",
  "proposed_delta",
];

describe("la red del frontend contra la aritmetica de participaciones sigue existiendo", () => {
  it("el escaner esta en su sitio", () => {
    expect(
      repoPathExists(SCANNER_PATH),
      `${SCANNER_PATH} ha desaparecido. Es la unica red que impide que el escaparate ` +
        "calcule participaciones por su cuenta (R13, DEC-023).",
    ).toBe(true);
  });

  it("sigue prohibiendo agregar el ledger con `reduce`", () => {
    const source = readRepoFile(SCANNER_PATH);
    expect(source).toContain("reduce");
  });
});

describe("HO-041: el escaner conoce las dos cifras nuevas de `entry_offer`", () => {
  it("`ENTRY_FIELDS` cubre todos los campos de participaciones del contrato", () => {
    const source = readRepoFile(SCANNER_PATH);

    /*
     * Se busca el nombre entrecomillado, que es como aparece en la lista, y no
     * el nombre suelto: el fichero habla de estos campos tambien en su prosa, y
     * una cita en un comentario no protege nada.
     */
    const missing = CONTRACT_ENTRY_FIELDS.filter(
      (field) => !source.includes(`"${field}"`) && !source.includes(`'${field}'`),
    );

    expect(
      missing,
      "El escaner `no-client-entry-math` NO vigila estos campos del contrato:\n" +
        missing.join("\n") +
        "\n\nSon cifras de participaciones que el backend calcula (seccion 13.4: " +
        "`entry_offer.base_entries` y `entry_offer.entries_now`). Sin ellos en " +
        "`ENTRY_FIELDS`, la ficha de un paquete podria escribir " +
        "`base_entries * multiplicador` y el escaner pasaria en verde. " +
        "Peticion cruzada a `frontend` en HO-041.",
    ).toStrictEqual([]);
  });
});
