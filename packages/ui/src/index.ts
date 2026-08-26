/**
 * @lsw/ui - primitivas de interfaz de Lone Star Winners.
 *
 * Reglas del paquete
 * ------------------
 * 1. **Ningun componente contiene texto visible.** Todo lo que se lee llega por
 *    props ya traducido desde `apps/web`, que lo resuelve contra
 *    `messages/en-US.json` y `messages/es-US.json` (DEC-021, DEC-022). Esto
 *    incluye los nombres accesibles: si un boton de solo icono no recibe su
 *    etiqueta, no se renderiza el boton. Y cuando una libreria de terceros trae
 *    un texto por defecto en ingles -el `label` de la region de avisos de Radix
 *    Toast-, la envoltura lo convierte en prop obligatoria.
 * 2. **Ningun componente contiene reglas legales ni de negocio.** Ni edades, ni
 *    estados, ni ratios de entries, ni fechas (CLAUDE.md, principios #2 y #14).
 *    `Countdown` cuenta, pero no decide si una promocion esta abierta.
 * 3. **Ningun componente define color, radio o sombra literales**: todo sale de
 *    `@lsw/design-system`.
 * 4. Mobile-first y foco visible en todo lo interactivo.
 *
 * Cuando se usa Radix y cuando no
 * -------------------------------
 * Radix cubre lo que el navegador NO da y que casi nadie implementa bien a
 * mano: foco atrapado y devuelto (`Modal`, `Drawer`), foco itinerante entre
 * pestanas (`Tabs`) y regiones de anuncio con ciclo de vida (`Toast`).
 *
 * NO se usa donde el elemento nativo ya cumple: `Select` es un `select` real
 * -abre el selector del sistema en movil y funciona sin JavaScript- y `Radio`
 * son radios nativos dentro de un `fieldset`, donde el navegador ya implementa
 * el foco itinerante y el ciclo de flechas. Anadir JavaScript ahi solo quitaria
 * comportamiento.
 */

export { Alert, type AlertProps, type AlertTone } from "./components/alert";
export {
  Badge,
  type BadgeEmphasis,
  type BadgeProps,
  type BadgeShape,
  type BadgeSize,
  type BadgeTone,
} from "./components/badge";
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
export { Checkbox, type CheckboxProps } from "./components/checkbox";
export {
  Countdown,
  computeCountdownParts,
  type CountdownParts,
  type CountdownProps,
  type CountdownUnitLabels,
} from "./components/countdown";
export { Drawer, type DrawerProps, type DrawerSide } from "./components/drawer";
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
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from "./components/icon-button";
export { Input, type InputProps, type InputSize } from "./components/input";
export { MediaFrame, type MediaFrameProps, type MediaRatio } from "./components/media-frame";
export { Modal, type ModalProps } from "./components/modal";
export {
  Pagination,
  paginationRange,
  type PaginationLabels,
  type PaginationProps,
} from "./components/pagination";
export { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from "./components/radio-group";
export { Select, type SelectProps, type SelectSize } from "./components/select";
export {
  Skeleton,
  SkeletonText,
  type SkeletonProps,
  type SkeletonTextProps,
} from "./components/skeleton";
export { StatCard, type StatCardProps, type StatCardTone } from "./components/stat-card";
export {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeaderCell,
  TableRow,
  type DataTableColumn,
  type DataTableProps,
  type TableAlign,
  type TableCellProps,
  type TableContainerProps,
  type TableHeaderCellProps,
  type TableProps,
  type TableRowProps,
  type TableSectionProps,
} from "./components/table";
export {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
  type TabsListProps,
  type TabsPanelProps,
  type TabsProps,
  type TabsTriggerProps,
} from "./components/tabs";
export { Textarea, type TextareaProps } from "./components/textarea";
export {
  Timeline,
  TimelineItem,
  type TimelineItemProps,
  type TimelineProps,
  type TimelineStatus,
} from "./components/timeline";
export {
  Toast,
  ToastProvider,
  ToastViewport,
  type ToastProps,
  type ToastProviderProps,
  type ToastTone,
  type ToastViewportProps,
} from "./components/toast";
export { VisuallyHidden, type VisuallyHiddenProps } from "./components/visually-hidden";

export { cn } from "./lib/cn";
export { FOCUS_VISIBLE_CLASSES } from "./lib/focus";
