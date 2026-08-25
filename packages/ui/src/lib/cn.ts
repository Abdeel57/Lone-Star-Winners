import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` configurado con la escala del design system.
 *
 * Sin esto habria un fallo silencioso y dificil de ver: `tailwind-merge`
 * conoce la escala POR DEFECTO de Tailwind, no la nuestra. Ante
 * `text-body-sm text-text-muted` no reconoceria `body-sm` como tamano de
 * fuente, lo clasificaria como color de texto y descartaria uno de los dos.
 * Declarar aqui los nombres propios es lo que mantiene tamano y color como
 * grupos distintos.
 *
 * Si se anade un paso a la escala tipografica o un radio nuevo en
 * `@lsw/design-system`, hay que anadirlo tambien aqui.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-lg",
            "display-md",
            "heading-lg",
            "heading-md",
            "heading-sm",
            "body-lg",
            "body-md",
            "body-sm",
            "label",
            "caption",
            "overline",
          ],
        },
      ],
      rounded: [{ rounded: ["pill"] }],
      "font-weight": [{ font: ["regular", "medium", "semibold", "bold"] }],
    },
  },
});

/**
 * Une clases condicionales y resuelve conflictos de Tailwind dejando ganar a la
 * ultima. Permite que un consumidor sobrescriba una clase del componente sin
 * recurrir a `!important` ni a especificidad.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
