"use client";

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * POR QUE ESTE GRUPO ES NATIVO Y NO USA RADIX
 * -------------------------------------------
 * El navegador YA implementa el patron completo de un grupo de radios: una
 * sola parada de tabulacion para todo el grupo, flechas que mueven la seleccion
 * en ciclo, y agrupacion semantica mediante `fieldset` + `legend`. Radix
 * reimplementa exactamente eso con `role="radiogroup"` y JavaScript. Aqui no
 * aporta nada y quita el funcionamiento sin JavaScript.
 *
 * Lo que si hace falta -y es lo que anade este componente- es que la LEYENDA
 * del grupo, su descripcion y su error queden asociados al conjunto, no a cada
 * radio por separado. Eso se hace con `fieldset`, `legend` y `aria-describedby`
 * en el `fieldset`.
 */

interface RadioGroupContextValue {
  readonly name: string;
  readonly invalid: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  /** Leyenda visible del grupo, ya traducida. */
  readonly label: ReactNode;
  /**
   * `name` compartido por todos los radios. Es lo que hace que el navegador los
   * trate como un solo grupo. Si no se pasa, se genera con `useId`.
   */
  readonly name?: string;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  /** Indicador visible de obligatorio, ya traducido. */
  readonly requiredHint?: ReactNode;
  /** Disposicion. En movil, `vertical` casi siempre es lo correcto. */
  readonly orientation?: "vertical" | "horizontal";
  readonly className?: string;
  readonly children: ReactNode;
}

export function RadioGroup({
  label,
  name,
  description,
  error,
  required = false,
  requiredHint,
  orientation = "vertical",
  className,
  children,
}: RadioGroupProps) {
  const baseId = useId();
  const groupName = name ?? `${baseId}-group`;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;

  const hasDescription = description !== undefined && description !== null;
  const hasError = error !== undefined && error !== null;

  const describedByParts: string[] = [];
  if (hasDescription) describedByParts.push(descriptionId);
  if (hasError) describedByParts.push(errorId);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  return (
    <RadioGroupContext.Provider value={{ name: groupName, invalid: hasError }}>
      <fieldset
        aria-describedby={describedBy}
        aria-invalid={hasError ? true : undefined}
        aria-required={required ? true : undefined}
        className={cn("flex flex-col gap-2 border-0 p-0", className)}
      >
        <legend className="text-label font-medium text-text">
          {label}
          {required && requiredHint !== undefined ? (
            <span className="ml-1 font-regular text-text-subtle">{requiredHint}</span>
          ) : null}
        </legend>

        {hasDescription ? (
          <p id={descriptionId} className="text-body-sm text-text-muted">
            {description}
          </p>
        ) : null}

        <div
          className={cn(
            "flex gap-3",
            orientation === "vertical" ? "flex-col" : "flex-row flex-wrap items-center",
          )}
        >
          {children}
        </div>

        {hasError ? (
          <p id={errorId} role="alert" className="text-body-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </fieldset>
    </RadioGroupContext.Provider>
  );
}

export interface RadioProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "size" | "name"
> {
  /** Etiqueta visible, ya traducida. Obligatoria, igual que en `Checkbox`. */
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * Opcion de un `RadioGroup`.
 *
 * Toma el `name` del grupo. Usada fuera de un grupo lanza en desarrollo, porque
 * un radio suelto sin `name` no forma grupo con nadie: parece funcionar y
 * permite marcar varias opciones a la vez.
 */
export function Radio({ label, description, className, id, ref, ...rest }: RadioProps) {
  const group = useContext(RadioGroupContext);
  const baseId = useId();
  const controlId = id ?? `${baseId}-radio`;
  const descriptionId = `${baseId}-description`;
  const hasDescription = description !== undefined && description !== null;

  if (group === null) {
    throw new Error("Radio must be rendered inside a RadioGroup.");
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 inline-flex shrink-0">
          <input
            {...rest}
            ref={ref}
            type="radio"
            id={controlId}
            name={group.name}
            aria-describedby={hasDescription ? descriptionId : undefined}
            className={cn(
              "peer h-5 w-5 appearance-none rounded-pill border bg-surface",
              "transition-colors duration-fast ease-standard",
              FOCUS_VISIBLE_CLASSES,
              "checked:border-brand",
              "disabled:cursor-not-allowed disabled:bg-surface-sunken",
              group.invalid ? "border-danger" : "border-border-strong",
            )}
          />

          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2",
              "rounded-pill bg-brand opacity-0 peer-checked:opacity-100",
            )}
          />
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
    </div>
  );
}
