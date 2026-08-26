"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode, Ref, SelectHTMLAttributes } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";
import { useFormField } from "./form-field";

/**
 * POR QUE ES UN `select` NATIVO Y NO UN COMBOBOX DE RADIX
 * -------------------------------------------------------
 * Este producto es mobile-first (CLAUDE.md #13). El `select` nativo abre el
 * selector del sistema operativo: rueda en iOS, dialogo a pantalla completa en
 * Android. Ningun combobox reimplementado en JavaScript iguala esa experiencia
 * en un telefono, y ademas funciona sin JavaScript, con lectores de pantalla y
 * con software de dictado sin una sola linea de ARIA.
 *
 * Radix se reserva para lo que el navegador NO da: foco atrapado (`Modal`,
 * `Drawer`), foco itinerante entre paneles (`Tabs`) y regiones de anuncio con
 * ciclo de vida (`Toast`).
 *
 * Si algun dia hace falta busqueda dentro de la lista o seleccion multiple con
 * fichas, eso sera OTRO componente, no un cambio de este.
 */
const selectVariants = cva(
  cn(
    "block w-full appearance-none rounded-md border bg-surface bg-none pr-10 text-text",
    "transition-colors duration-fast ease-standard",
    FOCUS_VISIBLE_CLASSES,
    "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-subtle",
  ),
  {
    variants: {
      tone: {
        default: "border-border-strong hover:border-text-subtle",
        invalid: "border-danger hover:border-danger",
      },
      selectSize: {
        sm: "h-control-sm pl-2.5 text-body-sm",
        // 16px de fuente en movil: por debajo, iOS hace zoom al enfocar.
        md: "h-control-md pl-3 text-body-md",
        lg: "h-control-lg pl-3.5 text-body-md",
      },
    },
    defaultVariants: {
      tone: "default",
      selectSize: "md",
    },
  },
);

export type SelectSize = NonNullable<VariantProps<typeof selectVariants>["selectSize"]>;

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className" | "size"
> {
  readonly selectSize?: SelectSize;
  readonly className?: string;
  readonly ref?: Ref<HTMLSelectElement>;
  /** Las opciones las escribe el consumidor: el texto no vive en este paquete. */
  readonly children: ReactNode;
}

/**
 * Lista desplegable.
 *
 * Igual que `Input`, se cablea sola cuando esta dentro de un `FormField`: toma
 * de el `id`, `aria-describedby`, `aria-invalid` y `required`. El `id` del
 * contexto gana sobre uno explicito para que el `htmlFor` de la etiqueta nunca
 * apunte al vacio.
 */
export function Select({
  selectSize,
  className,
  id,
  required,
  ref,
  children,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...rest
}: SelectProps) {
  const field = useFormField();

  const resolvedId = field?.controlId ?? id;
  const resolvedDescribedBy = ariaDescribedBy ?? field?.describedBy;
  const resolvedInvalid = ariaInvalid ?? (field?.invalid === true ? true : undefined);
  const resolvedRequired = required ?? field?.required;

  return (
    <span className="relative block">
      <select
        {...rest}
        ref={ref}
        id={resolvedId}
        required={resolvedRequired}
        aria-describedby={resolvedDescribedBy}
        aria-invalid={resolvedInvalid}
        className={cn(
          selectVariants({
            tone: resolvedInvalid === true || resolvedInvalid === "true" ? "invalid" : "default",
            selectSize,
          }),
          className,
        )}
      >
        {children}
      </select>

      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
      >
        <path
          d="M5.5 8l4.5 4.5L14.5 8"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
