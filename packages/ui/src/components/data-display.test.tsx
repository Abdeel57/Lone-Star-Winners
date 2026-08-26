import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import { StatCard } from "./stat-card";
import { DataTable, type DataTableColumn } from "./table";
import { Timeline, TimelineItem } from "./timeline";

describe("Badge", () => {
  it("el estado siempre se puede leer, no solo ver", () => {
    // WCAG 1.4.1: el color nunca es la unica senal.
    render(<Badge tone="warning">Verificacion en curso</Badge>);
    expect(screen.getByText("Verificacion en curso")).toBeInTheDocument();
  });

  it("no se anuncia como region viva", () => {
    // Un badge es una etiqueta estatica. Lo que cambia y hay que anunciar va en
    // `Alert` o en `Toast`.
    const { container } = render(<Badge>Abierta</Badge>);
    expect(container.querySelector("[role]")).toBeNull();
  });

  it("la version solida invierte el tono en vez de aclararlo", () => {
    // El chip dorado del hero: fondo pleno de marca y texto casi negro. Si
    // alguien lo resolviera con el mismo fondo al 12% que la version tenue, la
    // insignia desapareceria sobre la banda con luz para la que existe.
    const { container } = render(
      <Badge tone="brand" emphasis="solid">
        Abierta
      </Badge>,
    );

    const badge = container.firstElementChild;
    expect(badge?.className).toContain("bg-brand");
    expect(badge?.className).toContain("text-on-brand");
    expect(badge?.className).not.toContain("bg-brand/12");
  });

  it("la forma esquinada sustituye a la pildora, no se suma a ella", () => {
    // Las dos clases de radio a la vez dependerian del orden de la hoja de
    // estilos para decidir la forma, que es como una insignia sale redonda en
    // una pantalla y esquinada en otra.
    const { container } = render(<Badge shape="square">Abierta</Badge>);

    const badge = container.firstElementChild;
    expect(badge?.className).toContain("rounded-sm");
    expect(badge?.className).not.toContain("rounded-pill");
  });

  it("por defecto sigue siendo la insignia de siempre", () => {
    const { container } = render(<Badge tone="brand">Abierta</Badge>);

    const badge = container.firstElementChild;
    expect(badge?.className).toContain("rounded-pill");
    expect(badge?.className).toContain("bg-brand/12");
  });

  it("sobre banda clara ninguna insignia trae la paleta oscura", () => {
    // DEC-039/040, hallazgo F1 de la revision: `tone="neutral"` se resolvia a
    // `bg-surface-raised` (#18181c) con texto claro. Dentro de una tarjeta
    // blanca eso es un bloque casi negro, y era el estado por defecto de todas
    // las tarjetas del catalogo entre promociones.
    for (const emphasis of ["subtle", "solid"] as const) {
      for (const tone of ["neutral", "brand"] as const) {
        const { container, unmount } = render(
          <Badge tone={tone} emphasis={emphasis} surface="light">
            Abierta
          </Badge>,
        );

        const className = container.firstElementChild?.className ?? "";
        const label = `${tone}/${emphasis}`;

        expect(className, label).not.toMatch(
          /(^|\s)(bg-surface-raised|text-text|text-text-muted|border-border-strong)(\s|$)/,
        );
        // Y lleva ALGO de la paleta clara: si el par no tuviera variante
        // definida, cva no aplicaria ninguna clase de color y la insignia
        // quedaria transparente sin que nada fallara.
        expect(className, label).toMatch(/(^|\s)(bg|text|border)-light-/);

        unmount();
      }
    }
  });

  it("el relleno solido claro es de tinta: es el espejo del oscuro", () => {
    // Va encima de una fotografia de estudio claro (el "agotado" del catalogo).
    // Un relleno palido ahi no recortaria nada.
    const { container } = render(
      <Badge tone="neutral" emphasis="solid" surface="light">
        Agotado
      </Badge>,
    );

    const className = container.firstElementChild?.className ?? "";
    expect(className).toContain("bg-light-text");
    expect(className).toContain("text-light-bg");
  });

  it("la banda oscura sigue siendo el defecto", () => {
    const { container } = render(<Badge tone="neutral">Abierta</Badge>);
    expect(container.firstElementChild?.className).toContain("bg-surface-raised");
  });

  /**
   * EL TONO ROJO (DEC-042).
   *
   * Existe en las dos bandas, y la propiedad que hay que vigilar es la misma
   * que en el oro: que el RELLENO y la TINTA sean escalones distintos y que
   * cada superficie use el suyo. Un rojo legible como texto sobre negro
   * (#ff4d47) da 2,5:1 sobre la banda clara, y el rojo de tinta de la banda
   * clara (#bf1620) da 2,9:1 sobre la pagina negra: intercambiarlos produce un
   * fallo de contraste que se ve perfectamente bien en la pantalla del que lo
   * escribio, porque estara mirando la otra banda.
   */
  it("el tono rojo lleva TINTA sobre banda oscura, no el relleno", () => {
    const { container } = render(<Badge tone="accent">Periodo activo</Badge>);

    const className = container.firstElementChild?.className ?? "";
    expect(className).toContain("text-accent-text");
    // `text-accent` seria el relleno (#cf1a22, 3,64:1 sobre la pagina): por
    // debajo del minimo AA para texto.
    expect(className).not.toMatch(/(^|\s)text-accent(\s|$)/);
  });

  it("el tono rojo solido invierte: relleno pleno y texto blanco", () => {
    const { container } = render(
      <Badge tone="accent" emphasis="solid">
        Periodo activo
      </Badge>,
    );

    const className = container.firstElementChild?.className ?? "";
    expect(className).toContain("bg-accent");
    expect(className).toContain("text-on-accent");
  });

  it("sobre banda clara el rojo es el de tinta, no el de la pagina negra", () => {
    const { container } = render(
      <Badge tone="accent" surface="light">
        Periodo activo
      </Badge>,
    );

    const className = container.firstElementChild?.className ?? "";
    expect(className).toContain("text-light-accent");
    expect(className).not.toContain("text-accent-text");
    // Y nada de la paleta oscura dentro de una tarjeta blanca.
    expect(className).not.toMatch(/(^|\s)(bg-surface-raised|text-text|text-text-muted)(\s|$)/);
  });

  it("el rojo solido claro conserva el relleno y cambia el contorno", () => {
    // El relleno #cf1a22 recorta igual sobre blanco que sobre negro; lo que no
    // recorta sobre una fotografia de estudio claro es un contorno del mismo
    // rojo, y por eso el borde pasa al rojo de tinta.
    const { container } = render(
      <Badge tone="accent" emphasis="solid" surface="light">
        Periodo activo
      </Badge>,
    );

    const className = container.firstElementChild?.className ?? "";
    expect(className).toContain("bg-accent");
    expect(className).toContain("text-on-accent");
    expect(className).toContain("border-light-accent");
  });
});

interface Row {
  readonly id: string;
  readonly reference: string;
  readonly entries: string;
}

const ROWS: readonly Row[] = [
  { id: "1", reference: "LSW-10524", entries: "11,000" },
  { id: "2", reference: "LSW-10525", entries: "200" },
];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { id: "reference", header: "Pedido", cell: (row) => row.reference, isRowHeader: true },
  { id: "entries", header: "Participaciones", cell: (row) => row.entries, align: "end" },
];

describe("DataTable", () => {
  function renderTable(rows: readonly Row[] = ROWS) {
    return render(
      <DataTable
        caption="Participaciones por pedido"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        scrollRegionLabel="Tabla de participaciones"
        emptyState={<EmptyState title="Todavia no hay participaciones" />}
      />,
    );
  }

  it("la tabla tiene descripcion accesible aunque no se vea", () => {
    renderTable();
    expect(screen.getByRole("table", { name: "Participaciones por pedido" })).toBeInTheDocument();
  });

  it("la region con scroll es enfocable y tiene nombre", () => {
    // Sin esto, quien navega solo con teclado no puede desplazar una tabla que
    // no cabe en pantalla (WCAG 2.1.1). Es el fallo mas comun en tablas
    // responsive.
    renderTable();

    const region = screen.getByRole("region", { name: "Tabla de participaciones" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("la columna identificadora se marca como cabecera de fila", () => {
    renderTable();

    const rowHeader = screen.getByRole("rowheader", { name: "LSW-10524" });
    expect(rowHeader).toBeInTheDocument();
  });

  it("cabeceras y celdas no se pueden desincronizar", () => {
    // Cada columna define su cabecera y su celda en el mismo sitio.
    renderTable();

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Pedido",
      "Participaciones",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1);
  });

  it("sin filas muestra el estado vacio y no una tabla en blanco", () => {
    // Una tabla vacia con cabeceras se confunde con un fallo de carga.
    renderTable([]);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Todavia no hay participaciones")).toBeInTheDocument();
  });
});

describe("Timeline", () => {
  it("es una lista ordenada, para que se anuncie la posicion de cada paso", () => {
    render(
      <Timeline>
        <TimelineItem title="Abre" status="complete" />
        <TimelineItem title="Cierra" status="current" />
        <TimelineItem title="Completada" isLast />
      </Timeline>,
    );

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("marca el paso actual para tecnologia de asistencia", () => {
    render(
      <Timeline>
        <TimelineItem title="Abre" status="complete" />
        <TimelineItem title="En manos del administrador" status="current" isLast />
      </Timeline>,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });
});

describe("StatCard", () => {
  it("relaciona la cifra con lo que significa", () => {
    const { container } = render(
      <StatCard label="Participaciones activas" value="11,000" hint="Promocion vigente" />,
    );

    expect(container.querySelector("dt")).toHaveTextContent("Participaciones activas");
    expect(container.querySelector("dd")).toHaveTextContent("11,000");
  });

  it("muestra la cifra tal cual llega, sin tocarla", () => {
    // El componente no divide, no redondea y no suma: el dinero es un entero en
    // unidad menor y el formateo ocurre en `apps/web` (DEC-010).
    render(<StatCard label="Valor del premio" value="$45,000.00" />);
    expect(screen.getByText("$45,000.00")).toBeInTheDocument();
  });

  it("puede vivir fuera de una lista de definiciones", () => {
    const { container } = render(<StatCard as="div" label="Pendientes" value="0" />);
    expect(container.querySelector("dl")).toBeNull();
    expect(screen.getByText("Pendientes")).toBeInTheDocument();
  });
});
