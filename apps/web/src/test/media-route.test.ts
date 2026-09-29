// @vitest-environment node
//
// Un manejador de ruta corre en Node, con el `Request`/`Response` de Node. Ver
// la misma nota en `admin-image-upload.test.ts`.

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/media/[file]/route";
import { apiBaseUrl } from "@/lib/api";
import { mockApiServer } from "@/mocks/node";

/**
 * `/media/<id>.<ext>`: las fotos del catalogo bajo el origen del sitio (§14,
 * DEC-056).
 *
 * Este manejador sirve CONTENIDO SUBIDO POR UN FORMULARIO bajo el mismo origen
 * que la tienda, asi que lo que se vigila es que por el solo salgan imagenes:
 *
 *   1. Un nombre que no sea `<uuid>.<ext>` no llega a la API ni como ruta.
 *   2. La respuesta de la API solo se reenvia si su tipo es uno de los tres del
 *      contrato. Un envelope JSON o un HTML se convierten en 404.
 *   3. Lo que se sirve va con `nosniff`, una CSP que no deja cargar nada y cache
 *      inmutable.
 */

const BASE = apiBaseUrl().replace(/\/+$/, "");
const FILE = "5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d.jpg";
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function get(file: string, headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(`http://localhost:3000/media/${file}`, { headers }), {
    params: Promise.resolve({ file }),
  });
}

describe("GET /media/[file]", () => {
  it("reenvia los bytes con su tipo, cache inmutable y cabeceras de contencion", async () => {
    mockApiServer.use(
      http.get(`${BASE}/media/${FILE}`, () =>
        HttpResponse.arrayBuffer(JPEG_BYTES.buffer, {
          headers: { "content-type": "image/jpeg", etag: '"abc123"' },
        }),
      ),
    );

    const response = await get(FILE);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG_BYTES);
  });

  it("un nombre sin forma de <uuid>.<ext> es 404 SIN llamar a la API", async () => {
    // `onUnhandledRequest: "error"`: si alguno de estos llegara a la API, el
    // test fallaria por peticion no contratada.
    for (const file of [
      "gorra.jpg",
      "5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d.svg",
      "5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d",
      "..%2Fadmin%2Fproducts",
      `${FILE}?x=1`,
    ]) {
      const response = await get(file);
      expect(response.status, file).toBe(404);
    }
  });

  it("una imagen que no existe es 404, no el envelope JSON de la API", async () => {
    mockApiServer.use(
      http.get(`${BASE}/media/${FILE}`, () =>
        HttpResponse.json({ error: { code: "NOT_FOUND", request_id: "req_1" } }, { status: 404 }),
      ),
    );

    const response = await get(FILE);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("un 200 que no es una imagen del contrato NO se reenvia", async () => {
    mockApiServer.use(
      http.get(`${BASE}/media/${FILE}`, () =>
        HttpResponse.html("<script>alert(1)</script>", { status: 200 }),
      ),
    );

    const response = await get(FILE);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("propaga If-None-Match y devuelve el 304 de la API", async () => {
    const seen: (string | null)[] = [];
    mockApiServer.use(
      http.get(`${BASE}/media/${FILE}`, ({ request }) => {
        seen.push(request.headers.get("if-none-match"));
        return new HttpResponse(null, { status: 304, headers: { etag: '"abc123"' } });
      }),
    );

    const response = await get(FILE, { "if-none-match": '"abc123"' });

    expect(seen).toEqual(['"abc123"']);
    expect(response.status).toBe(304);
  });

  it("si la API no contesta es 502, no una excepcion", async () => {
    mockApiServer.use(http.get(`${BASE}/media/${FILE}`, () => HttpResponse.error()));

    const response = await get(FILE);

    expect(response.status).toBe(502);
  });
});
