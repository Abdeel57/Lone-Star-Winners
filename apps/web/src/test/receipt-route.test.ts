// @vitest-environment node
//
// Un manejador de ruta corre en Node, con el `Request`/`Response` de Node. Ver
// la misma nota en `media-route.test.ts`.

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/receipts/[file]/route";
import { apiBaseUrl } from "@/lib/api";
import { mockApiServer } from "@/mocks/node";

/**
 * DEC-103: `/receipts/<pedido>.pdf`.
 *
 *   1. Un nombre que no sea `<uuid>.pdf` no llega a la API.
 *   2. La cookie del navegador se reenvia: la API decide de quien es el pedido.
 *   3. Solo un `application/pdf` con 200 sale por aqui; lo demas -sin sesion,
 *      pedido ajeno, pedido sin cobrar- manda a la pagina del pedido.
 */

const BASE = apiBaseUrl().replace(/\/+$/, "");
const ORDER_ID = "5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%fixture\n%%EOF\n");

function get(file: string, headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(`http://localhost:3000/receipts/${file}`, { headers }), {
    params: Promise.resolve({ file }),
  });
}

describe("GET /receipts/[file]", () => {
  it("reenvia la cookie y devuelve el PDF como descarga, sin cache", async () => {
    let seenCookie: string | null = null;
    mockApiServer.use(
      http.get(`${BASE}/account/orders/${ORDER_ID}/receipt.pdf`, ({ request }) => {
        seenCookie = request.headers.get("cookie");
        return HttpResponse.arrayBuffer(PDF_BYTES.buffer, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition":
              'attachment; filename="LoneStarWinners-Receipt-LSW-00001234.pdf"',
          },
        });
      }),
    );

    const response = await get(`${ORDER_ID}.pdf`, { cookie: "lsw_session=abc" });

    expect(seenCookie).toBe("lsw_session=abc");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="LoneStarWinners-Receipt-LSW-00001234.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it.each([
    ["sin sesion", 401],
    ["pedido ajeno", 404],
    ["pedido sin cobrar", 409],
  ])("%s: no sale ningun PDF, se manda a la pagina del pedido", async (_case, status) => {
    mockApiServer.use(
      http.get(`${BASE}/account/orders/${ORDER_ID}/receipt.pdf`, () =>
        HttpResponse.json({ error: { code: "X", request_id: "r" } }, { status }),
      ),
    );

    const response = await get(`${ORDER_ID}.pdf`);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/orders/${ORDER_ID}/confirmation`);
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("un 200 que no es PDF tampoco se reenvia", async () => {
    mockApiServer.use(
      http.get(`${BASE}/account/orders/${ORDER_ID}/receipt.pdf`, () =>
        HttpResponse.text("<html>proxy</html>", { headers: { "content-type": "text/html" } }),
      ),
    );

    const response = await get(`${ORDER_ID}.pdf`);
    expect(response.status).toBe(303);
  });

  it.each([
    "not-a-uuid.pdf",
    `${ORDER_ID}.PDF`,
    `${ORDER_ID}.pdf.exe`,
    `../${ORDER_ID}.pdf`,
    `${ORDER_ID}`,
  ])("un nombre sin forma de <uuid>.pdf es 404 SIN llamar a la API: %s", async (file) => {
    // `onUnhandledRequest: "error"`: si llegara a la API, la prueba fallaria.
    const response = await get(file);
    expect(response.status).toBe(404);
  });
});
