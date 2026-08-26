import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Drawer } from "./drawer";
import { Modal } from "./modal";

/**
 * Superficies modales.
 *
 * Estas pruebas cubren exactamente lo que motiva usar Radix: nombre accesible,
 * foco atrapado, cierre con Escape y devolucion del foco al disparador. Son las
 * cuatro cosas que se rompen al reimplementar un dialogo a mano y que nadie
 * detecta mirando la pantalla.
 */

function ModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Modal
        open={open}
        onOpenChange={setOpen}
        // Con `trigger`, Radix registra el disparador y le devuelve el foco al
        // cerrar. Es la forma recomendada de abrir un dialogo; el control por
        // estado existe para los casos en que el dialogo lo abre otra cosa (una
        // respuesta del servidor, una ruta).
        trigger={
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Abrir
          </Button>
        }
        title="Confirmar ajuste"
        description="Esta accion queda registrada"
        closeLabel="Cerrar"
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancelar
          </Button>
        }
      >
        <p>Contenido del dialogo</p>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("no esta en el documento mientras esta cerrado", () => {
    render(<ModalHarness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se anuncia como dialogo con nombre y descripcion", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = screen.getByRole("dialog", { name: "Confirmar ajuste" });
    expect(dialog).toHaveAccessibleDescription("Esta accion queda registrada");
  });

  it("mueve el foco dentro del dialogo al abrirse", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("se cierra con Escape y devuelve el foco al disparador", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const trigger = screen.getByRole("button", { name: "Abrir" });
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("el boton de cierre tiene nombre accesible traducido por el consumidor", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    const close = await screen.findByRole("button", { name: "Cerrar" });

    await user.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function DrawerHarness({ side }: { readonly side?: "right" | "left" | "bottom" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Filtros
      </Button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Filtrar participaciones"
        closeLabel="Cerrar panel"
        {...(side === undefined ? {} : { side })}
      >
        <p>Contenido del panel</p>
      </Drawer>
    </>
  );
}

describe("Drawer", () => {
  it("comparte con Modal las garantias de un dialogo modal", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    await user.click(screen.getByRole("button", { name: "Filtros" }));

    const dialog = screen.getByRole("dialog", { name: "Filtrar participaciones" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("acepta el anclaje inferior, que es el recomendado en telefono", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness side="bottom" />);

    await user.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByRole("dialog", { name: "Filtrar participaciones" })).toBeInTheDocument();
  });
});
