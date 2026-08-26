import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Toast, ToastProvider, ToastViewport } from "./toast";

function ToastHarness({ tone }: { readonly tone?: "info" | "danger" }) {
  const [open, setOpen] = useState(false);

  return (
    <ToastProvider label="Avisos">
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Guardar
      </Button>

      <Toast
        open={open}
        onOpenChange={setOpen}
        title="Cambios guardados"
        description="Tu idioma preferido se ha actualizado"
        closeLabel="Descartar aviso"
        {...(tone === undefined ? {} : { tone })}
      />

      <ToastViewport label="Avisos ({hotkey})" />
    </ToastProvider>
  );
}

/**
 * Cortesia con la que Radix anuncia el aviso.
 *
 * El anuncio NO lo hace el propio aviso: Radix monta un nodo oculto aparte
 * (fuera del aviso) con `role="status"` y la cortesia que corresponda, y le
 * pone el texto un fotograma despues. Por eso se busca por `aria-live` y no
 * por contenido: en el instante en que se comprueba, el nodo puede estar
 * todavia vacio.
 */
function announcePoliteness(): string | null {
  const node = document.querySelector('[role="status"][aria-live]');
  return node === null ? null : node.getAttribute("aria-live");
}

describe("Toast", () => {
  it("no aparece hasta que se abre", () => {
    render(<ToastHarness />);
    expect(screen.queryByText("Cambios guardados")).not.toBeInTheDocument();
  });

  it("se anuncia con titulo y descripcion", async () => {
    const user = userEvent.setup();
    render(<ToastHarness />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Cambios guardados")).toBeInTheDocument();
    expect(screen.getByText("Tu idioma preferido se ha actualizado")).toBeInTheDocument();
  });

  it("la region de avisos usa la etiqueta traducida por el consumidor", async () => {
    // Radix trae DOS textos por defecto en ingles y en sitios distintos:
    // "Notification" en el Provider y "Notifications ({hotkey})" en el
    // Viewport. Ninguno es visible en pantalla, asi que un olvido no se
    // detecta mirando: solo lo oye quien usa lector de pantalla. Por eso las
    // dos envolturas hacen obligatoria su etiqueta (DEC-021).
    const user = userEvent.setup();
    render(<ToastHarness />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Cambios guardados");

    // El marcador `{hotkey}` lo sustituye Radix por el atajo real.
    expect(screen.getByRole("region", { name: "Avisos (F8)" })).toBeInTheDocument();
  });

  it("se puede descartar con un boton que tiene nombre accesible", async () => {
    const user = userEvent.setup();
    render(<ToastHarness />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Cambios guardados");

    await user.click(screen.getByRole("button", { name: "Descartar aviso" }));
    expect(screen.queryByText("Cambios guardados")).not.toBeInTheDocument();
  });

  it("un aviso de error interrumpe al lector de pantalla y uno normal no", async () => {
    // Radix no cambia el `role` del aviso: siempre es `status`. Lo que cambia
    // segun `type` es la CORTESIA (`aria-live`) del nodo oculto que hace el
    // anuncio. Un error interrumpe lo que se este leyendo; una confirmacion
    // espera su turno.
    const user = userEvent.setup();
    const { unmount } = render(<ToastHarness />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Cambios guardados");
    expect(announcePoliteness()).toBe("polite");

    unmount();

    render(<ToastHarness tone="danger" />);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Cambios guardados");
    expect(announcePoliteness()).toBe("assertive");
  });
});
