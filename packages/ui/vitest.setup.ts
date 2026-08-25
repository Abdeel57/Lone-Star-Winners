// Matchers de accesibilidad y DOM (`toBeInTheDocument`, `toHaveAccessibleName`,
// `toHaveAttribute`, ...). El import con sufijo `/vitest` ademas registra los
// tipos en el `Assertion` de Vitest.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
