"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { InputHTMLAttributes, Ref } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";
import { useFormField } from "./form-field";

const inputVariants = cva(
  cn(
    "block w-full rounded-md border bg-surface text-text",
    "placeholder:text-text-subtle",
    "transition-colors duration-fast ease-standard",
    FOCUS_VISIBLE_CLASSES,
    "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-subtle",
    "read-only:bg-surface-sunken",
  ),
  {
    variants: {
      tone: {
        default: "border-border-strong hover:border-text-subtle",
        invalid: "border-danger hover:border-danger",
      },
      inputSize: {
        // 16px de tamano de fuente en movil: por debajo, iOS hace zoom al
        // enfocar el campo y descoloca el layout.
        sm: "h-control-sm px-2.5 text-body-sm",
        md: "h-control-md px-3 text-body-md",
        lg: "h-control-lg px-3.5 text-body-md",
      },
    },
    defaultVariants: {
      tone: "default",
      inputSize: "md",
    },
  },
);

export type InputSize = NonNullable<VariantProps<typeof inputVariants>["inputSize"]>;

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "size"
> {
  readonly inputSize?: InputSize;
  readonly className?: string;
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * Campo de texto.
 *
 * Si esta dentro de un `FormField`, toma de el `id`, `aria-describedby`,
 * `aria-invalid` y `required` sin que haya que repetirlos.
 *
 * El `id` del contexto gana a proposito sobre un `id` explicito: la etiqueta la
 * pinta el `FormField`, asi que si el control cambiara su `id` por su cuenta, el
 * `htmlFor` de la etiqueta apuntaria al vacio y el campo se quedaria sin nombre
 * accesible. Para fijar el `id` desde fuera se usa `FormField.controlId`. El
 * resto de props si pueden sobrescribirse.
 */
export function Input({
  inputSize,
  className,
  id,
  required,
  ref,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...rest
}: InputProps) {
  const field = useFormField();

  const resolvedId = field?.controlId ?? id;
  const resolvedDescribedBy = ariaDescribedBy ?? field?.describedBy;
  const resolvedInvalid = ariaInvalid ?? (field?.invalid === true ? true : undefined);
  const resolvedRequired = required ?? field?.required;

  return (
    <input
      {...rest}
      ref={ref}
      id={resolvedId}
      required={resolvedRequired}
      aria-describedby={resolvedDescribedBy}
      aria-invalid={resolvedInvalid}
      className={cn(
        inputVariants({
          tone: resolvedInvalid === true || resolvedInvalid === "true" ? "invalid" : "default",
          inputSize,
        }),
        className,
      )}
    />
  );
}
