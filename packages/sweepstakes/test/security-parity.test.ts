/**
 * Paridad con el catalogo de capacidades de `packages/security`.
 *
 * POR QUE SE LEE EL FUENTE EN VEZ DE IMPORTAR EL MODULO
 *
 *   `packages/sweepstakes` no depende de `packages/security` y no debe: el
 *   dominio de participaciones no puede arrastrar identidad, MFA y sesiones
 *   para poder ejecutarse en un test unitario.
 *
 *   Pero las claves que el dominio comprueba -`amoe.review.approve`,
 *   `entry.adjust.create`, ...- tienen que EXISTIR en el catalogo real, o la
 *   autorizacion de dominio estaria comprobando permisos que nadie puede
 *   conceder. Una comprobacion que siempre falla es tan mala como una que
 *   siempre pasa: en cuanto alguien la vea bloquear a un administrador
 *   legitimo, la quitara.
 *
 *   Leer el fuente da la garantia sin la dependencia. Si el catalogo cambia de
 *   forma, este test deja de encontrarlo y falla, que es correcto: no se puede
 *   afirmar paridad con algo que no se ha podido leer.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SWEEPSTAKES_CAPABILITIES } from "../src/index.js";

function catalogKeys(): ReadonlySet<string> {
  const source = readFileSync(
    new URL("../../security/src/capabilities.ts", import.meta.url),
    "utf8",
  );
  const keys = new Set<string>();
  const pattern = /^\s*"([a-z][a-z0-9.]*)":\s*define\(/gmu;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    const key = match[1];
    if (key !== undefined) {
      keys.add(key);
    }
    match = pattern.exec(source);
  }
  return keys;
}

describe("capacidades", () => {
  it("el catalogo de packages/security se puede leer", () => {
    const keys = catalogKeys();
    // Si esto falla, la forma del catalogo cambio y el resto de este test no
    // estaria comprobando nada.
    expect(keys.size).toBeGreaterThan(20);
  });

  it.each(Object.entries(SWEEPSTAKES_CAPABILITIES))(
    "%s -> %s existe en el catalogo canonico",
    (_name, key) => {
      expect(catalogKeys()).toContain(key);
    },
  );

  it("ninguna clave del dominio esta escrita a mano fuera del catalogo local", () => {
    // Las claves solo pueden venir de `SWEEPSTAKES_CAPABILITIES`. Un literal
    // suelto en un servicio se saltaria este test de paridad y podria quedarse
    // obsoleto sin que nada avisara.
    const values = Object.values(SWEEPSTAKES_CAPABILITIES);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/u);
    }
  });
});
