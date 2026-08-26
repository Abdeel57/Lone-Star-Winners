// ---------------------------------------------------------------------------
// apps/web - extension local de la configuracion raiz de ESLint.
//
// La cabecera de `eslint.config.mjs` (raiz, propiedad de `backend-sweepstakes`
// por DEC-024) contempla exactamente este archivo: "Cada workspace puede
// extenderlo con su propio eslint.config.mjs (por ejemplo apps/web, con las
// reglas de React y accesibilidad), pero NINGUN workspace debe relajar las
// reglas marcadas como no negociables".
//
// Aqui no se relaja nada. Se anaden React, hooks, accesibilidad y las reglas de
// Next.
//
// Caveat de flat config: al ejecutar ESLint con `cwd` en este paquete, el base
// path pasa a ser este directorio y los globs de la raiz (`apps/**/*.ts`) dejan
// de coincidir. Por eso la capa type-aware se vuelve a declarar con globs
// locales, repitiendo literalmente las reglas no negociables de DEC-002. Si la
// raiz anade mas, hay que reflejarlas aqui.
// ---------------------------------------------------------------------------

import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import rootConfig from "../../eslint.config.mjs";

export default tseslint.config(
  ...rootConfig,

  {
    // `.next-smoke/**` es el directorio de build que usa el humo cuando corre
    // su propio `next dev` (ver `next.config.mjs`): mismo caso que `.next`,
    // generado y no fuente.
    ignores: ["next-env.d.ts", ".next/**", ".next-smoke/**"],
  },

  // Capa type-aware con globs locales (ver caveat de la cabecera).
  {
    files: ["src/**/*.{ts,tsx}", "*.config.ts", "vitest.setup.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
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

      // DEC-021: la navegacion tiene que conservar el idioma. `next/link` y
      // `next/navigation` pierden el prefijo de locale; en esta app se usan
      // siempre los envoltorios de `@/i18n/navigation`.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                "DEC-021: usa `Link` de `@/i18n/navigation`; `next/link` pierde el prefijo de idioma.",
            },
            {
              name: "next/navigation",
              importNames: ["redirect", "usePathname", "useRouter"],
              message:
                "DEC-021: usa los envoltorios de `@/i18n/navigation`. `notFound` si puede importarse de `next/navigation`.",
            },
          ],
        },
      ],
    },
  },

  // React, accesibilidad y Next.
  {
    files: ["src/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // El plugin de Next prohibe `<a>` para navegacion interna. En esta app la
      // navegacion interna usa el `Link` de next-intl, no el de Next, asi que
      // la comprobacion automatica no lo reconoce.
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  // Los tests montan componentes con dobles y fixtures; no aplican las reglas
  // de Next, que solo tienen sentido dentro del arbol de rutas.
  {
    files: ["src/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  prettier,
);
