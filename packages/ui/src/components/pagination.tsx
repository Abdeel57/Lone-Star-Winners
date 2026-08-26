"use client";

import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * Paginacion.
 *
 * Se renderiza con `button` y notifica al consumidor mediante `onPageChange`;
 * no construye URLs. El motivo es que este paquete no conoce el enrutador:
 * `apps/web` navega SIEMPRE con los envoltorios de `@/i18n/navigation`, porque
 * un enlace de `next/link` perderia el prefijo de idioma. Si un dia hace falta
 * paginacion enlazable (por SEO, o para poder compartir la pagina 3 de un
 * historial), la pantalla envuelve estos controles con sus propios enlaces.
 *
 * `pageLabel` es una FUNCION que el consumidor pasa ya traducida. No se
 * concatena aqui "Page" + numero: en espanol el orden y las preposiciones no
 * coinciden, y concatenar cadenas es como se producen las traducciones que
 * suenan a maquina.
 */

export interface PaginationLabels {
  /** Nombre accesible del `nav`, ya traducido. */
  readonly navigation: string;
  readonly previous: string;
  readonly next: string;
  /** Etiqueta accesible de un numero de pagina, ya traducida. */
  readonly pageLabel: (page: number) => string;
  /** Etiqueta accesible de la pagina actual, ya traducida. */
  readonly currentPageLabel: (page: number) => string;
}

export interface PaginationProps {
  /** Pagina actual, empezando en 1. */
  readonly page: number;
  /** Numero total de paginas. */
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
  readonly labels: PaginationLabels;
  /** Resumen opcional ya traducido ("1-20 de 340"). */
  readonly summary?: ReactNode;
  /** Cuantos numeros mostrar alrededor de la pagina actual. */
  readonly siblingCount?: number;
  readonly className?: string;
}

/**
 * Numeros de pagina a mostrar. `null` representa una elipsis.
 *
 * Funcion pura y exportada para poder probarla: los limites de esta ventana
 * (primera pagina, ultima, ventana cerca de los extremos) son donde aparecen
 * los saltos raros.
 */
export function paginationRange(
  page: number,
  pageCount: number,
  siblingCount = 1,
): readonly (number | null)[] {
  if (pageCount <= 0) return [];

  const current = Math.min(Math.max(1, Math.trunc(page)), pageCount);
  const pages = new Set<number>([1, pageCount, current]);

  for (let offset = 1; offset <= siblingCount; offset += 1) {
    if (current - offset >= 1) pages.add(current - offset);
    if (current + offset <= pageCount) pages.add(current + offset);
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const result: (number | null)[] = [];

  let previous: number | null = null;
  for (const value of sorted) {
    if (previous !== null) {
      const gap = value - previous;
      // Un hueco de UNA sola pagina se rellena con esa pagina, no con una
      // elipsis: los puntos suspensivos ocupan lo mismo que el numero, esconden
      // un destino alcanzable y obligan a un clic de mas para llegar a el.
      if (gap === 2) result.push(previous + 1);
      else if (gap > 2) result.push(null);
    }
    result.push(value);
    previous = value;
  }

  return result;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  labels,
  summary,
  siblingCount = 1,
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null;

  const current = Math.min(Math.max(1, Math.trunc(page)), pageCount);
  const items = paginationRange(current, pageCount, siblingCount);

  return (
    <nav
      aria-label={labels.navigation}
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {summary !== undefined && summary !== null ? (
        <p className="text-body-sm text-text-muted">{summary}</p>
      ) : null}

      <ul className="flex flex-wrap items-center gap-1">
        <li>
          <PaginationButton
            label={labels.previous}
            disabled={current === 1}
            onClick={() => {
              onPageChange(current - 1);
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              focusable="false"
              className="h-4 w-4"
            >
              <path
                d="M12 4.5L6.5 10l5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </PaginationButton>
        </li>

        {items.map((item, index) =>
          item === null ? (
            // La elipsis no es interactiva y no aporta nada al lector de
            // pantalla: los numeros vecinos ya dicen que hay un salto.
            <li key={`gap-${String(index)}`} aria-hidden="true" className="px-2 text-text-subtle">
              &hellip;
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                aria-current={item === current ? "page" : undefined}
                aria-label={
                  item === current ? labels.currentPageLabel(item) : labels.pageLabel(item)
                }
                onClick={() => {
                  onPageChange(item);
                }}
                className={cn(
                  "inline-flex min-h-touch min-w-touch items-center justify-center rounded-md px-3",
                  "text-body-sm tabular-nums",
                  FOCUS_VISIBLE_CLASSES,
                  item === current
                    ? "bg-brand font-semibold text-on-brand"
                    : "text-text-muted hover:bg-surface-sunken hover:text-text",
                )}
              >
                {item}
              </button>
            </li>
          ),
        )}

        <li>
          <PaginationButton
            label={labels.next}
            disabled={current === pageCount}
            onClick={() => {
              onPageChange(current + 1);
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              focusable="false"
              className="h-4 w-4"
            >
              <path
                d="M8 4.5l5.5 5.5L8 15.5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </PaginationButton>
        </li>
      </ul>
    </nav>
  );
}

function PaginationButton({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-touch min-w-touch items-center justify-center rounded-md px-3",
        "text-text-muted hover:bg-surface-sunken hover:text-text",
        FOCUS_VISIBLE_CLASSES,
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  );
}
