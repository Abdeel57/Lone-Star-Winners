import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * EL ROJO DE ACCION, MEDIDO (DEC-042).
 *
 * Este test existe porque el rojo es el unico color del sistema que se eligio
 * por parecido con una referencia y no por contraste. El rojo de la referencia
 * (#e8232a) da 4,46:1 con texto blanco encima: se queda a cuatro centesimas del
 * minimo AA, y a ojo no hay forma de verlo. Aqui se comprueba con la misma
 * formula que usa WCAG.
 *
 * QUE SE MIDE, Y CONTRA QUE
 * -------------------------
 * Los tokens rojos se reparten en dos familias que NO son intercambiables:
 *
 *   RELLENOS (`accent`, `accent-hover`, `accent-active`) llevan texto encima,
 *   asi que se miden contra `on-accent`. Son el boton de compra y la insignia
 *   solida.
 *
 *   TINTAS (`accent-text` sobre negro, `light-accent` sobre claro) son ellas
 *   las que se leen, y se miden contra la superficie que tienen detras. Cada
 *   una existe porque la otra falla en su superficie: intercambiarlas produce
 *   un fallo que se ve perfectamente bien en la pantalla de quien lo escribio,
 *   porque estara mirando la otra banda.
 *
 * Y ademas se comprueba el reparto SEMANTICO: que `accent` no sea `danger`. Los
 * dos son rojos y significan cosas distintas -"esta es la accion principal" y
 * "esto ha fallado"-; si algun dia se colapsaran en un token, cambiar el color
 * de un mensaje de error cambiaria el de todos los botones de compra.
 *
 * (Se usa `fileURLToPath(import.meta.url)` y no `new URL(".", import.meta.url)`
 * por el motivo documentado en `no-hardcoded-copy.test.ts`: Vite reescribe ese
 * segundo patron y dentro de Vitest no se evalua como esta escrito.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const TOKENS_CSS = readFileSync(
  join(HERE, "..", "..", "..", "..", "packages", "design-system", "src", "styles", "tokens.css"),
  "utf8",
);

/**
 * Todos los tokens de color del sistema, leidos UNA vez.
 *
 * Se construye el mapa entero con una expresion literal en vez de componer una
 * por token: una `RegExp` construida a partir de una cadena no la puede revisar
 * el analizador estatico, y ademas fallaria en silencio -devolviendo `null`-
 * ante un token mal escrito, que es como un test de contraste acaba midiendo
 * negro contra negro y pasando.
 */
const COLORS = new Map<string, readonly [number, number, number]>(
  [...TOKENS_CSS.matchAll(/--lsw-color-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)].map((match) => [
    match[1] ?? "",
    [Number(match[2]), Number(match[3]), Number(match[4])] as const,
  ]),
);

/** Canales RGB de un token de color, tal como se declaran en `tokens.css`. */
function channelsOf(token: string): readonly [number, number, number] {
  const channels = COLORS.get(token);

  expect(channels, `falta el token --lsw-color-${token} en tokens.css`).toBeDefined();

  return channels ?? [0, 0, 0];
}

/** Luminancia relativa segun WCAG 2.1. */
function luminance(token: string): number {
  const linear = channelsOf(token).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/** Razon de contraste entre dos tokens, redondeada a dos decimales. */
function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

  return Math.round(ratio * 100) / 100;
}

/** Minimo AA para texto normal. */
const AA_TEXT = 4.5;

/** Minimo de WCAG 1.4.11 para partes graficas y contornos de control. */
const AA_NON_TEXT = 3;

describe("rellenos rojos: el texto de encima cumple AA", () => {
  for (const fill of ["accent", "accent-hover", "accent-active"] as const) {
    it(`${fill} lleva on-accent con al menos ${String(AA_TEXT)}:1`, () => {
      expect(contrast(fill, "on-accent")).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  it("on-accent es blanco puro, no el blanco calido del texto", () => {
    // Sobre un rojo saturado el blanco calido tira a rosa. Es la unica
    // superficie del sistema donde el texto va en blanco puro.
    expect(channelsOf("on-accent")).toEqual([255, 255, 255]);
  });

  it("el hover ACLARA respecto del relleno base", () => {
    // Sobre fondo oscuro, oscurecer al pasar el raton se lee como desactivar.
    expect(luminance("accent-hover")).toBeGreaterThan(luminance("accent"));
  });

  it("el pulsado oscurece, y esa excepcion tiene una razon medible", () => {
    // Por arriba no queda margen: un pulsado mas claro que `accent-hover`
    // bajaria del minimo AA con el texto blanco de encima. Este test es la
    // prueba de que no es una inconsistencia sino un techo.
    expect(luminance("accent-active")).toBeLessThan(luminance("accent"));
    expect(contrast("accent-hover", "on-accent")).toBeLessThan(
      contrast("accent", "on-accent") + 0.001,
    );
  });
});

describe("tintas rojas: cada superficie usa la suya", () => {
  it("accent-text se lee sobre las cuatro superficies oscuras", () => {
    for (const surface of ["bg", "surface", "surface-raised", "surface-sunken"] as const) {
      expect(contrast("accent-text", surface), surface).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("accent-text se lee sobre el lavado de la insignia discreta", () => {
    expect(contrast("accent-text", "accent-subtle")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("light-accent se lee sobre la banda clara y sobre la tarjeta blanca", () => {
    for (const surface of ["light-bg", "light-surface", "light-surface-sunken"] as const) {
      expect(contrast("light-accent", surface), surface).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("y ninguna de las dos vale en la superficie de la otra", () => {
    // Esta es la razon de que existan dos tokens y no uno. Si algun dia una de
    // las dos empezara a cumplir en las dos bandas, el sistema habria perdido
    // saturacion en el camino y conviene enterarse.
    expect(contrast("accent-text", "light-bg")).toBeLessThan(AA_TEXT);
    expect(contrast("light-accent", "bg")).toBeLessThan(AA_TEXT);
  });
});

describe("el rojo como parte grafica", () => {
  it("el relleno se distingue de la pagina y del carril de la barra", () => {
    // El cuerpo del boton contra el fondo, y el relleno de la barra de progreso
    // contra su carril (`surface-sunken`). WCAG 1.4.11 pide 3:1 a las dos.
    expect(contrast("accent", "bg")).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast("accent", "surface-sunken")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("el anillo de foco se distingue del relleno rojo que rodea", () => {
    // El boton de compra conserva el anillo del sistema. Su borde interior -oro
    // de foco contra el rojo del boton- no depende de la superficie sobre la
    // que se apoye el boton, y es lo que hace que el foco siga siendo visible
    // tambien sobre banda clara.
    expect(contrast("focus", "accent")).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("el rojo de accion no es el rojo de error", () => {
  it("accent y danger son tokens distintos", () => {
    expect(channelsOf("accent")).not.toEqual(channelsOf("danger"));
    expect(channelsOf("accent-text")).not.toEqual(channelsOf("danger"));
  });

  it("la barra de progreso se raya con el rojo de accion, no con el de marca", () => {
    // DEC-042 la pasa de oro a rojo. Lo que la barra REPRESENTA no cambia -el
    // tramo transcurrido del periodo- y sigue sin acelerar ni cambiar de color
    // al acercarse al final: eso lo garantiza `promotion-progress.tsx`.
    const stripes = /--lsw-pattern-stripes:[\s\S]*?\);/.exec(TOKENS_CSS)?.[0] ?? "";

    expect(stripes).toContain("--lsw-color-accent");
    expect(stripes).not.toContain("--lsw-color-brand");
  });
});
