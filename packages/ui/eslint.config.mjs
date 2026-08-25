// ---------------------------------------------------------------------------
// @lsw/ui - extension local de la configuracion raiz de ESLint.
//
// El comentario de cabecera de `eslint.config.mjs` (raiz, propiedad de
// `backend-sweepstakes` por DEC-024) contempla explicitamente este archivo:
// "Cada workspace puede extenderlo con su propio eslint.config.mjs (por ejemplo
// apps/web, con las reglas de React y accesibilidad), pero NINGUN workspace debe
// relajar las reglas marcadas como no negociables".
//
// Aqui NO se relaja nada: se anaden React, hooks y accesibilidad.
//
// Caveat de flat config, documentado a proposito: cuando ESLint se ejecuta con
// `cwd` en este paquete, el base path pasa a ser este directorio, de modo que
// los globs de la raiz (`packages/**/*.ts`) dejan de coincidir. Por eso la capa
// type-aware se vuelve a declarar abajo con globs locales. Las reglas no
// negociables de DEC-002 se repiten literalmente; si algun dia se anaden mas en
// la raiz, hay que reflejarlas aqui. La alternativa (una capa de React en la
// configuracion raiz) seria mejor, pero ese archivo no es de este agente.
// ---------------------------------------------------------------------------

import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import rootConfig from "../../eslint.config.mjs";

export default tseslint.config(
  ...rootConfig,

  // Capa type-aware con globs locales (ver caveat de la cabecera).
  {
    files: ["src/**/*.{ts,tsx}", "*.config.ts", "vitest.setup.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // React y accesibilidad.
  {
    files: ["src/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Este paquete no contiene texto: todo lo visible llega por props desde
      // `apps/web`, que lo resuelve contra los diccionarios (DEC-021, DEC-022).
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/no-autofocus": "error",
    },
  },

  // Prettier al final, igual que en la raiz.
  prettier,
);
