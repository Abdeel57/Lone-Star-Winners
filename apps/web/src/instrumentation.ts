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
 * POR QUE LOS DOS PRIMEROS `if` ESTAN ANIDADOS Y NO SON `return` TEMPRANOS
 * -----------------------------------------------------------------------
 * No es estilo: es la unica forma de que el `import()` desaparezca en tiempo de
 * COMPILACION. Next compila este archivo tambien para el runtime edge, y
 * sustituye `process.env.NEXT_RUNTIME` y `process.env.NODE_ENV` por literales
 * antes de empaquetar. Webpack descarta el contenido de un `if` cuya condicion
 * es literalmente falsa, pero un `return` temprano deja el `import()` como
 * dependencia del modulo igualmente.
 *
 * Con `return` temprano el build fallaba: en el compilado edge, el export map
 * de `@mswjs/interceptors` resuelve `./ClientRequest` a `null` -no existe fuera
 * de Node- y webpack lo reportaba como "Module not found". Anidando los `if`,
 * MSW no entra ni en el bundle edge ni en el de produccion.
 *
 * `serverExternalPackages` en `next.config.mjs` no basta: no se aplica a la
 * compilacion de `instrumentation.ts`.
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const explicit = process.env.WEB_ENABLE_API_MOCKS;
      const enabled =
        explicit === undefined ? process.env.NODE_ENV === "development" : explicit === "true";
      if (!enabled) return;

      const { mockApiServer } = await import("./mocks/node");
      mockApiServer.listen({ onUnhandledRequest: "bypass" });

      console.warn("[lsw] API simulada con MSW activa. Ningun dato de esta pantalla es real.");
    }
  }
}
