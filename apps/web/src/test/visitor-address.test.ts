/**
 * La IP del visitante viaja a la API (DEC-061).
 *
 * Sin ella, la API veia la IP del servidor web en todas las peticiones y su
 * limite de peticiones era uno solo para la tienda entera: el 2026-09-30 un
 * unico visitante lo agoto en produccion.
 */

import { describe, expect, it, vi } from "vitest";

// `vi.hoisted`: la MISMA funcion aunque la fabrica del mock se evalue otra vez
// tras `vi.resetModules()`.
const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));
vi.mock("next/headers", () => ({ headers: headersMock }));

import { lastForwardedAddress } from "@/lib/api/visitor-address";

function incomingForwardedFor(value: string | null) {
  headersMock.mockResolvedValue(new Headers(value === null ? {} : { "x-forwarded-for": value }));
}

async function forwardedHeaderSentToApi(): Promise<string | null> {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
  // `vitest.setup.ts` ya cargo la capa de API (los mocks de MSW la importan)
  // con el `next/headers` real. Se vuelve a cargar para que vea el simulado.
  vi.resetModules();
  const { apiGet } = await import("@/lib/api/http");
  await apiGet("/health");
  const init = fetchSpy.mock.calls[0]?.[1];
  return new Headers(init?.headers).get("x-forwarded-for");
}

describe("lastForwardedAddress", () => {
  it("toma la ULTIMA direccion, la que anade el proxy", () => {
    expect(lastForwardedAddress("1.1.1.1, 203.0.113.7")).toBe("203.0.113.7");
    expect(lastForwardedAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(lastForwardedAddress("2001:db8::1")).toBe("2001:db8::1");
  });

  it("descarta lo que no tiene forma de IP", () => {
    expect(lastForwardedAddress(null)).toBeNull();
    expect(lastForwardedAddress("")).toBeNull();
    expect(lastForwardedAddress("1.1.1.1, <script>")).toBeNull();
    expect(lastForwardedAddress("1.1.1.1, visitante")).toBeNull();
  });
});

describe("apiRequest reenvia la IP del visitante", () => {
  it("manda a la API solo la ultima direccion de X-Forwarded-For", async () => {
    incomingForwardedFor("9.9.9.9, 203.0.113.7");
    expect(await forwardedHeaderSentToApi()).toBe("203.0.113.7");
  });

  it("sin cabecera entrante no inventa ninguna", async () => {
    incomingForwardedFor(null);
    expect(await forwardedHeaderSentToApi()).toBeNull();
  });

  it("fuera de una peticion de Next no rompe la llamada", async () => {
    headersMock.mockRejectedValue(new Error("headers was called outside a request scope"));
    expect(await forwardedHeaderSentToApi()).toBeNull();
  });
});
