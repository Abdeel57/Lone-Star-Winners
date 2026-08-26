// Matchers de accesibilidad y DOM (`toBeInTheDocument`, `toHaveAccessibleName`,
// `toHaveAttribute`, ...). El import con sufijo `/vitest` ademas registra los
// tipos en el `Assertion` de Vitest.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Relleno de APIs de navegador que jsdom no implementa.
 *
 * Radix usa `ResizeObserver`, `matchMedia` y la API de captura de puntero para
 * medir superficies y gestionar gestos. jsdom no trae ninguna de las tres, y sin
 * ellas los componentes que dependen de Radix (`Modal`, `Drawer`, `Tabs`,
 * `Toast`) fallan en el montaje con un `TypeError` que no dice nada del
 * componente que se estaba probando.
 *
 * Esto NO es simular el comportamiento: son APIs de medida y de gestos. Lo que
 * los tests comprueban -roles, nombres accesibles, teclado, foco- no depende de
 * lo que estas devuelvan.
 */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {
      /* medida: irrelevante en jsdom */
    }
    unobserve(): void {
      /* medida: irrelevante en jsdom */
    }
    disconnect(): void {
      /* medida: irrelevante en jsdom */
    }
  };
}

if (!("matchMedia" in globalThis.window)) {
  Object.defineProperty(globalThis.window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// El prototipo se indexa a traves de un `Record` porque los tipos del DOM
// declaran estos metodos como siempre presentes: con `in`, TypeScript estrecha
// la rama negativa a `never` y la asignacion deja de compilar. En jsdom no
// existen de verdad, que es justo lo que este bloque arregla.
const elementPrototype = Element.prototype as unknown as Record<string, unknown>;

if (typeof elementPrototype.hasPointerCapture !== "function") {
  elementPrototype.hasPointerCapture = () => false;
  elementPrototype.setPointerCapture = () => undefined;
  elementPrototype.releasePointerCapture = () => undefined;
}

if (typeof elementPrototype.scrollIntoView !== "function") {
  elementPrototype.scrollIntoView = () => undefined;
}

afterEach(() => {
  cleanup();
});
