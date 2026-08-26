"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * Dialogo modal, sobre Radix Dialog.
 *
 * POR QUE RADIX AQUI Y NO EN `Select` NI EN `RadioGroup`
 * ------------------------------------------------------
 * Un modal accesible necesita cosas que el navegador NO da y que casi nadie
 * implementa bien a mano:
 *   - foco atrapado dentro del dialogo mientras esta abierto;
 *   - devolucion del foco al elemento que lo abrio al cerrarse;
 *   - `aria-modal`, `role="dialog"` y ocultacion del resto del arbol para
 *     lectores de pantalla;
 *   - cierre con Escape y bloqueo del scroll de fondo sin que la pagina salte.
 * Reimplementar eso es exactamente donde se cuelan los fallos de accesibilidad.
 *
 * QUE ANADE ESTA ENVOLTURA
 * ------------------------
 * 1. `title` es OBLIGATORIO. Radix avisa en consola si falta; aqui es un error
 *    de compilacion. Un dialogo sin nombre accesible es un agujero anunciado
 *    en el aire para quien usa lector de pantalla.
 * 2. `closeLabel` es OBLIGATORIO. El boton de cerrar es de solo icono, y este
 *    paquete no inventa texto (DEC-021, DEC-022): sin etiqueta traducida no
 *    hay boton que valga.
 * 3. El movimiento se apaga con `motion-reduce`.
 *
 * Este componente no decide NADA de negocio. Un modal que confirma una accion
 * sensible (ajuste manual de entries, descalificacion) recibe su texto y su
 * comportamiento del consumidor; la regla de si esa accion necesita segunda
 * aprobacion vive en la configuracion, no aqui (DEC-032).
 */
export interface ModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Titulo del dialogo, ya traducido. Es su nombre accesible. */
  readonly title: ReactNode;
  /** Descripcion opcional, ya traducida. Se asocia con `aria-describedby`. */
  readonly description?: ReactNode;
  /** Nombre accesible del boton de cierre, ya traducido. */
  readonly closeLabel: string;
  /** Acciones del pie (botones del consumidor). */
  readonly footer?: ReactNode;
  readonly size?: "sm" | "md" | "lg";
  /**
   * Elemento que dispara la apertura. Opcional: un modal tambien puede abrirse
   * de forma controlada desde el estado del consumidor.
   */
  readonly trigger?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

/**
 * `switch` exhaustivo en vez de un objeto indexado: anadir un tamano al tipo
 * deja de compilar aqui en lugar de producir `undefined` en tiempo de
 * ejecucion. Es la misma convencion que ya usa el resto del sistema.
 */
function sizeClass(size: NonNullable<ModalProps["size"]>): string {
  switch (size) {
    case "sm":
      return "sm:max-w-md";
    case "md":
      return "sm:max-w-lg";
    case "lg":
      return "sm:max-w-2xl";
  }
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  footer,
  size = "md",
  trigger,
  className,
  children,
}: ModalProps) {
  const hasDescription = description !== undefined && description !== null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && trigger !== null ? (
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      ) : null}

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-overlay bg-overlay/60",
            "data-[state=open]:animate-lsw-fade-in motion-reduce:animate-none",
          )}
        />

        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-modal w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100svh-2rem)] overflow-y-auto",
            "rounded-lg border border-border bg-surface-raised p-s5 shadow-xl sm:p-s6",
            "data-[state=open]:animate-lsw-fade-in motion-reduce:animate-none",
            sizeClass(size),
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-display text-heading-md font-semibold text-text">
              {title}
            </Dialog.Title>

            <Dialog.Close
              className={cn(
                "-m-1 h-8 w-8 shrink-0 rounded-md p-1 text-text-muted",
                "hover:bg-surface-sunken hover:text-text",
                FOCUS_VISIBLE_CLASSES,
              )}
            >
              <span className="sr-only">{closeLabel}</span>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </Dialog.Close>
          </div>

          {hasDescription ? (
            <Dialog.Description className="mt-s2 text-body-sm text-text-muted">
              {description}
            </Dialog.Description>
          ) : null}

          {children !== undefined && children !== null ? (
            <div className="mt-s4 text-body-md text-text">{children}</div>
          ) : null}

          {footer !== undefined && footer !== null ? (
            <div className="mt-s6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
