/**
 * Lone Star Winners - superficie de TypeScript del design system.
 *
 * El sistema visual vive en CSS (`src/styles/tokens.css`) y en el preset de
 * Tailwind. Este modulo existe para el caso en el que un componente necesita
 * referirse a un token desde TypeScript (estilos en linea, `<meta name="theme-
 * color">`, futuras visualizaciones de datos) sin escribir el nombre de la
 * variable a mano y sin poder equivocarse: los nombres son un tipo.
 *
 * Regla: si un valor se puede expresar con una clase de Tailwind, se usa la
 * clase. Este modulo es la excepcion, no el camino habitual.
 */

/** Nombres de los tokens de color, sin el prefijo `--lsw-color-`. */
export const COLOR_TOKENS = [
  "bg",
  "surface",
  "surface-raised",
  "surface-sunken",
  "border",
  "border-strong",
  "text",
  "text-muted",
  "text-subtle",
  "text-inverse",
  "brand",
  "brand-hover",
  "brand-active",
  "brand-subtle",
  "on-brand",
  "accent",
  "accent-hover",
  "accent-subtle",
  "on-accent",
  "success",
  "success-subtle",
  "on-success",
  "warning",
  "warning-subtle",
  "on-warning",
  "danger",
  "danger-subtle",
  "on-danger",
  "info",
  "info-subtle",
  "on-info",
  "focus",
  "overlay",
  "skeleton",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Nombres de los tokens de espaciado, sin el prefijo `--lsw-space-`. */
export const SPACE_TOKENS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "8",
  "10",
  "12",
  "16",
  "20",
  "24",
] as const;

export type SpaceToken = (typeof SPACE_TOKENS)[number];

/** Nombres de los tokens de radio, sin el prefijo `--lsw-radius-`. */
export const RADIUS_TOKENS = ["none", "sm", "md", "lg", "xl", "2xl", "pill"] as const;

export type RadiusToken = (typeof RADIUS_TOKENS)[number];

/** Nombres de los tokens de elevacion, sin el prefijo `--lsw-shadow-`. */
export const ELEVATION_TOKENS = ["none", "sm", "md", "lg", "xl"] as const;

export type ElevationToken = (typeof ELEVATION_TOKENS)[number];

/** Nombres de los pasos de la escala tipografica, sin prefijo. */
export const TEXT_TOKENS = [
  "display-xl",
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
] as const;

export type TextToken = (typeof TEXT_TOKENS)[number];

/**
 * Referencia CSS a un token de color, ya resuelta como color usable.
 *
 * Los tokens se almacenan como canales RGB (ver `tokens.css`), asi que hay que
 * envolverlos en `rgb()`. `alpha` acepta un valor entre 0 y 1.
 */
export function colorVar(token: ColorToken, alpha?: number): string {
  const channels = `var(--lsw-color-${token})`;
  return alpha === undefined ? `rgb(${channels})` : `rgb(${channels} / ${String(alpha)})`;
}

/** Referencia CSS a un token de espaciado. */
export function spaceVar(token: SpaceToken): string {
  return `var(--lsw-space-${token})`;
}

/** Referencia CSS a un token de radio. */
export function radiusVar(token: RadiusToken): string {
  return `var(--lsw-radius-${token})`;
}

/** Referencia CSS a un token de elevacion. */
export function elevationVar(token: ElevationToken): string {
  return `var(--lsw-shadow-${token})`;
}

/**
 * Ruta del archivo de tokens, para quien quiera importarlo desde CSS:
 *
 *     import "@lsw/design-system/tokens.css";
 */
export const TOKENS_CSS_IMPORT = "@lsw/design-system/tokens.css";
