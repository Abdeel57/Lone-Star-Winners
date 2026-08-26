import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./icon-button";
import { MediaFrame } from "./media-frame";

/**
 * Primitivas de medios y de accion por icono.
 *
 * Las dos reglas del paquete que estos tests protegen:
 *
 * 1. Ningun componente contiene texto visible: todo llega traducido por props,
 *    incluidos los nombres accesibles.
 * 2. Un control de solo icono SIN nombre accesible no puede existir. Aqui el
 *    tipo ya lo impide; el test comprueba que ademas llega al DOM por las dos
 *    vias que usan los lectores de pantalla y el control por voz.
 */

const DOT = <span data-testid="icon" />;

describe("IconButton", () => {
  it("expone el nombre accesible que recibe", () => {
    render(<IconButton label="Quitar" icon={DOT} />);
    expect(screen.getByRole("button", { name: "Quitar" })).toBeInTheDocument();
  });

  it("el nombre viaja como `aria-label` Y como texto oculto", () => {
    // Los dos, no uno: `aria-label` sirve al lector de pantalla, y el texto
    // oculto es lo que hace que funcione el control por voz ("pulsa Quitar") y
    // la traduccion automatica del navegador.
    render(<IconButton label="Quitar" icon={DOT} />);

    const button = screen.getByRole("button", { name: "Quitar" });
    expect(button).toHaveAttribute("aria-label", "Quitar");
    expect(button.textContent).toContain("Quitar");
  });

  it("el icono queda fuera del arbol de accesibilidad", () => {
    render(<IconButton label="Quitar" icon={DOT} />);
    expect(screen.getByTestId("icon").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("por defecto NO es un boton de envio", () => {
    // El valor por defecto del navegador es `submit`, que dentro de un
    // formulario provoca envios accidentales.
    render(<IconButton label="Quitar" icon={DOT} />);
    expect(screen.getByRole("button", { name: "Quitar" })).toHaveAttribute("type", "button");
  });

  it("es alcanzable y accionable con teclado", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<IconButton label="Quitar" icon={DOT} onClick={onClick} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Quitar" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("deshabilitado no se acciona", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<IconButton label="Quitar" icon={DOT} onClick={onClick} disabled />);
    await user.click(screen.getByRole("button", { name: "Quitar" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("MediaFrame", () => {
  it("reserva la proporcion aunque no haya contenido", () => {
    // Es la razon de existir del componente: sin proporcion reservada, la
    // rejilla de productos se reordena segun cargan las imagenes y en movil eso
    // significa pulsar el articulo equivocado.
    const { container } = render(<MediaFrame />);
    expect(container.firstElementChild?.className).toContain("aspect-square");
  });

  it("cada proporcion produce una clase distinta", () => {
    const square = render(<MediaFrame ratio="square" />).container.firstElementChild?.className;
    const portrait = render(<MediaFrame ratio="portrait" />).container.firstElementChild?.className;
    const wide = render(<MediaFrame ratio="wide" />).container.firstElementChild?.className;

    expect(new Set([square, portrait, wide]).size).toBe(3);
  });

  it("sin contenido y sin etiqueta no inventa ningun texto", () => {
    const { container } = render(<MediaFrame />);
    expect(container.textContent).toBe("");
  });

  it("muestra la etiqueta de hueco vacio que recibe traducida", () => {
    render(<MediaFrame emptyLabel="Sin imagen" />);
    expect(screen.getByText("Sin imagen")).toBeInTheDocument();
  });

  it("el tono decide el fondo del marco (DEC-039)", () => {
    // La banda clara de mercancia y la oscura del resto del sitio conviven en
    // la misma pagina. Si el marco no distinguiera, un articulo sin foto en el
    // catalogo seria un rectangulo casi negro dentro de una tarjeta blanca.
    const dark = render(<MediaFrame />).container.firstElementChild?.className ?? "";
    const light = render(<MediaFrame tone="light" />).container.firstElementChild?.className ?? "";

    expect(dark).toContain("bg-surface-sunken");
    expect(light).toContain("bg-light-surface-sunken");
    expect(light).not.toContain("bg-surface-sunken ");
  });

  it("el texto de hueco vacio cambia de tinta con el tono", () => {
    // Es lo unico que se LEE en un marco sin imagen, y el token oscuro sobre el
    // fondo claro se queda en 3,2:1: por debajo del minimo AA. Esta es la razon
    // de que el tono sea una prop y no una clase que ponga el consumidor: el
    // color de este texto vive dentro del componente.
    const { rerender } = render(<MediaFrame emptyLabel="Sin imagen" />);
    expect(screen.getByText("Sin imagen").className).toContain("text-text-subtle");

    rerender(<MediaFrame tone="light" emptyLabel="Sin imagen" />);
    expect(screen.getByText("Sin imagen").className).toContain("text-light-text-muted");
  });

  it("con contenido no pinta la etiqueta de hueco vacio", () => {
    render(
      <MediaFrame emptyLabel="Sin imagen">
        <img src="https://example.test/a.png" alt="Camiseta" />
      </MediaFrame>,
    );

    expect(screen.getByRole("img", { name: "Camiseta" })).toBeInTheDocument();
    expect(screen.queryByText("Sin imagen")).not.toBeInTheDocument();
  });
});
