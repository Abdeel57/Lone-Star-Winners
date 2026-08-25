import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Alert } from "./alert";

describe("Alert", () => {
  it("interrupts for danger and warning, and waits its turn for info and success", () => {
    const { rerender } = render(<Alert tone="danger">Payment could not be completed.</Alert>);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");

    rerender(<Alert tone="info">Entries are subject to the Official Rules.</Alert>);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders the title and the body", () => {
    render(
      <Alert tone="success" title="Order received">
        We sent a confirmation to your email.
      </Alert>,
    );

    expect(screen.getByText("Order received")).toBeInTheDocument();
    expect(screen.getByText("We sent a confirmation to your email.")).toBeInTheDocument();
  });

  it("hides the dismiss button when it was not given an accessible name", () => {
    const onDismiss = vi.fn();
    render(
      <Alert tone="info" onDismiss={onDismiss}>
        Body
      </Alert>,
    );

    // Un boton de solo icono sin nombre accesible seria inservible con lector
    // de pantalla, y este paquete no puede inventarse la traduccion.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dismisses when it has both the handler and the translated label", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Alert tone="info" onDismiss={onDismiss} dismissLabel="Dismiss notification">
        Body
      </Alert>,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
