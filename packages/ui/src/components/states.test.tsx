import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { Skeleton, SkeletonText } from "./skeleton";

describe("EmptyState", () => {
  it("is not announced as an error", () => {
    render(
      <EmptyState
        title="No entries yet"
        description="Entries appear here once an eligible order is confirmed."
      />,
    );

    expect(screen.getByRole("heading", { name: "No entries yet" })).toBeInTheDocument();
    // "Todavia no tienes participaciones" y "no hemos podido cargarlas" son
    // mensajes distintos: confundirlos destruye la confianza del participante.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("en tono claro no queda una sola clase de la paleta oscura", () => {
    // DEC-039/040: la banda clara del catalogo se pinta TAMBIEN cuando no hay
    // articulos -si desapareciera, la pagina saltaria de blanco a negro justo en
    // el estado vacio- asi que este componente cae dentro de ella. En paleta
    // oscura seria un panel casi negro con texto blanco sobre blanco calido.
    const { container } = render(
      <EmptyState
        tone="light"
        title="No merchandise matches this filter"
        description="Try again"
      />,
    );

    const classNames = [...container.querySelectorAll<HTMLElement>("[class]")].map(
      (node) => node.className,
    );

    for (const className of classNames) {
      expect(className).not.toMatch(
        /(^|\s)(bg-surface|text-text|text-text-muted|text-text-subtle|border-border-strong)(\s|$)/,
      );
    }

    expect(container.firstElementChild?.className).toContain("bg-light-surface");
  });
});

describe("ErrorState", () => {
  it("is announced as an alert and shows the request id for support", () => {
    render(
      <ErrorState
        title="We could not load your entries"
        description="Try again in a moment."
        requestIdLabel="Reference"
        requestId="req_0000000000"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("We could not load your entries");
    expect(alert).toHaveTextContent("Reference");
    expect(alert).toHaveTextContent("req_0000000000");
  });

  it("omits the reference block when the API did not return one", () => {
    render(<ErrorState title="We could not load your entries" requestIdLabel="Reference" />);

    expect(screen.getByRole("alert")).not.toHaveTextContent("Reference");
  });
});

describe("Skeleton", () => {
  it("stays out of the accessibility tree", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);

    const node = container.firstElementChild;
    expect(node).not.toBeNull();
    expect(node).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the requested number of simulated lines", () => {
    const { container } = render(<SkeletonText lines={4} />);

    expect(container.querySelectorAll("span[aria-hidden='true'] > span")).toHaveLength(4);
  });
});
