"use client";

import type { Ref, TextareaHTMLAttributes } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";
import { useFormField } from "./form-field";

export interface TextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className"
> {
  readonly className?: string;
  readonly ref?: Ref<HTMLTextAreaElement>;
}

/**
 * Campo de texto multilinea.
 *
 * Se cablea solo dentro de un `FormField`, igual que `Input` y `Select`.
 *
 * `rows` por defecto es 4 y NO se fija una altura en clases: un campo cuya
 * altura se controla solo por CSS ignora el `rows` del consumidor, y hay
 * formularios -una solicitud AMOE, una razon de ajuste en el admin- donde el
 * tamano del campo comunica cuanto se espera que escriba la persona.
 */
export function Textarea({
  className,
  id,
  required,
  rows = 4,
  ref,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...rest
}: TextareaProps) {
  const field = useFormField();

  const resolvedId = field?.controlId ?? id;
  const resolvedDescribedBy = ariaDescribedBy ?? field?.describedBy;
  const resolvedInvalid = ariaInvalid ?? (field?.invalid === true ? true : undefined);
  const resolvedRequired = required ?? field?.required;
  const invalid = resolvedInvalid === true || resolvedInvalid === "true";

  return (
    <textarea
      {...rest}
      ref={ref}
      id={resolvedId}
      rows={rows}
      required={resolvedRequired}
      aria-describedby={resolvedDescribedBy}
      aria-invalid={resolvedInvalid}
      className={cn(
        "block w-full rounded-md border bg-surface px-3 py-2 text-body-md text-text",
        "placeholder:text-text-subtle",
        "transition-colors duration-fast ease-standard",
        FOCUS_VISIBLE_CLASSES,
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-subtle",
        "read-only:bg-surface-sunken",
        invalid
          ? "border-danger hover:border-danger"
          : "border-border-strong hover:border-text-subtle",
        className,
      )}
    />
  );
}
