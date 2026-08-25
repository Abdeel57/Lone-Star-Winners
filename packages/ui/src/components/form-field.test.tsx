import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "./form-field";
import { Input } from "./input";

describe("FormField", () => {
  it("associates the label with the control without repeating ids by hand", () => {
    render(
      <FormField label="Email">
        <Input type="email" />
      </FormField>,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "email");
  });

  it("links the description through aria-describedby", () => {
    render(
      <FormField label="Email" description="We only use it to send your order updates.">
        <Input type="email" />
      </FormField>,
    );

    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();

    const description = describedBy === null ? null : document.getElementById(describedBy);
    expect(description).toHaveTextContent("We only use it to send your order updates.");
  });

  it("marks the control invalid, announces the error and describes the control with it", () => {
    render(
      <FormField label="Email" description="Helper text" error="Enter a valid email address.">
        <Input type="email" />
      </FormField>,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid email address.");

    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toContain(alert.id);
  });

  it("propagates required to the control and only shows the hint it was given", () => {
    const { rerender } = render(
      <FormField label="Email" required>
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByLabelText(/Email/)).toBeRequired();
    // Sin `requiredHint` no se pinta ningun marcador: el paquete no inventa
    // texto ni simbolos que despues nadie pueda traducir.
    expect(screen.getByText("Email").textContent).toBe("Email");

    rerender(
      <FormField label="Email" required requiredHint="Required">
        <Input type="email" />
      </FormField>,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("keeps the label and the control wired together when the id is fixed from outside", () => {
    render(
      <FormField label="Email" controlId="checkout-email">
        <Input type="email" />
      </FormField>,
    );

    // El `id` se fija en el campo, no en el control: asi el `htmlFor` de la
    // etiqueta y el `id` del input no pueden desincronizarse.
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "checkout-email");
  });
});
