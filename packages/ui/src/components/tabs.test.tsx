import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsPanel, TabsTrigger } from "./tabs";

function TabsHarness() {
  const [value, setValue] = useState("entries");

  return (
    <Tabs value={value} onValueChange={setValue} label="Secciones de la cuenta">
      <TabsList>
        <TabsTrigger value="entries">Participaciones</TabsTrigger>
        <TabsTrigger value="orders">Pedidos</TabsTrigger>
        <TabsTrigger value="profile">Perfil</TabsTrigger>
      </TabsList>

      <TabsPanel value="entries">Panel de participaciones</TabsPanel>
      <TabsPanel value="orders">Panel de pedidos</TabsPanel>
      <TabsPanel value="profile">Panel de perfil</TabsPanel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("la lista de pestanas tiene nombre accesible", () => {
    render(<TabsHarness />);
    expect(screen.getByRole("tablist", { name: "Secciones de la cuenta" })).toBeInTheDocument();
  });

  it("solo se muestra el panel de la pestana seleccionada", () => {
    render(<TabsHarness />);

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel de participaciones");
    expect(screen.queryByText("Panel de pedidos")).not.toBeInTheDocument();
  });

  it("las flechas mueven el foco sin activar la pestana", async () => {
    // `activationMode="manual"`: en este producto cada panel pide datos al
    // servidor, y la activacion automatica dispararia peticiones que nadie ha
    // pedido solo por pasar por encima con las flechas.
    const user = userEvent.setup();
    render(<TabsHarness />);

    await user.tab();
    expect(screen.getByRole("tab", { name: "Participaciones" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Pedidos" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel de participaciones");

    await user.keyboard("{Enter}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel de pedidos");
  });

  it("la lista entera es una sola parada de tabulacion", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    await user.tab();
    expect(screen.getByRole("tab", { name: "Participaciones" })).toHaveFocus();

    // La siguiente tabulacion sale de la lista y entra en el panel, no pasa por
    // las otras pestanas.
    await user.tab();
    expect(screen.getByRole("tab", { name: "Pedidos" })).not.toHaveFocus();
  });

  it("marca la pestana seleccionada para tecnologia de asistencia", () => {
    render(<TabsHarness />);

    expect(screen.getByRole("tab", { name: "Participaciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Pedidos" })).toHaveAttribute("aria-selected", "false");
  });
});
