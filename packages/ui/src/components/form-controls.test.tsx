import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";
import { FormField } from "./form-field";
import { Radio, RadioGroup } from "./radio-group";
import { Select } from "./select";
import { Textarea } from "./textarea";

/**
 * Controles de formulario.
 *
 * Lo que se prueba aqui no es que pinten: es que el cableado de accesibilidad
 * exista. Un campo sin nombre accesible, un error que no se anuncia o un grupo
 * de radios sin leyenda son fallos invisibles en pantalla y bloqueantes para
 * quien usa lector de pantalla.
 */

describe("Select", () => {
  it("toma su nombre accesible del FormField que lo envuelve", () => {
    render(
      <FormField label="Estado del pedido">
        <Select>
          <option value="all">Todos</option>
          <option value="active">Activos</option>
        </Select>
      </FormField>,
    );

    expect(screen.getByRole("combobox", { name: "Estado del pedido" })).toBeInTheDocument();
  });

  it("hereda descripcion, invalidez y obligatoriedad del FormField", () => {
    render(
      <FormField label="Estado" description="Filtra el historial" error="Elige un valor" required>
        <Select>
          <option value="">-</option>
        </Select>
      </FormField>,
    );

    const control = screen.getByRole("combobox", { name: "Estado" });
    expect(control).toBeRequired();
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(/Filtra el historial/);
    expect(control).toHaveAccessibleDescription(/Elige un valor/);
  });

  it("es un select nativo, no un widget reimplementado", () => {
    // La decision de mobile-first depende de esto: el selector nativo del
    // sistema operativo solo aparece con un `select` real.
    render(
      <FormField label="Idioma">
        <Select>
          <option value="en">English</option>
        </Select>
      </FormField>,
    );

    expect(screen.getByRole("combobox", { name: "Idioma" }).tagName).toBe("SELECT");
  });

  it("notifica el cambio de valor", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <FormField label="Origen">
        <Select defaultValue="purchase" onChange={onChange}>
          <option value="purchase">Compra</option>
          <option value="amoe">AMOE</option>
        </Select>
      </FormField>,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Origen" }), "amoe");
    expect(onChange).toHaveBeenCalled();
  });
});

describe("Textarea", () => {
  it("se cablea con el FormField igual que el resto de controles", () => {
    render(
      <FormField label="Motivo del ajuste" description="Queda registrado en la auditoria">
        <Textarea />
      </FormField>,
    );

    const control = screen.getByRole("textbox", { name: "Motivo del ajuste" });
    expect(control.tagName).toBe("TEXTAREA");
    expect(control).toHaveAccessibleDescription(/Queda registrado/);
  });

  it("respeta el numero de filas que pide el consumidor", () => {
    render(
      <FormField label="Notas">
        <Textarea rows={8} />
      </FormField>,
    );

    expect(screen.getByRole("textbox", { name: "Notas" })).toHaveAttribute("rows", "8");
  });
});

describe("Checkbox", () => {
  it("trae su propia etiqueta asociada", () => {
    render(<Checkbox label="He leido las Reglas Oficiales" />);
    expect(
      screen.getByRole("checkbox", { name: "He leido las Reglas Oficiales" }),
    ).toBeInTheDocument();
  });

  it("al hacer clic en la etiqueta se marca la casilla", async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Recordar mi idioma" />);

    const control = screen.getByRole("checkbox", { name: "Recordar mi idioma" });
    expect(control).not.toBeChecked();

    await user.click(screen.getByText("Recordar mi idioma"));
    expect(control).toBeChecked();
  });

  it("anuncia el error y marca la casilla como invalida", () => {
    render(<Checkbox label="Confirmo" error="Hay que confirmar para continuar" />);

    const control = screen.getByRole("checkbox", { name: "Confirmo" });
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(/Hay que confirmar/);
    expect(screen.getByRole("alert")).toHaveTextContent("Hay que confirmar para continuar");
  });
});

describe("RadioGroup", () => {
  function renderGroup() {
    return render(
      <RadioGroup label="Metodo de participacion" description="Elige uno">
        <Radio value="purchase" label="Con compra" defaultChecked />
        <Radio value="free" label="Metodo gratuito" />
      </RadioGroup>,
    );
  }

  it("agrupa las opciones bajo una leyenda", () => {
    renderGroup();
    expect(screen.getByRole("group", { name: /Metodo de participacion/ })).toBeInTheDocument();
  });

  it("todas las opciones comparten el mismo name, que es lo que forma el grupo", () => {
    renderGroup();

    const first = screen.getByRole("radio", { name: "Con compra" });
    const second = screen.getByRole("radio", { name: "Metodo gratuito" });

    expect(first).toHaveAttribute("name");
    expect(first.getAttribute("name")).toBe(second.getAttribute("name"));
  });

  it("seleccionar una opcion deselecciona la otra", async () => {
    const user = userEvent.setup();
    renderGroup();

    const free = screen.getByRole("radio", { name: "Metodo gratuito" });
    await user.click(free);

    expect(free).toBeChecked();
    expect(screen.getByRole("radio", { name: "Con compra" })).not.toBeChecked();
  });

  it("el error del grupo se asocia al grupo entero, no a una opcion", () => {
    render(
      <RadioGroup label="Metodo" error="Selecciona un metodo">
        <Radio value="a" label="A" />
      </RadioGroup>,
    );

    const group = screen.getByRole("group", { name: /Metodo/ });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription(/Selecciona un metodo/);
  });

  it("un Radio fuera de su grupo falla en vez de fingir que funciona", () => {
    // Un radio suelto sin `name` no forma grupo con nadie: parecen radios pero
    // permiten marcar varios a la vez. Es mejor que reviente en desarrollo.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Radio value="a" label="Suelto" />)).toThrow();

    consoleError.mockRestore();
  });
});
