/**
 * Arranque de la API simulada en desarrollo.
 *
 * `apps/api` todavia no sirve estas rutas, asi que sin esto la portada no
 * tendria de donde sacar la promocion activa ni los feature flags, y todas las
 * pantallas con datos mostrarian su estado de error.
 *
 * QUE ARRANCA, Y POR QUE NO ES MSW
 * --------------------------------
 * Arranca un servidor HTTP DE VERDAD en el puerto que ya declara `API_BASE_URL`
 * (`src/mocks/dev-server.ts`). Antes esto era `mockApiServer.listen()`, y no
 * funcionaba: MSW intercepta reemplazando `globalThis.fetch`, Next envuelve
 * `globalThis.fetch` y GUARDA la referencia que encuentra, y quien gane esa
 * carrera depende de cuando se compile cada ruta. El resultado medido era que
 * la misma URL se interceptaba desde una pagina y se escapaba a la red desde
 * otra. La explicacion completa, con la traza, esta en `dev-server.ts`.
 *
 * MSW se sigue usando en los tests, que es donde si es fiable. Los fixtures son
 * los mismos porque ambos caminos se derivan de `src/mocks/routes.ts`.
 *
 * Tres guardas, todas necesarias:
 *   1. `NODE_ENV === "production"` -> nunca se carga. Un mock que llegue a
 *      produccion serviria datos inventados como si fueran reales.
 *   2. `NEXT_RUNTIME === "nodejs"` -> el runtime edge no tiene `node:http`.
 *   3. `WEB_ENABLE_API_MOCKS` -> permite apagarlo en cuanto `apps/api` sirva
 *      estas rutas, sin tocar codigo. Si no esta definida, se activa solo en
 *      desarrollo.
 *
 * POR QUE LOS DOS PRIMEROS `if` ESTAN ANIDADOS Y NO SON `return` TEMPRANOS
 * -----------------------------------------------------------------------
 * No es estilo: es la unica forma de que el `import()` desaparezca en tiempo de
 * COMPILACION. Next compila este archivo tambien para el runtime edge, y
 * sustituye `process.env.NEXT_RUNTIME` y `process.env.NODE_ENV` por literales
 * antes de empaquetar. Webpack descarta el contenido de un `if` cuya condicion
 * es literalmente falsa, pero un `return` temprano deja el `import()` como
 * dependencia del modulo igualmente, y en el bundle edge `node:http` no existe.
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const explicit = process.env.WEB_ENABLE_API_MOCKS;
      const enabled =
        explicit === undefined ? process.env.NODE_ENV === "development" : explicit === "true";
      if (!enabled) return;

      const { startMockApiServer } = await import("./mocks/dev-server");
      await startMockApiServer();
    }
  }
}
