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
    // `.next-smoke/**` y `.next-build/**` son directorios de build alternativos
    // que se piden con `LSW_NEXT_DIST_DIR` (ver `next.config.mjs`): el primero lo
    // usa el humo, el segundo un build que no quiera pisar un `next dev` vivo.
    // Mismo caso que `.next`: generados, no fuente.
    ignores: ["next-env.d.ts", ".next/**", ".next-smoke/**", ".next-build/**", ".next-e2e/**"],
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

  // -------------------------------------------------------------------------
  // El PANEL usa `next/link` y `next/navigation` a proposito (DEC-048).
  //
  // La restriccion de arriba existe por DEC-021: en el ESCAPARATE, un
  // `<Link href="/shop">` de Next perderia el prefijo de idioma y sacaria al
  // usuario de su idioma a mitad de sesion. Los envoltorios de
  // `@/i18n/navigation` lo evitan porque conocen el router de next-intl.
  //
  // El panel NO esta en ese router. Su prefijo es `/admin/<locale>` y lo
  // resuelve su propia negociacion en el middleware, porque la cookie de
  // personal tiene `Path=/admin` (DEC-006) y bajo `/es/admin` el navegador no
  // la enviaria. Usar aqui el `Link` de next-intl produciria exactamente
  // `/es/admin/...`, es decir, la ruta en la que el panel queda deslogueado:
  // la regla, aplicada aqui, causaria el fallo que en el escaparate previene.
  //
  // ESTO NO RELAJA LA REGLA, LA ACOTA. Sigue vigente en todo el escaparate, y
  // el panel tiene su propia garantia equivalente: cada enlace pasa por
  // `adminHref(locale, path)`, que es el unico sitio donde se compone la ruta
  // con su idioma. Un `href` escrito a mano en el panel seria igual de
  // incorrecto que un `next/link` en la tienda.
  //
  // El alcance es EXACTAMENTE el subarbol del panel. Si alguien mueve un
  // componente de admin fuera de estas dos carpetas, la regla vuelve a
  // aplicarse y el error reaparece, que es lo que se quiere.
  // -------------------------------------------------------------------------
  {
    files: ["src/app/admin/**/*.tsx", "src/components/admin/**/*.tsx", "src/lib/admin/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
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
