import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ toString: () => "", set: () => undefined }),
  headers: () => Promise.resolve(new Headers({ host: "localhost:3000" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { CatalogOrderEditor } from "@/components/admin/catalog-order-editor";
import { IDLE } from "@/lib/action-result";
import { setCatalogOrderAction } from "@/lib/admin/catalog-order-actions";
import { API_PATHS, apiBaseUrl, type AdminCatalogOrderGroup } from "@/lib/api";
import { mockApiServer } from "@/mocks/node";

import esMessages from "../../messages/es-US.json";

/**
 * ORDENAR LA TIENDA DESDE EL PANEL (DEC-088).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que la accion manda a la API el grupo entero en el orden de la pantalla,
 *    y la lista vacia cuando se pide volver al orden automatico.
 * 2. Que una lista vieja (409) se dice con su propio codigo, no con el generico.
 * 3. Que mover no guarda: avisa de los cambios sin guardar y deja deshacerlos.
 * 4. Que la pantalla marca los cuatro destacados de la portada y lo que esta
 *    sin colocar, y que sin permiso de escritura no hay botones.
 *
 * Los productos son fixtures; ninguno es catalogo real del cliente.
 */

const API = apiBaseUrl();

const IDS = {
  gorra: "00000000-0000-4000-8000-000000000001",
  termo: "00000000-0000-4000-8000-000000000002",
  llavero: "00000000-0000-4000-8000-000000000003",
  sudadera: "00000000-0000-4000-8000-000000000004",
  taza: "00000000-0000-4000-8000-000000000005",
} as const;

function item(slug: keyof typeof IDS, position: number | null) {
  const id = Object.entries(IDS).find(([key]) => key === slug)?.[1] ?? "";
  return {
    id,
    slug,
    name: { "es-US": `Mi ${slug}`, "en-US": `My ${slug}` },
    image_url: `/media/${slug}.jpg`,
    price_from: { amount_minor: "2500", currency: "USD" },
    display_position: position,
  };
}

const MANUAL_MERCH: AdminCatalogOrderGroup = {
  kind: "MERCHANDISE",
  manual: true,
  items: [
    item("gorra", 1),
    item("termo", 2),
    item("llavero", 3),
    item("sudadera", 4),
    // Recien publicada: todavia sin colocar.
    item("taza", null),
  ],
};

function orderForm(entries: readonly [string, string][]): FormData {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return form;
}

function renderEditor(group: AdminCatalogOrderGroup, canWrite = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages} timeZone="America/Chicago">
      <CatalogOrderEditor locale="es" group={group} canWrite={canWrite} />
    </NextIntlClientProvider>,
  );
}

function listedNames(): string[] {
  const list = screen.getByRole("list", { name: "Orden de Mercancía" });
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector("p")?.textContent?.replace(/^Lugar \d+:\s*/u, "") ?? "");
}

describe("accion de guardar el orden", () => {
  it("manda el grupo entero, en el orden del formulario", async () => {
    let sent: unknown = null;
    mockApiServer.use(
      http.put(`${API}${API_PATHS.adminCatalogOrder}`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ groups: [] });
      }),
    );

    const result = await setCatalogOrderAction(
      IDLE,
      orderForm([
        ["locale", "es"],
        ["kind", "MERCHANDISE"],
        ["product_id", IDS.termo],
        ["product_id", IDS.gorra],
      ]),
    );

    expect(result.status).toBe("ok");
    expect(sent).toEqual({ kind: "MERCHANDISE", product_ids: [IDS.termo, IDS.gorra] });
  });

  it("volver al orden automatico manda la lista vacia, aunque lleguen productos", async () => {
    let sent: unknown = null;
    mockApiServer.use(
      http.put(`${API}${API_PATHS.adminCatalogOrder}`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ groups: [] });
      }),
    );

    await setCatalogOrderAction(
      IDLE,
      orderForm([
        ["locale", "es"],
        ["kind", "ENTRY_PACKAGE"],
        ["intent", "automatic"],
        ["product_id", IDS.termo],
      ]),
    );

    expect(sent).toEqual({ kind: "ENTRY_PACKAGE", product_ids: [] });
  });

  it("un repetido o un grupo desconocido no llega a la API", async () => {
    let called = false;
    mockApiServer.use(
      http.put(`${API}${API_PATHS.adminCatalogOrder}`, () => {
        called = true;
        return HttpResponse.json({ groups: [] });
      }),
    );

    const repeated = await setCatalogOrderAction(
      IDLE,
      orderForm([
        ["locale", "es"],
        ["kind", "MERCHANDISE"],
        ["product_id", IDS.gorra],
        ["product_id", IDS.gorra],
      ]),
    );
    const unknownKind = await setCatalogOrderAction(
      IDLE,
      orderForm([
        ["locale", "es"],
        ["kind", "SERVICES"],
      ]),
    );

    expect(repeated).toMatchObject({ status: "error", code: "VALIDATION_FAILED" });
    expect(unknownKind).toMatchObject({ status: "error", code: "VALIDATION_FAILED" });
    expect(called).toBe(false);
  });

  it("una lista vieja vuelve con CATALOG_ORDER_STALE, que la pantalla sabe decir", async () => {
    mockApiServer.use(
      http.put(`${API}${API_PATHS.adminCatalogOrder}`, () =>
        HttpResponse.json(
          {
            error: {
              code: "CATALOG_ORDER_STALE",
              details: { unknown_product_ids: [IDS.gorra] },
              request_id: "req-stale",
            },
          },
          { status: 409 },
        ),
      ),
    );

    const result = await setCatalogOrderAction(
      IDLE,
      orderForm([
        ["locale", "es"],
        ["kind", "MERCHANDISE"],
        ["product_id", IDS.gorra],
      ]),
    );

    expect(result).toMatchObject({ status: "error", code: "CATALOG_ORDER_STALE" });
    expect(esMessages.apiErrors.CATALOG_ORDER_STALE).toContain("no se guardó nada");
  });
});

describe("pantalla de ordenar", () => {
  it("ensena el orden de la tienda, los destacados de la portada y lo que esta sin colocar", () => {
    renderEditor(MANUAL_MERCH);

    expect(listedNames()).toEqual(["Mi gorra", "Mi termo", "Mi llavero", "Mi sudadera", "Mi taza"]);
    // Los cuatro primeros de la mercancia salen en la portada (otra vez en la
    // vista previa del celular, que no lleva insignias).
    expect(screen.getAllByText("En portada")).toHaveLength(4);
    expect(screen.getByText("Nuevo: sin colocar")).toBeInTheDocument();
    expect(screen.getByText("Orden manual")).toBeInTheDocument();
  });

  it("mover no guarda: avisa, habilita guardar, cambia lo que se enviaria y se puede deshacer", async () => {
    const user = userEvent.setup();
    const { container } = renderEditor(MANUAL_MERCH);

    const save = screen.getByRole("button", { name: "Guardar orden" });
    expect(save).toBeDisabled();
    expect(screen.queryByText("Tienes cambios sin guardar.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Poner Mi taza el primero" }));

    expect(listedNames()).toEqual(["Mi taza", "Mi gorra", "Mi termo", "Mi llavero", "Mi sudadera"]);
    expect(screen.getByText("Tienes cambios sin guardar.")).toBeInTheDocument();
    // Al guardar quedaran todos colocados: "sin colocar" ya no describe nada.
    expect(screen.queryByText("Nuevo: sin colocar")).toBeNull();
    expect(save).toBeEnabled();
    // Lo que manda el formulario es el orden de la pantalla.
    const sent = [...container.querySelectorAll<HTMLInputElement>('input[name="product_id"]')].map(
      (input) => input.value,
    );
    expect(sent).toEqual([IDS.taza, IDS.gorra, IDS.termo, IDS.llavero, IDS.sudadera]);

    await user.click(screen.getByRole("button", { name: "Bajar Mi taza" }));
    expect(listedNames()[1]).toBe("Mi taza");

    await user.click(screen.getByRole("button", { name: "Deshacer cambios" }));
    expect(listedNames()).toEqual(["Mi gorra", "Mi termo", "Mi llavero", "Mi sudadera", "Mi taza"]);
    expect(save).toBeDisabled();
  });

  it("el primero no sube y el ultimo no baja", () => {
    renderEditor(MANUAL_MERCH);

    expect(screen.getByRole("button", { name: "Subir Mi gorra" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Poner Mi gorra el primero" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Mi taza" })).toBeDisabled();
  });

  it("volver al orden automatico pide confirmacion en el sitio antes de enviar", async () => {
    const user = userEvent.setup();
    renderEditor(MANUAL_MERCH);

    await user.click(screen.getByRole("button", { name: "Volver al orden automático" }));

    expect(screen.getByText("¿Volver al orden automático?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, volver al automático" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("¿Volver al orden automático?")).toBeNull();
  });

  it("un grupo en automatico lo explica y no ofrece volver al automatico", () => {
    renderEditor({
      ...MANUAL_MERCH,
      manual: false,
      items: MANUAL_MERCH.items.map((entry) => ({ ...entry, display_position: null })),
    });

    expect(screen.getByText("Orden automático")).toBeInTheDocument();
    expect(screen.queryByText("Nuevo: sin colocar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Volver al orden automático" })).toBeNull();
  });

  it("sin permiso de escritura se ve el orden pero no hay botones", () => {
    renderEditor(MANUAL_MERCH, false);

    expect(listedNames()).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /^Subir / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar orden" })).toBeNull();
  });
});
