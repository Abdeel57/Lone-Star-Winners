import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";

/**
 * Tabla de datos.
 *
 * TRES DECISIONES QUE NO SON COSMETICAS
 * -------------------------------------
 * 1. **La tabla nunca desborda el documento.** Va dentro de un contenedor con
 *    scroll propio. Una pagina que se desplaza en horizontal en un telefono es
 *    inutilizable, y es lo que pasa por defecto con cualquier tabla de cinco
 *    columnas en 360px.
 * 2. **El contenedor con scroll es enfocable** (`tabIndex={0}`) y tiene
 *    `role="region"` con nombre. Sin eso, quien navega solo con teclado no
 *    puede desplazar la tabla: es el criterio 2.1.1 de WCAG, y el fallo mas
 *    comun en tablas con scroll.
 * 3. **`caption` es obligatorio.** Puede ocultarse visualmente, pero tiene que
 *    existir: es lo que dice al lector de pantalla que contiene la tabla antes
 *    de entrar a recorrerla.
 *
 * Este componente no ordena, no filtra y no pagina. Esas operaciones cambian lo
 * que se pide al servidor y su estado pertenece a la pantalla, no a la tabla.
 */

export interface TableContainerProps {
  /**
   * Nombre accesible de la region con scroll, ya traducido. Obligatorio: una
   * region sin nombre no aporta nada al recorrido por landmarks.
   */
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function TableContainer({ label, className, children }: TableContainerProps) {
  return (
    <div
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- una region con scroll DEBE ser enfocable o no hay forma de desplazarla con teclado (WCAG 2.1.1); es el patron recomendado para tablas anchas y la regla no distingue este caso
      tabIndex={0}
      className={cn(
        "w-full overflow-x-auto rounded-lg border border-border",
        FOCUS_VISIBLE_CLASSES,
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TableProps {
  /** Descripcion de la tabla, ya traducida. */
  readonly caption: ReactNode;
  /** Si `false`, el `caption` existe pero se oculta visualmente. */
  readonly captionVisible?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Table({ caption, captionVisible = false, className, children }: TableProps) {
  return (
    <table className={cn("w-full border-collapse text-body-sm", className)}>
      <caption
        className={cn(
          captionVisible ? "px-s4 py-s3 text-left text-body-sm text-text-muted" : "sr-only",
        )}
      >
        {caption}
      </caption>
      {children}
    </table>
  );
}

export interface TableSectionProps {
  readonly className?: string;
  readonly children: ReactNode;
}

export function TableHead({ className, children }: TableSectionProps) {
  return (
    <thead className={cn("border-b border-border bg-surface-sunken", className)}>{children}</thead>
  );
}

export function TableBody({ className, children }: TableSectionProps) {
  return <tbody className={cn("divide-y divide-border", className)}>{children}</tbody>;
}

export interface TableRowProps {
  readonly className?: string;
  readonly children: ReactNode;
}

export function TableRow({ className, children }: TableRowProps) {
  return <tr className={cn("bg-surface", className)}>{children}</tr>;
}

export type TableAlign = "start" | "end";

export interface TableCellProps {
  readonly align?: TableAlign;
  readonly colSpan?: number;
  readonly className?: string;
  readonly children: ReactNode;
}

export interface TableHeaderCellProps extends TableCellProps {
  /**
   * Ambito de la cabecera. `col` para la fila de cabeceras, `row` para la
   * primera celda de cada fila cuando identifica la fila entera.
   */
  readonly scope?: "col" | "row";
}

function alignClass(align: TableAlign | undefined): string {
  return align === "end" ? "text-right" : "text-left";
}

export function TableHeaderCell({
  align,
  colSpan,
  scope = "col",
  className,
  children,
}: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      {...(colSpan === undefined ? {} : { colSpan })}
      className={cn(
        "whitespace-nowrap px-s4 py-s3 text-label font-semibold text-text-muted",
        alignClass(align),
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableCell({ align, colSpan, className, children }: TableCellProps) {
  return (
    <td
      {...(colSpan === undefined ? {} : { colSpan })}
      className={cn("px-s4 py-s3 align-top text-text", alignClass(align), className)}
    >
      {children}
    </td>
  );
}

/** Columna de un `DataTable`. */
export interface DataTableColumn<TRow> {
  /** Identificador estable de la columna. Se usa como `key` de React. */
  readonly id: string;
  /** Cabecera ya traducida. */
  readonly header: ReactNode;
  /** Contenido de la celda para una fila. */
  readonly cell: (row: TRow) => ReactNode;
  readonly align?: TableAlign;
  /**
   * Si `true`, la celda de esta columna se renderiza como `th scope="row"`.
   * Como maximo una columna deberia marcarse asi: es la que IDENTIFICA la fila
   * (un numero de pedido, un nombre) y la que el lector de pantalla usa para
   * situar al usuario al recorrer las demas celdas.
   */
  readonly isRowHeader?: boolean;
}

export interface DataTableProps<TRow> {
  readonly caption: ReactNode;
  readonly captionVisible?: boolean;
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rows: readonly TRow[];
  /** Clave estable de cada fila. Nunca el indice del array. */
  readonly rowKey: (row: TRow) => string;
  /** Que mostrar cuando no hay filas. Normalmente un `EmptyState`. */
  readonly emptyState?: ReactNode;
  /** Nombre accesible de la region con scroll, ya traducido. */
  readonly scrollRegionLabel: string;
  readonly className?: string;
}

/**
 * Tabla construida a partir de una descripcion de columnas.
 *
 * Evita el error mas facil de cometer a mano: que el orden de las cabeceras y
 * el de las celdas se desincronicen tras una edicion. Aqui cada columna define
 * las dos cosas en el mismo sitio.
 */
export function DataTable<TRow>({
  caption,
  captionVisible,
  columns,
  rows,
  rowKey,
  emptyState,
  scrollRegionLabel,
  className,
}: DataTableProps<TRow>) {
  if (rows.length === 0 && emptyState !== undefined && emptyState !== null) {
    return <>{emptyState}</>;
  }

  return (
    <TableContainer label={scrollRegionLabel} {...(className === undefined ? {} : { className })}>
      <Table caption={caption} {...(captionVisible === undefined ? {} : { captionVisible })}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableHeaderCell
                key={column.id}
                {...(column.align === undefined ? {} : { align: column.align })}
              >
                {column.header}
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column) =>
                column.isRowHeader === true ? (
                  <TableHeaderCell
                    key={column.id}
                    scope="row"
                    className="font-medium text-text"
                    {...(column.align === undefined ? {} : { align: column.align })}
                  >
                    {column.cell(row)}
                  </TableHeaderCell>
                ) : (
                  <TableCell
                    key={column.id}
                    {...(column.align === undefined ? {} : { align: column.align })}
                  >
                    {column.cell(row)}
                  </TableCell>
                ),
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
