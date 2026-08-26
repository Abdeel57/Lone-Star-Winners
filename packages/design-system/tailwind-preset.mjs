// ---------------------------------------------------------------------------
// Lone Star Winners - preset de Tailwind (@lsw/design-system/tailwind-preset)
//
// El preset NO define valores: los toma de las custom properties declaradas en
// `src/styles/tokens.css`. Consecuencia deliberada: cambiar el tema (claro,
// oscuro, o un tema de marca futuro) no recompila Tailwind, porque las clases
// generadas apuntan a variables, no a colores literales.
//
// Este archivo es JavaScript plano a proposito. La configuracion de Tailwind la
// carga el propio Tailwind con su resolvedor, fuera del pipeline de TypeScript
// del monorepo; mantenerlo en `.mjs` evita depender de como jiti resuelva un
// `.ts` a traves del campo `exports` de un paquete del workspace.
// ---------------------------------------------------------------------------

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
  plugins: [],
};

export default preset;
