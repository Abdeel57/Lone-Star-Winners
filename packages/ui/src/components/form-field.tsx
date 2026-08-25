"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

import { cn } from "../lib/cn";

export interface FormFieldContextValue {
  /** `id` que debe llevar el control. */
  readonly controlId: string;
  /** Lista de `id` para `aria-describedby`, o `undefined` si no hay ninguno. */
  readonly describedBy: string | undefined;
  /** Si el campo esta en error, para `aria-invalid`. */
  readonly invalid: boolean;
  /** Si el campo es obligatorio, para el atributo `required`. */
  readonly required: boolean;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Devuelve el contexto del `FormField` que envuelve al control, o `null` si el
 * control se usa suelto. Los controles del sistema lo consultan para cablearse
 * solos: `id`, `aria-describedby`, `aria-invalid` y `required`.
 */
export function useFormField(): FormFieldContextValue | null {
  return useContext(FormFieldContext);
}

export interface FormFieldProps {
  /** Etiqueta visible. Siempre visible: un `placeholder` no es una etiqueta. */
  readonly label: ReactNode;
  /** Texto de ayuda. Se asocia al control mediante `aria-describedby`. */
  readonly description?: ReactNode;
  /**
   * Mensaje de error ya traducido por el consumidor. Su presencia marca el
   * campo como invalido y lo anuncia con `role="alert"`.
   */
  readonly error?: ReactNode;
  readonly required?: boolean;
  /**
   * Indicador visible de campo obligatorio, ya traducido (por ejemplo
   * "Required" / "Obligatorio"). Si no se pasa no se muestra nada: el
   * componente no inventa texto (DEC-021, DEC-022).
   */
  readonly requiredHint?: ReactNode;
  /**
   * `id` explicito del control. Solo hace falta cuando algo externo tiene que
   * apuntar al campo (un `aria-activedescendant`, un enlace de "ir al error").
   * Si no se pasa, se genera con `useId`.
   */
  readonly controlId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Envoltorio de un control de formulario.
 *
 * Resuelve de una vez las cuatro conexiones de accesibilidad que se olvidan por
 * separado: `label`/`for`, `aria-describedby` hacia la ayuda, `aria-invalid` y
 * el anuncio del error. Los identificadores se generan con `useId`, de modo que
 * son estables entre servidor y cliente y no chocan si el campo se repite.
 */
export function FormField({
  label,
  description,
  error,
  required = false,
  requiredHint,
  controlId: controlIdProp,
  className,
  children,
}: FormFieldProps) {
  const baseId = useId();
  const controlId = controlIdProp ?? `${baseId}-control`;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;

  const describedByParts: string[] = [];
  if (description !== undefined && description !== null) describedByParts.push(descriptionId);
  if (error !== undefined && error !== null) describedByParts.push(errorId);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  const contextValue: FormFieldContextValue = {
    controlId,
    describedBy,
    invalid: error !== undefined && error !== null,
    required,
  };

  return (
    <FormFieldContext.Provider value={contextValue}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={controlId} className="text-label font-medium text-text">
          {label}
          {required && requiredHint !== undefined ? (
            <span className="ml-1 font-regular text-text-subtle">{requiredHint}</span>
          ) : null}
        </label>

        {description !== undefined && description !== null ? (
          <p id={descriptionId} className="text-body-sm text-text-muted">
            {description}
          </p>
        ) : null}

        {children}

        {error !== undefined && error !== null ? (
          <p id={errorId} role="alert" className="text-body-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}
