import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/**
 * Servidor de MSW para Node.
 *
 * Se usa en dos sitios:
 *   - en los tests (`vitest.setup.ts`), con `onUnhandledRequest: "error"` para
 *     que ninguna llamada a un endpoint no contratado pase desapercibida;
 *   - en `next dev`, arrancado desde `src/instrumentation.ts`, para poder
 *     desarrollar la interfaz sin backend.
 *
 * Nunca en produccion: ver la guarda de `instrumentation.ts`.
 */
export const mockApiServer = setupServer(...handlers);
