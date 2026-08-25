// ---------------------------------------------------------------------------
// apps/web - Tailwind.
//
// La app NO define escala visual: la hereda del preset de @lsw/design-system,
// que a su vez solo apunta a las custom properties de `tokens.css`. Si aqui
// apareciera un color literal, seria un error de arquitectura, no una excepcion.
// ---------------------------------------------------------------------------

import preset from "@lsw/design-system/tailwind-preset";

/** @type {import("tailwindcss").Config} */
export default {
  presets: [preset],
  content: [
    "./src/**/*.{ts,tsx,mdx}",
    // Las primitivas viven en otro paquete del workspace: si no se escanean,
    // Tailwind purga las clases que solo ellas usan.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};
