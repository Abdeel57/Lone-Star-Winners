/**
 * Arranque de la API simulada en desarrollo.
 *
 * `docs/API_CONTRACT.md` esta vacio y `apps/api` todavia no existe, asi que sin
 * esto la portada no tendria de donde sacar la promocion activa ni los feature
 * flags. MSW intercepta en el proceso de servidor de Next, de modo que los
 * Server Components hacen `fetch` de verdad contra una API que aun no existe.
 *
 * Tres guardas, todas necesarias:
 *   1. `NODE_ENV === "production"` -> nunca se carga. Un mock que llegue a
 *      produccion serviria datos inventados como si fueran reales.
 *   2. `NEXT_RUNTIME === "nodejs"` -> MSW no funciona en el runtime edge.
 *   3. `WEB_ENABLE_API_MOCKS` -> permite apagarlo en cuanto exista `apps/api`,
 *      sin tocar codigo. Si no esta definida, se activa solo en desarrollo.
 *
 * PENDIENTE: `WEB_ENABLE_API_MOCKS` no esta en `.env.example`, que es zona
 * neutral raiz (DEC-024) y no pertenece a este agente. Solicitado en el informe
 * del hito.
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;

  const explicit = process.env["WEB_ENABLE_API_MOCKS"];
  const enabled = explicit === undefined ? process.env.NODE_ENV === "development" : explicit === "true";
  if (!enabled) return;

  const { mockApiServer } = await import("./mocks/node");
  mockApiServer.listen({ onUnhandledRequest: "bypass" });

  console.warn("[lsw] API simulada con MSW activa. Ningun dato de esta pantalla es real.");
}
