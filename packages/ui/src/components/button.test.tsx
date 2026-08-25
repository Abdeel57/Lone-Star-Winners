import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

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
