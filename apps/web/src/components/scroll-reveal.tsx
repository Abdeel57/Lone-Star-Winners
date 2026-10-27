"use client";

import { useEffect } from "react";

import { usePathname } from "@/i18n/navigation";

/** Lo que dura la entrada en `globals.css`, con un margen. */
const REVEAL_MS = 800;

/**
 * Aparicion al desplazarse (DEC-075).
 *
 * Busca los nodos con `data-reveal` y, de los que estan POR DEBAJO de la
 * primera pantalla, los marca `data-reveal-state="hidden"`; al entrar en vista
 * pasan a "shown" y `globals.css` los hace aparecer (opacidad y un
 * desplazamiento corto). Lo que ya se ve al cargar no se toca: nunca se oculta
 * contenido que el visitante tiene delante, y sin JavaScript todo esta visible.
 *
 * Con `prefers-reduced-motion` no hace nada. Se vuelve a ejecutar en cada cambio
 * de ruta: las paginas nuevas traen nodos nuevos.
 *
 * No pinta nada: es un efecto.
 */
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window.IntersectionObserver !== "function") return undefined;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }

    /*
     * "shown" anima la entrada; al terminar pasa a "done", que no lleva ningun
     * estilo. Asi la transicion de la entrada no se queda pegada al nodo y
     * pisando la suya propia -el levantarse al pasar el raton de una tarjeta
     * tiene que seguir siendo rapido-.
     */
    const show = (element: HTMLElement) => {
      element.dataset.revealState = "shown";
      const delay = Number.parseFloat(getComputedStyle(element).getPropertyValue("--reveal-delay"));
      window.setTimeout(
        () => {
          if (element.dataset.revealState === "shown") element.dataset.revealState = "done";
        },
        (Number.isFinite(delay) ? delay : 0) + REVEAL_MS,
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );

    const fold = window.innerHeight * 0.92;
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-reveal]:not([data-reveal-state])",
    )) {
      if (element.getBoundingClientRect().top < fold) {
        // Ya a la vista al cargar: no se oculta ni se anima.
        element.dataset.revealState = "done";
        continue;
      }
      element.dataset.revealState = "hidden";
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
