/**
 * Anillo de foco unico para todo el sistema.
 *
 * Se define una sola vez para que ningun componente pueda quedarse sin foco
 * visible por descuido. Se usa `focus-visible` y no `focus`: asi el anillo no
 * aparece al hacer clic con el raton pero si en navegacion por teclado, que es
 * exactamente lo que pide WCAG 2.4.7.
 *
 * El color sale del token `--lsw-color-focus`, y el offset se pinta sobre
 * `--lsw-color-bg`, de modo que el anillo mantiene contraste en tema claro y en
 * tema oscuro sin ninguna regla adicional.
 */
export const FOCUS_VISIBLE_CLASSES =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
