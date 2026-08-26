"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * Avisos efimeros, sobre Radix Toast.
 *
 * Se usa Radix porque un toast correcto tiene un ciclo de vida que casi nadie
 * implementa entero: region `aria-live` con la cortesia adecuada, pausa del
 * temporizador al pasar el raton o al recibir foco, atajo de teclado para
 * saltar a los avisos (F8), y orden de anuncio estable cuando llegan varios.
 *
 * REGLA DE PRODUCTO, NO DE COMPONENTE
 * -----------------------------------
 * Un toast desaparece solo. Por eso NUNCA puede ser el unico sitio donde se
 * comunica algo que importa: un saldo de participaciones, el resultado de un
 * envio AMOE, un error de pago. Eso va en la pagina, con `Alert` o con un
 * estado propio. El toast es para confirmaciones de bajo riesgo.
 *
 * `duration` por defecto: 6 segundos. Por debajo de cinco, quien lea despacio o
 * use lector de pantalla no llega.
 */

export interface ToastProviderProps {
  /**
   * Palabra con la que se PRESENTA cada aviso al lector de pantalla, ya
   * traducida (por ejemplo "Aviso" / "Notification"). Obligatoria.
   *
   * OJO: Radix tiene DOS textos por defecto en ingles y son distintos. Este es
   * el del `Provider` ("Notification"), que precede al contenido anunciado. El
   * otro es el de `ToastViewport` ("Notifications ({hotkey})"), que da nombre a
   * la region. Ambos se hacen obligatorios en estas envolturas: uno solo dejaria
   * la mitad del producto en ingles sin que nadie lo viera en pantalla, porque
   * ninguno de los dos textos es visible (DEC-021).
   */
  readonly label: string;
  readonly duration?: number;
  readonly children: ReactNode;
}

export function ToastProvider({ label, duration = 6000, children }: ToastProviderProps) {
  return (
    <ToastPrimitive.Provider label={label} duration={duration} swipeDirection="right">
      {children}
    </ToastPrimitive.Provider>
  );
}

export interface ToastViewportProps {
  /**
   * Nombre accesible de la REGION de avisos, ya traducido. Obligatorio, por el
   * mismo motivo que el `label` del `Provider`: el valor por defecto de Radix es
   * la cadena inglesa "Notifications ({hotkey})".
   *
   * Puede contener el marcador `{hotkey}`, que Radix sustituye por el atajo de
   * teclado que salta a los avisos (F8). Merece la pena incluirlo: es la unica
   * forma de que quien navega con teclado sepa que ese atajo existe.
   */
  readonly label: string;
  readonly className?: string;
}

/**
 * Contenedor donde aparecen los avisos.
 *
 * En movil se ancla ABAJO y a ancho completo; en escritorio, arriba a la
 * derecha. Un aviso anclado arriba en un telefono cae justo debajo de la barra
 * del navegador y suele quedar medio tapado.
 */
export function ToastViewport({ label, className }: ToastViewportProps) {
  return (
    <ToastPrimitive.Viewport
      label={label}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-toast flex max-h-svh w-full flex-col gap-2 p-s4",
        "sm:bottom-auto sm:left-auto sm:top-0 sm:w-full sm:max-w-sm",
        "outline-none",
        className,
      )}
    />
  );
}

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Titulo del aviso, ya traducido. */
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly tone?: ToastTone;
  /** Accion opcional. `actionAltText` es obligatorio si se pasa. */
  readonly action?: ReactNode;
  /**
   * Alternativa textual de la accion, ya traducida. Radix la exige: describe
   * como realizar la misma accion sin el toast, para quien no llega a tiempo.
   */
  readonly actionAltText?: string;
  /** Nombre accesible del boton de cierre, ya traducido. Obligatorio. */
  readonly closeLabel: string;
  readonly duration?: number;
  readonly className?: string;
}

function toneClass(tone: ToastTone): string {
  switch (tone) {
    case "info":
      return "border-info/30";
    case "success":
      return "border-success/30";
    case "warning":
      return "border-warning/40";
    case "danger":
      return "border-danger/40";
  }
}

export function Toast({
  open,
  onOpenChange,
  title,
  description,
  tone = "info",
  action,
  actionAltText,
  closeLabel,
  duration,
  className,
}: ToastProps) {
  const hasDescription = description !== undefined && description !== null;
  const showAction = action !== undefined && action !== null && actionAltText !== undefined;

  return (
    <ToastPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      // `foreground` interrumpe al lector de pantalla; `background` espera. Un
      // error si interrumpe, una confirmacion no.
      type={tone === "danger" || tone === "warning" ? "foreground" : "background"}
      {...(duration === undefined ? {} : { duration })}
      className={cn(
        "flex items-start gap-3 rounded-md border bg-surface-raised p-s4 shadow-lg",
        "data-[state=open]:animate-lsw-fade-in motion-reduce:animate-none",
        toneClass(tone),
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-body-sm font-semibold text-text">
          {title}
        </ToastPrimitive.Title>

        {hasDescription ? (
          <ToastPrimitive.Description className="mt-1 text-body-sm text-text-muted">
            {description}
          </ToastPrimitive.Description>
        ) : null}
      </div>

      {showAction ? (
        <ToastPrimitive.Action asChild altText={actionAltText}>
          {action}
        </ToastPrimitive.Action>
      ) : null}

      <ToastPrimitive.Close
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
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
