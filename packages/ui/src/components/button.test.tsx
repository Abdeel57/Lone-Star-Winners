import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, buttonVariants } from "./button";

describe("Button", () => {
  it("renders its children and defaults to type=button", () => {
    render(<Button>Shop eligible merchandise</Button>);

    const button = screen.getByRole("button", { name: "Shop eligible merchandise" });
    // El valor por defecto del navegador es `submit`, que dentro de un
    // formulario provoca envios accidentales. El componente lo corrige.
    expect(button).toHaveAttribute("type", "button");
  });

  it("keeps its label visible while loading and marks the control as busy", () => {
    render(
      <Button loading loadingLabel="Submitting">
        Continue
      </Button>,
    );

    const button = screen.getByRole("button", { name: /Continue/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // El texto no se sustituye: el componente nunca tiene que inventarse una
    // cadena que no le hayan traducido.
    expect(button).toHaveTextContent("Continue");
    expect(button).toHaveTextContent("Submitting");
  });

  it("does not announce anything extra when no loading label is provided", () => {
    render(<Button loading>Continue</Button>);

    expect(screen.getByRole("button")).toHaveAccessibleName("Continue");
  });

  it("calls onClick when activated with the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Continue
      </Button>,
    );

    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

/**
 * LA ACCION DE COMPRA (DEC-042).
 *
 * Lo que se comprueba no es "que sea roja" -eso lo dice el token- sino las tres
 * propiedades que un cambio de color puede romper sin que nadie lo note: que el
 * texto de encima sea el token calibrado para llevar 4,5:1 sobre ese relleno,
 * que el hover ACLARE en vez de oscurecer, y que la variante no se haya
 * confundido con `danger`, que es el otro rojo del sistema y significa otra
 * cosa.
 */
describe("Button variante accent", () => {
  it("es relleno rojo con el texto que ese relleno admite", () => {
    const className = buttonVariants({ variant: "accent" });

    expect(className).toContain("bg-accent");
    // `text-on-accent` es blanco PURO y mide 5,49:1 sobre #cf1a22. Un
    // `text-text` (blanco calido) o un `text-inverse` (casi negro) aqui serian
    // el mismo boton con otro contraste, y uno de los dos falla AA.
    expect(className).toContain("text-on-accent");
  });

  it("el hover ACLARA y el pulsado oscurece, y ninguno de los dos es `danger`", () => {
    const className = buttonVariants({ variant: "accent" });

    // Sobre fondo oscuro, oscurecer al pasar el raton se lee como desactivar.
    expect(className).toContain("hover:bg-accent-hover");
    // El pulsado es la excepcion documentada: por arriba no queda margen sin
    // bajar de 4,5:1 con el texto blanco.
    expect(className).toContain("active:bg-accent-active");

    // `danger` es el rojo de los ERRORES y sigue siendo suyo. Que se parezcan
    // no los hace el mismo token: si esta variante empezara a usarlo, cambiar
    // el color de un mensaje de error cambiaria el de todos los botones de
    // compra del sitio.
    expect(className).not.toMatch(/(^|\s|:)bg-danger(\s|$)/);
  });

  it("conserva el anillo de foco del sistema", () => {
    // A diferencia de `ink`, esta variante NO reasigna el anillo: el oro de
    // foco separado por el offset del negro de pagina mide 14:1 en su borde
    // interior, y ese borde no depende de la superficie sobre la que se apoye
    // el boton. Reasignar el offset seria ademas fragil: `buttonVariants()` se
    // usa a pelo en varios enlaces, sin pasar por `cn`.
    const className = buttonVariants({ variant: "accent" });

    expect(className).toContain("focus-visible:ring-focus");
    expect(className).toContain("focus-visible:ring-offset-bg");
  });

  it("no toca a las demas variantes", () => {
    // La accion de MARCA sigue siendo dorada. DEC-042 anade un color, no lo
    // sustituye.
    expect(buttonVariants({ variant: "primary" })).toContain("bg-brand");
    expect(buttonVariants({ variant: "primary" })).not.toContain("bg-accent");
  });
});
