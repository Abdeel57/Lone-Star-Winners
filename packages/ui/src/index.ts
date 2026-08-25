/**
 * @lsw/ui - primitivas de interfaz de Lone Star Winners.
 *
 * Reglas del paquete
 * ------------------
 * 1. **Ningun componente contiene texto visible.** Todo lo que se lee llega por
 *    props ya traducido desde `apps/web`, que lo resuelve contra
 *    `messages/en-US.json` y `messages/es-US.json` (DEC-021, DEC-022). Esto
 *    incluye los nombres accesibles: si un boton de solo icono no recibe su
 *    etiqueta, no se renderiza el boton.
 * 2. **Ningun componente contiene reglas legales ni de negocio.** Ni edades, ni
 *    estados, ni ratios de entries, ni fechas (CLAUDE.md, principios #2 y #14).
 * 3. **Ningun componente define color, radio o sombra literales**: todo sale de
 *    `@lsw/design-system`.
 * 4. Mobile-first y foco visible en todo lo interactivo.
 */

export { Alert, type AlertProps, type AlertTone } from "./components/alert";
export {
  Button,
  buttonVariants,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./components/button";
export {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  type CardElevation,
  type CardPadding,
  type CardProps,
  type CardSlotProps,
  type CardTitleProps,
} from "./components/card";
export {
  EmptyState,
  Heading,
  type EmptyStateProps,
  type HeadingLevel,
} from "./components/empty-state";
export { ErrorState, type ErrorStateProps } from "./components/error-state";
export {
  FormField,
  useFormField,
  type FormFieldContextValue,
  type FormFieldProps,
} from "./components/form-field";
export { Input, type InputProps, type InputSize } from "./components/input";
export {
  Skeleton,
  SkeletonText,
  type SkeletonProps,
  type SkeletonTextProps,
} from "./components/skeleton";
export { VisuallyHidden, type VisuallyHiddenProps } from "./components/visually-hidden";

export { cn } from "./lib/cn";
export { FOCUS_VISIBLE_CLASSES } from "./lib/focus";
