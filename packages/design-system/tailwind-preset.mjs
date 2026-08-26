// ---------------------------------------------------------------------------
// Lone Star Winners - preset de Tailwind (@lsw/design-system/tailwind-preset)
//
// El preset NO define valores de TEMA: los toma de las custom properties
// declaradas en `src/styles/tokens.css`. Consecuencia deliberada: cambiar el
// tema (claro, oscuro, o un tema de marca futuro) no recompila Tailwind, porque
// las clases generadas apuntan a variables, no a colores literales.
//
// La unica excepcion es el PATRON TOPOGRAFICO del final del archivo, y no es
// una grieta en esa regla: no es un valor de tema sino un asset decorativo
// derivado -tres tintas del mismo mosaico- que CSS no sabe componer a partir de
// fragmentos. Ver el bloque `--- Patron topografico ---`.
//
// Este archivo es JavaScript plano a proposito. La configuracion de Tailwind la
// carga el propio Tailwind con su resolvedor, fuera del pipeline de TypeScript
// del monorepo; mantenerlo en `.mjs` evita depender de como jiti resuelva un
// `.ts` a traves del campo `exports` de un paquete del workspace.
// ---------------------------------------------------------------------------

import plugin from "tailwindcss/plugin";

/**
 * Envuelve un token de color declarado como canales RGB para que Tailwind pueda
 * aplicarle modificadores de opacidad (`bg-brand/10`).
 *
 * @param {string} variable nombre de la custom property (sin `var(...)`)
 * @returns {string}
 */
const color = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/**
 * @param {string} variable
 * @returns {string}
 */
const raw = (variable) => `var(${variable})`;

// --- Patron topografico ------------------------------------------------------
//
// UNA sola definicion de la geometria, tres tintas derivadas de ella.
//
// Las tres cadenas vivian escritas a mano en `tokens.css` -~1,5 KB cada una,
// nueve `path` identicos repetidos tres veces, distintos solo en color, opacidad
// y grosor- y la tercera nacio copiando la segunda (hallazgo M6 de la revision
// de DEC-039). CSS no puede componer un `url()` a partir de fragmentos, asi que
// la unica forma de tener una sola fuente es generar el `data:` URI. Se hace
// aqui, y no en `src/index.ts`, porque los valores tienen que existir cuando
// Tailwind construye la capa `base`, antes de que corra ningun TypeScript.
//
// Los tokens que salen de aqui se llaman igual que antes y se consumen igual
// que antes -`var(--lsw-pattern-topo)` desde `globals.css`-, asi que ningun
// consumidor se entera de que han cambiado de sitio.

/** Ancho y alto del mosaico, en pixeles. La repeticion horizontal no deja
 *  costura porque cada curva termina a la misma altura a la que empieza. */
const TOPO_TILE = { width: 640, height: 420 };

/** Las nueve curvas de nivel. Esta es la definicion, y solo existe una vez. */
const TOPO_PATHS = [
  "M0 22 C 60 2 130 52 200 30 C 270 8 340 56 420 34 C 500 12 570 42 640 22",
  "M0 58 C 70 36 140 86 210 62 C 290 36 350 88 430 68 C 510 48 580 80 640 58",
  "M0 86 C 80 64 150 112 230 92 C 310 72 380 118 460 96 C 540 74 590 104 640 86",
  "M0 140 C 60 116 140 166 220 144 C 300 122 370 170 450 148 C 530 126 580 160 640 140",
  "M0 178 C 70 156 150 202 230 182 C 320 160 390 206 470 184 C 550 162 590 196 640 178",
  "M0 238 C 60 216 140 264 220 244 C 300 224 380 268 460 248 C 540 228 590 258 640 238",
  "M0 296 C 80 274 150 320 240 300 C 320 282 390 324 470 304 C 550 284 590 314 640 296",
  "M0 328 C 60 310 140 352 230 332 C 310 314 380 356 460 336 C 540 316 590 344 640 328",
  "M0 392 C 70 372 150 416 235 396 C 315 378 390 418 470 398 C 550 378 590 408 640 392",
];

/**
 * Una tinta del mosaico, como `url("data:...")` listo para `background-image`.
 *
 * La opacidad va DENTRO del SVG (`stroke-opacity`) y no fuera: una capa de
 * `background-image` no acepta opacidad propia, y un pseudo-elemento adicional
 * chocaria con los que ya usan `.lsw-atmosphere` y `.lsw-grain`.
 *
 * No va en base64: el SVG queda legible en las herramientas de desarrollo y
 * pesa menos. Y no se codifica ENTERO con `encodeURIComponent`, que escaparia
 * tambien espacios y comillas y engordaria cada token cerca de un kilobyte:
 * los atributos van entre comillas simples y solo se escapan los tres
 * caracteres que un `url()` de CSS no puede llevar en claro. Es exactamente la
 * codificacion que tenian las cadenas escritas a mano, para que el CSS
 * resultante sea byte a byte el mismo.
 *
 * @param {{ stroke: string, opacity: number, width: number }} ink
 * @returns {string}
 */
const topoPattern = ({ stroke, opacity, width }) => {
  const { width: w, height: h } = TOPO_TILE;
  const svg = [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${String(w)}' height='${String(h)}' viewBox='0 0 ${String(w)} ${String(h)}'>`,
    `<g fill='none' stroke='${stroke}' stroke-opacity='${String(opacity)}' stroke-width='${String(width)}'>`,
    ...TOPO_PATHS.map((d) => `<path d='${d}'/>`),
    `</g>`,
    `</svg>`,
  ].join("");

  const encoded = svg
    .replace(/%/g, "%25")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/#/g, "%23");

  return `url("data:image/svg+xml,${encoded}")`;
};

/**
 * Los cuatro tokens del patron, emitidos en `:root` por el plugin de mas abajo.
 *
 * Tres tintas:
 *   - la dorada, para las superficies negras;
 *   - `-ink`, negra al 11%, para la banda del premio (que es dorada: un patron
 *     dorado sobre oro no se ve);
 *   - `-ink-soft`, negra al 4,5%, para las superficies claras de mercancia
 *     (DEC-039/040), donde el trazo al 11% competiria con las fotografias.
 *
 * Los colores son literales y no tokens: un `data:` URI se carga como documento
 * independiente y no ve las custom properties del documento que lo usa.
 */
const TOPO_TOKENS = {
  "--lsw-pattern-topo-size": `${String(TOPO_TILE.width)}px ${String(TOPO_TILE.height)}px`,
  "--lsw-pattern-topo": topoPattern({ stroke: "#c9a227", opacity: 0.07, width: 1.25 }),
  "--lsw-pattern-topo-ink": topoPattern({ stroke: "#000000", opacity: 0.11, width: 1.4 }),
  "--lsw-pattern-topo-ink-soft": topoPattern({ stroke: "#000000", opacity: 0.045, width: 1.15 }),
};

/** Exportado SOLO para el test que verifica que las tres tintas comparten
 *  geometria y que ninguna vuelve a escribirse a mano. No lo consume la app. */
export const topoTokens = () => ({ ...TOPO_TOKENS });

/** @type {import("tailwindcss").Config} */
const preset = {
  // Marcador obligatorio para un preset: el consumidor define su propio
  // `content`, porque solo el sabe que archivos suyos hay que escanear.
  content: [],
  // DEC-038: hay UN SOLO TEMA, oscuro. No queda ninguna variante `dark:` que
  // generar, y por eso el selector deja de apuntar a `[data-theme="dark"]`: ese
  // atributo ya no existe en ninguna parte, y dejarlo declarado sugeriria que la
  // dualidad claro/oscuro sigue viva. La clave se conserva en su forma mas
  // inerte porque Tailwind la espera; si algun dia hubiera un segundo tema,
  // vuelve aqui.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: color("--lsw-color-bg"),
        surface: {
          DEFAULT: color("--lsw-color-surface"),
          raised: color("--lsw-color-surface-raised"),
          sunken: color("--lsw-color-surface-sunken"),
        },
        border: {
          DEFAULT: color("--lsw-color-border"),
          strong: color("--lsw-color-border-strong"),
        },
        text: {
          DEFAULT: color("--lsw-color-text"),
          muted: color("--lsw-color-text-muted"),
          subtle: color("--lsw-color-text-subtle"),
          inverse: color("--lsw-color-text-inverse"),
        },
        brand: {
          DEFAULT: color("--lsw-color-brand"),
          hover: color("--lsw-color-brand-hover"),
          active: color("--lsw-color-brand-active"),
          subtle: color("--lsw-color-brand-subtle"),
        },
        "on-brand": color("--lsw-color-on-brand"),
        accent: {
          DEFAULT: color("--lsw-color-accent"),
          hover: color("--lsw-color-accent-hover"),
          subtle: color("--lsw-color-accent-subtle"),
        },
        "on-accent": color("--lsw-color-on-accent"),
        success: {
          DEFAULT: color("--lsw-color-success"),
          subtle: color("--lsw-color-success-subtle"),
        },
        "on-success": color("--lsw-color-on-success"),
        warning: {
          DEFAULT: color("--lsw-color-warning"),
          subtle: color("--lsw-color-warning-subtle"),
        },
        "on-warning": color("--lsw-color-on-warning"),
        danger: {
          DEFAULT: color("--lsw-color-danger"),
          subtle: color("--lsw-color-danger-subtle"),
        },
        "on-danger": color("--lsw-color-on-danger"),
        info: {
          DEFAULT: color("--lsw-color-info"),
          subtle: color("--lsw-color-info-subtle"),
        },
        "on-info": color("--lsw-color-on-info"),
        // DEC-039: paleta de la BANDA CLARA. Solo la consumen las secciones de
        // mercancia (`.lsw-band-light`). Va agrupada bajo `light` para que en el
        // marcado se vea de un vistazo que una clase pertenece a la banda clara
        // (`text-light-text`) y no al sistema oscuro (`text-text`): son dos
        // paletas que conviven en la misma pagina y confundirlas es el unico
        // fallo de contraste que este diseno puede producir.
        light: {
          bg: color("--lsw-color-light-bg"),
          surface: color("--lsw-color-light-surface"),
          "surface-sunken": color("--lsw-color-light-surface-sunken"),
          border: color("--lsw-color-light-border"),
          "border-strong": color("--lsw-color-light-border-strong"),
          text: color("--lsw-color-light-text"),
          "text-muted": color("--lsw-color-light-text-muted"),
          // Oro de tinta: el acento de marca llevado a la sombra para que
          // pueda llevar texto sobre blanco (5,6:1). Ver `tokens.css`.
          gold: color("--lsw-color-light-gold"),
        },
        focus: color("--lsw-color-focus"),
        overlay: color("--lsw-color-overlay"),
        skeleton: color("--lsw-color-skeleton"),
      },

      fontFamily: {
        sans: raw("--lsw-font-sans"),
        display: raw("--lsw-font-display"),
        mono: raw("--lsw-font-mono"),
      },

      fontSize: {
        // Titular del hero (DEC-038). No existia antes de la reescritura de
        // marca: la portada anterior no tenia ningun tamano por encima de
        // `display-lg` porque no tenia hero a pantalla completa.
        "display-xl": [
          raw("--lsw-text-display-xl-size"),
          {
            lineHeight: raw("--lsw-text-display-xl-line"),
            letterSpacing: raw("--lsw-text-display-xl-tracking"),
          },
        ],
        "display-lg": [
          raw("--lsw-text-display-lg-size"),
          {
            lineHeight: raw("--lsw-text-display-lg-line"),
            letterSpacing: raw("--lsw-text-display-lg-tracking"),
          },
        ],
        "display-md": [
          raw("--lsw-text-display-md-size"),
          {
            lineHeight: raw("--lsw-text-display-md-line"),
            letterSpacing: raw("--lsw-text-display-md-tracking"),
          },
        ],
        "heading-lg": [
          raw("--lsw-text-heading-lg-size"),
          {
            lineHeight: raw("--lsw-text-heading-lg-line"),
            letterSpacing: raw("--lsw-text-heading-lg-tracking"),
          },
        ],
        "heading-md": [
          raw("--lsw-text-heading-md-size"),
          {
            lineHeight: raw("--lsw-text-heading-md-line"),
            letterSpacing: raw("--lsw-text-heading-md-tracking"),
          },
        ],
        "heading-sm": [
          raw("--lsw-text-heading-sm-size"),
          {
            lineHeight: raw("--lsw-text-heading-sm-line"),
            letterSpacing: raw("--lsw-text-heading-sm-tracking"),
          },
        ],
        "body-lg": [
          raw("--lsw-text-body-lg-size"),
          {
            lineHeight: raw("--lsw-text-body-lg-line"),
            letterSpacing: raw("--lsw-text-body-lg-tracking"),
          },
        ],
        "body-md": [
          raw("--lsw-text-body-md-size"),
          {
            lineHeight: raw("--lsw-text-body-md-line"),
            letterSpacing: raw("--lsw-text-body-md-tracking"),
          },
        ],
        "body-sm": [
          raw("--lsw-text-body-sm-size"),
          {
            lineHeight: raw("--lsw-text-body-sm-line"),
            letterSpacing: raw("--lsw-text-body-sm-tracking"),
          },
        ],
        label: [
          raw("--lsw-text-label-size"),
          {
            lineHeight: raw("--lsw-text-label-line"),
            letterSpacing: raw("--lsw-text-label-tracking"),
          },
        ],
        caption: [
          raw("--lsw-text-caption-size"),
          {
            lineHeight: raw("--lsw-text-caption-line"),
            letterSpacing: raw("--lsw-text-caption-tracking"),
          },
        ],
        overline: [
          raw("--lsw-text-overline-size"),
          {
            lineHeight: raw("--lsw-text-overline-line"),
            letterSpacing: raw("--lsw-text-overline-tracking"),
          },
        ],
      },

      // Tracking de los titulares en caja alta. `tracking-display` es lo que
      // impide que una condensada en mayusculas se lea como una mancha; los
      // pasos de la escala ya traen el suyo, esto es para composiciones que
      // mezclan tamanos (el marcador de la cuenta atras, el bloque de marca).
      letterSpacing: {
        display: raw("--lsw-tracking-display"),
        wide: raw("--lsw-tracking-wide"),
      },

      fontWeight: {
        regular: raw("--lsw-font-weight-regular"),
        medium: raw("--lsw-font-weight-medium"),
        semibold: raw("--lsw-font-weight-semibold"),
        bold: raw("--lsw-font-weight-bold"),
      },

      // Se ANADEN a la escala de Tailwind con prefijo `s-` para que sea evidente
      // en el marcado cuando se usa un token del sistema (`p-s4`) y cuando se
      // usa la escala por defecto (`p-4`). Ambas coinciden en valor.
      spacing: {
        s0: raw("--lsw-space-0"),
        s1: raw("--lsw-space-1"),
        s2: raw("--lsw-space-2"),
        s3: raw("--lsw-space-3"),
        s4: raw("--lsw-space-4"),
        s5: raw("--lsw-space-5"),
        s6: raw("--lsw-space-6"),
        s8: raw("--lsw-space-8"),
        s10: raw("--lsw-space-10"),
        s12: raw("--lsw-space-12"),
        s16: raw("--lsw-space-16"),
        s20: raw("--lsw-space-20"),
        s24: raw("--lsw-space-24"),
        gutter: raw("--lsw-gutter"),
      },

      borderRadius: {
        none: raw("--lsw-radius-none"),
        sm: raw("--lsw-radius-sm"),
        md: raw("--lsw-radius-md"),
        lg: raw("--lsw-radius-lg"),
        xl: raw("--lsw-radius-xl"),
        "2xl": raw("--lsw-radius-2xl"),
        pill: raw("--lsw-radius-pill"),
      },

      boxShadow: {
        none: raw("--lsw-shadow-none"),
        sm: raw("--lsw-shadow-sm"),
        md: raw("--lsw-shadow-md"),
        lg: raw("--lsw-shadow-lg"),
        xl: raw("--lsw-shadow-xl"),
        // DEC-039: sobre blanco la sombra SI eleva, asi que la banda clara
        // tiene sus propios escalones en vez de reutilizar unos calibrados
        // para no verse sobre negro.
        "light-sm": raw("--lsw-shadow-light-sm"),
        "light-md": raw("--lsw-shadow-light-md"),
      },

      maxWidth: {
        container: raw("--lsw-container-max"),
        narrow: raw("--lsw-container-narrow"),
      },

      height: {
        "control-sm": raw("--lsw-control-height-sm"),
        "control-md": raw("--lsw-control-height-md"),
        "control-lg": raw("--lsw-control-height-lg"),
        "control-xl": raw("--lsw-control-height-xl"),
      },

      minHeight: {
        "control-sm": raw("--lsw-control-height-sm"),
        "control-md": raw("--lsw-control-height-md"),
        "control-lg": raw("--lsw-control-height-lg"),
        "control-xl": raw("--lsw-control-height-xl"),
        // Area tactil minima recomendada; se usa como suelo, no como altura.
        touch: "44px",
      },

      minWidth: {
        touch: "44px",
      },

      transitionDuration: {
        instant: raw("--lsw-duration-instant"),
        fast: raw("--lsw-duration-fast"),
        base: raw("--lsw-duration-base"),
        slow: raw("--lsw-duration-slow"),
      },

      transitionTimingFunction: {
        standard: raw("--lsw-ease-standard"),
        emphasized: raw("--lsw-ease-emphasized"),
      },

      zIndex: {
        base: raw("--lsw-z-base"),
        sticky: raw("--lsw-z-sticky"),
        dropdown: raw("--lsw-z-dropdown"),
        overlay: raw("--lsw-z-overlay"),
        modal: raw("--lsw-z-modal"),
        toast: raw("--lsw-z-toast"),
      },

      // OJO: no se anaden claves a `ringWidth` ni a `ringOffsetWidth`. Tailwind
      // resuelve `ring-*` primero como grosor y despues como color, asi que una
      // clave `focus` en `ringWidth` convertiria `ring-focus` en un grosor y
      // dejaria el anillo de foco sin color. El grosor se expresa con las
      // utilidades estandar (`ring-2`, `ring-offset-2`), cuyos valores coinciden
      // con `--lsw-focus-ring-width` y `--lsw-focus-ring-offset`.

      keyframes: {
        "lsw-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "lsw-spin": {
          to: { transform: "rotate(360deg)" },
        },
        // Entradas de superficies temporales (modal, drawer, toast). Son
        // desplazamientos cortos y opacidad: nada de rebotes ni escalados
        // llamativos, que es estetica de casino y esta prohibida.
        "lsw-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "lsw-slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "lsw-slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "lsw-slide-in-bottom": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },

      animation: {
        "lsw-pulse": "lsw-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "lsw-spin": "lsw-spin 0.7s linear infinite",
        // La duracion sale de los tokens: con `prefers-reduced-motion` valen
        // 0ms en el origen, asi que la animacion desaparece sin que ningun
        // componente tenga que acordarse (ademas de `motion-reduce`).
        "lsw-fade-in": "lsw-fade-in var(--lsw-duration-fast) var(--lsw-ease-standard)",
        "lsw-slide-in-right":
          "lsw-slide-in-right var(--lsw-duration-base) var(--lsw-ease-emphasized)",
        "lsw-slide-in-left":
          "lsw-slide-in-left var(--lsw-duration-base) var(--lsw-ease-emphasized)",
        "lsw-slide-in-bottom":
          "lsw-slide-in-bottom var(--lsw-duration-base) var(--lsw-ease-emphasized)",
      },
    },
  },
  plugins: [
    // Emite los tokens del patron topografico en `:root`, dentro de la capa
    // `base`. Van aqui y no en `tokens.css` porque las tres tintas se DERIVAN de
    // una sola geometria; ver el bloque `--- Patron topografico ---`.
    plugin(({ addBase }) => {
      addBase({ ":root": TOPO_TOKENS });
    }),
  ],
};

export default preset;
