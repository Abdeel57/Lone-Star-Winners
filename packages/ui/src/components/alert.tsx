import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

const alertVariants = cva("flex gap-3 rounded-md border p-s4 text-body-sm", {
  variants: {
    tone: {
      info: "border-info/30 bg-info-subtle text-text",
      success: "border-success/30 bg-success-subtle text-text",
      warning: "border-warning/40 bg-warning-subtle text-text",
      danger: "border-danger/40 bg-danger-subtle text-text",
    },
  },
  defaultVariants: {
    tone: "info",
  },
});

export type AlertTone = NonNullable<VariantProps<typeof alertVariants>["tone"]>;

export interface AlertProps {
  readonly tone?: AlertTone;
  /** Titulo opcional, ya traducido por el consumidor. */
  readonly title?: ReactNode;
  readonly children: ReactNode;
  /**
   * Si se pasa junto con `dismissLabel`, se muestra el boton de cierre. Sin
   * `dismissLabel` no se muestra: un boton de solo icono sin nombre accesible
   * es inservible para un lector de pantalla, y este paquete no inventa texto.
   */
  readonly onDismiss?: () => void;
  /** Nombre accesible del boton de cierre, ya traducido. */
  readonly dismissLabel?: string;
  readonly className?: string;
}

/**
 * Mensaje contextual.
 *
 * El rol ARIA depende del tono, no de una prop: `warning` y `danger` son
 * `alert` (interrumpen), `info` y `success` son `status` (esperan a que el
 * lector de pantalla termine). Es la diferencia entre avisar y molestar.
 */
export function Alert({
  tone = "info",
  title,
  children,
  onDismiss,
  dismissLabel,
  className,
}: AlertProps) {
  const assertive = tone === "danger" || tone === "warning";
  const showDismiss = onDismiss !== undefined && dismissLabel !== undefined;

  return (
    <div
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      className={cn(alertVariants({ tone }), className)}
    >
      <AlertIcon tone={tone} />

      <div className="min-w-0 flex-1">
        {title !== undefined && title !== null ? (
          <p className="font-semibold text-text">{title}</p>
        ) : null}
        <div className={cn("text-text-muted", title !== undefined && title !== null && "mt-1")}>
          {children}
        </div>
      </div>

      {showDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            "-m-1 h-8 w-8 shrink-0 rounded-md p-1 text-text-muted",
            "hover:bg-surface/60 hover:text-text",
            FOCUS_VISIBLE_CLASSES,
          )}
        >
          <span className="sr-only">{dismissLabel}</span>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function AlertIcon({ tone }: { readonly tone: AlertTone }) {
  const colorClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-info";

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("mt-0.5 h-5 w-5 shrink-0", colorClass)}
    >
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      {tone === "success" ? (
        <path
          d="M6.5 10.2l2.4 2.4 4.6-5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <path
            d={tone === "info" ? "M10 9.25v4.5" : "M10 6.25v4.75"}
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <circle cx="10" cy={tone === "info" ? 6.5 : 13.75} r="1" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
