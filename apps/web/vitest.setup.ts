import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { mockApiServer } from "./src/mocks/node";

// El backend todavia no existe (`docs/API_CONTRACT.md` esta vacio). Los tests
// corren contra MSW, no contra suposiciones: `onUnhandledRequest: "error"` hace
// que cualquier llamada a un endpoint no contratado falle en vez de pasar
// desapercibida.
beforeAll(() => {
  mockApiServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  mockApiServer.resetHandlers();
});

afterAll(() => {
  mockApiServer.close();
});
