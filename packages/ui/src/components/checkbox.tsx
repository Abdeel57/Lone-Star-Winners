"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "size"
> {
  /**
   * Etiqueta visible, ya traducida. Es OBLIGATORIA y la pinta el propio
   * componente: una casilla sin etiqueta contigua no es utilizable ni con el
   * raton (el area de clic se reduce a 16px) ni con lector de pantalla.
   */
  readonly label: ReactNode;
  /** Texto de ayuda. Se asocia por `aria-describedby`. */
  readonly description?: ReactNode;
  /** Mensaje de error ya traducido. Su presencia marca la casilla invalida. */
  readonly error?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * Casilla de verificacion.
 *
 * NO se envuelve en `FormField`: `FormField` pinta la etiqueta ENCIMA del
 * control, que es lo correcto para un campo de texto y lo incorrecto para una
 * casilla, donde la etiqueta va al lado y forma parte del area de activacion.
 * Por eso este componente trae su propia etiqueta y su propio cableado ARIA.
 *
 * Es un `input` nativo con `appearance-none`: conserva el comportamiento de
 * teclado, el estado indeterminado, el envio de formulario y el autorrelleno,
 * y solo se sustituye su pintado.
 *
 * En consentimientos legales (aceptar Reglas Oficiales, confirmar elegibilidad)
 * el texto de la etiqueta lo decide el consumidor a partir de configuracion o
 * de la API. Este componente no conoce ninguna regla legal.
 */
export function Checkbox({
  label,
  description,
  error,
  className,
  id,
  ref,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: CheckboxProps) {
  const baseId = useId();
  const controlId = id ?? `${baseId}-checkbox`;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;

  const hasDescription = description !== undefined && description !== null;
  const hasError = error !== undefined && error !== null;

  const describedByParts: string[] = [];
  if (ariaDescribedBy !== undefined) describedByParts.push(ariaDescribedBy);
  if (hasDescription) describedByParts.push(descriptionId);
  if (hasError) describedByParts.push(errorId);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-start gap-3">
        {/* La marca de verificacion es un SVG hermano y NO una imagen de fondo:
            una imagen de fondo obligaria a escribir un color literal dentro de
            una URL de datos, y este paquete no define colores (solo consume
            tokens). Como hermano, hereda `text-on-brand` y funciona igual en
            tema claro y en tema oscuro. */}
        <span className="relative mt-0.5 inline-flex shrink-0">
          <input
            {...rest}
            ref={ref}
            type="checkbox"
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={hasError ? true : undefined}
            className={cn(
              "peer h-5 w-5 appearance-none rounded-sm border bg-surface",
              "transition-colors duration-fast ease-standard",
              FOCUS_VISIBLE_CLASSES,
              "checked:border-brand checked:bg-brand",
              "indeterminate:border-brand indeterminate:bg-brand",
              "disabled:cursor-not-allowed disabled:bg-surface-sunken",
              hasError ? "border-danger" : "border-border-strong",
            )}
          />

          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            focusable="false"
            className={cn(
              "pointer-events-none absolute inset-0 h-5 w-5 text-on-brand",
              "opacity-0 peer-checked:opacity-100",
            )}
          >
            <path
              d="M5.5 10.5l3 3 6-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <label htmlFor={controlId} className="text-body-sm text-text">
          {label}
        </label>
      </div>

      {hasDescription ? (
        <p id={descriptionId} className="pl-8 text-body-sm text-text-muted">
          {description}
        </p>
      ) : null}

      {hasError ? (
        <p id={errorId} role="alert" className="pl-8 text-body-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
