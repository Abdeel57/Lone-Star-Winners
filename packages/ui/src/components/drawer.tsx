"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * Panel lateral o inferior, sobre Radix Dialog.
 *
 * Comparte primitiva con `Modal` a proposito: un drawer ES un dialogo modal, y
 * necesita exactamente las mismas garantias (foco atrapado, devolucion del
 * foco, Escape, `aria-modal`). Lo unico que cambia es de donde entra y como
 * ocupa la pantalla. Tener dos implementaciones distintas del mismo patron seria
 * duplicar la parte dificil.
 *
 * Donde se usa: navegacion en movil, filtros de tienda, y el detalle de una
 * fila del admin cuando la tabla no cabe en pantalla (una tabla densa se
 * convierte en tarjetas mas drawer, nunca en scroll horizontal ilegible).
 *
 * `side="bottom"` es el modo recomendado en telefono: el pulgar llega, y no
 * compite con el gesto de retroceso lateral del sistema.
 */
export type DrawerSide = "right" | "left" | "bottom";

export interface DrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Titulo del panel, ya traducido. Es su nombre accesible. Obligatorio. */
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Nombre accesible del boton de cierre, ya traducido. Obligatorio. */
  readonly closeLabel: string;
  readonly side?: DrawerSide;
  readonly footer?: ReactNode;
  readonly trigger?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** `switch` exhaustivo: un lado nuevo obliga a decidir aqui como entra. */
function sideClass(side: DrawerSide): string {
  switch (side) {
    case "right":
      return "inset-y-0 right-0 h-svh w-full max-w-md border-l data-[state=open]:animate-lsw-slide-in-right";
    case "left":
      return "inset-y-0 left-0 h-svh w-full max-w-md border-r data-[state=open]:animate-lsw-slide-in-left";
    case "bottom":
      return "inset-x-0 bottom-0 max-h-[85svh] w-full rounded-t-xl border-t data-[state=open]:animate-lsw-slide-in-bottom";
  }
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  side = "right",
  footer,
  trigger,
  className,
  children,
}: DrawerProps) {
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
            "fixed z-modal flex flex-col border-border bg-surface-raised shadow-xl",
            "motion-reduce:animate-none",
            sideClass(side),
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-s5">
            <Dialog.Title className="font-display text-heading-sm font-semibold text-text">
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
            <Dialog.Description className="px-s5 pt-s4 text-body-sm text-text-muted">
              {description}
            </Dialog.Description>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-s5 text-body-md text-text">
            {children}
          </div>

          {footer !== undefined && footer !== null ? (
            <div className="flex flex-col-reverse gap-3 border-t border-border p-s5 sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
