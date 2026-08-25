// ---------------------------------------------------------------------------
// Lone Star Winners - ESLint para tests/security.
//
// Extiende la configuracion raiz en vez de duplicarla: la raiz limita su bloque
// type-aware a `apps/**` y `packages/**`, asi que sin este fichero los tests de
// invariante quedarian sin lint. Duplicar las reglas seria crear una segunda
// fuente de verdad, que es justo lo que este agente debe impedir.
// ---------------------------------------------------------------------------

import tseslint from "typescript-eslint";
import root from "../../eslint.config.mjs";

export default tseslint.config(...root, {
  files: ["src/**/*.ts", "*.config.ts"],
  extends: [...tseslint.configs.recommendedTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "no-restricted-properties": [
      "error",
      {
        object: "Math",
        property: "random",
        message: "DEC-017: ni siquiera en tests. Usa node:crypto.",
      },
    ],
  },
});
