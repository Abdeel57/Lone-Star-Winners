import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination, paginationRange, type PaginationLabels } from "./pagination";

const LABELS: PaginationLabels = {
  navigation: "Paginacion",
  previous: "Pagina anterior",
  next: "Pagina siguiente",
  pageLabel: (page) => `Ir a la pagina ${String(page)}`,
  currentPageLabel: (page) => `Pagina ${String(page)}, actual`,
};

describe("paginationRange", () => {
  it("sin paginas no devuelve nada", () => {
    expect(paginationRange(1, 0)).toEqual([]);
  });

  it("con pocas paginas las muestra todas y sin huecos", () => {
    expect(paginationRange(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("en el medio abre hueco por los dos lados", () => {
    expect(paginationRange(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  });

  it("cerca del principio no abre hueco a la izquierda", () => {
    expect(paginationRange(2, 20)).toEqual([1, 2, 3, null, 20]);
  });

  it("cerca del final no abre hueco a la derecha", () => {
    expect(paginationRange(19, 20)).toEqual([1, null, 18, 19, 20]);
  });

  it("una pagina fuera de rango se sujeta a los limites", () => {
    expect(paginationRange(99, 3)).toEqual([1, 2, 3]);
    expect(paginationRange(-4, 3)).toEqual([1, 2, 3]);
  });
});

describe("Pagination", () => {
  it("no se renderiza cuando solo hay una pagina", () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} onPageChange={vi.fn()} labels={LABELS} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("es una region de navegacion con nombre", () => {
    render(<Pagination page={1} pageCount={5} onPageChange={vi.fn()} labels={LABELS} />);
    expect(screen.getByRole("navigation", { name: "Paginacion" })).toBeInTheDocument();
  });

  it("marca la pagina actual con aria-current", () => {
    render(<Pagination page={3} pageCount={5} onPageChange={vi.fn()} labels={LABELS} />);

    const current = screen.getByRole("button", { name: "Pagina 3, actual" });
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("las etiquetas llegan traducidas y no se concatenan aqui", () => {
    // Concatenar "Page" + numero produce traducciones que suenan a maquina: en
    // espanol cambian el orden y las preposiciones.
    render(<Pagination page={1} pageCount={5} onPageChange={vi.fn()} labels={LABELS} />);
    expect(screen.getByRole("button", { name: "Ir a la pagina 2" })).toBeInTheDocument();
  });

  it("desactiva anterior en la primera pagina y siguiente en la ultima", () => {
    const { unmount } = render(
      <Pagination page={1} pageCount={5} onPageChange={vi.fn()} labels={LABELS} />,
    );
    expect(screen.getByRole("button", { name: "Pagina anterior" })).toBeDisabled();
    unmount();

    render(<Pagination page={5} pageCount={5} onPageChange={vi.fn()} labels={LABELS} />);
    expect(screen.getByRole("button", { name: "Pagina siguiente" })).toBeDisabled();
  });

  it("notifica la pagina elegida", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(<Pagination page={2} pageCount={9} onPageChange={onPageChange} labels={LABELS} />);

    await user.click(screen.getByRole("button", { name: "Ir a la pagina 3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: "Pagina anterior" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
