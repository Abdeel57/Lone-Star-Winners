import { Card, DataTable, type DataTableColumn } from "@lsw/ui";
import type { ReactNode } from "react";

/**
 * Listado del panel que es TABLA en pantalla ancha y TARJETAS en el telefono.
 *
 * POR QUE NO BASTA CON LA TABLA
 * -----------------------------
 * `DataTable` ya evita el desbordamiento -va en una region con scroll propio-,
 * y para una cola de revision con dos columnas eso es suficiente. Pero un
 * catalogo con nombre, SKU, estado, precio, existencias y fecha son seis
 * columnas, y en 360px una tabla de seis columnas es una franja de 90px que
 * hay que arrastrar para leer cada fila. Quien da de alta mercancia desde el
 * telefono -que es el caso que pidio el cliente- necesita ver cada producto
 * entero de un vistazo, y eso es una tarjeta.
 *
 * UNA SOLA DESCRIPCION DE COLUMNAS
 * --------------------------------
 * Las dos formas se pintan a partir de las MISMAS columnas: la primera es el
 * titulo de la tarjeta y las demas son pares etiqueta/valor. Mantener dos
 * listas -una para la tabla y otra para las tarjetas- garantiza que un dia
 * una columna nueva aparezca en el escritorio y no en el telefono.
 *
 * El corte esta en `md`, que es donde seis columnas caben sin arrastrar. Las
 * dos formas van en el HTML y se muestra una u otra con CSS: es lo unico que
 * funciona en el render del servidor, que no sabe cuanto mide la pantalla.
 */
export function ResponsiveRecords<TRow>({
  caption,
  scrollRegionLabel,
  rows,
  rowKey,
  columns,
  emptyState,
}: {
  readonly caption: string;
  readonly scrollRegionLabel: string;
  readonly rows: readonly TRow[];
  readonly rowKey: (row: TRow) => string;
  /** La PRIMERA columna es la que identifica la fila y titula la tarjeta. */
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly emptyState: ReactNode;
}) {
  if (rows.length === 0) return <>{emptyState}</>;

  const [primary, ...secondary] = columns;
  if (primary === undefined) return null;

  return (
    <>
      <ul className="flex list-none flex-col gap-s3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <Card elevation="flat" padding="md">
              <div className="text-body-md font-medium text-text">{primary.cell(row)}</div>

              <dl className="mt-s3 grid grid-cols-2 gap-x-s4 gap-y-s2 text-body-sm">
                {secondary.map((column) => (
                  <div key={column.id} className="min-w-0">
                    <dt className="text-caption uppercase tracking-wide text-text-subtle">
                      {column.header}
                    </dt>
                    <dd className="mt-s1 break-words text-text">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <DataTable<TRow>
          caption={caption}
          scrollRegionLabel={scrollRegionLabel}
          rows={rows}
          rowKey={rowKey}
          columns={columns}
        />
      </div>
    </>
  );
}
