// ---------------------------------------------------------------------------
// Lone Star Winners - configuracion raiz de ESLint (flat config, type-aware)
//
// Base:
//   DEC-002  TypeScript strict; `@typescript-eslint/no-explicit-any` como ERROR.
//   DEC-018  ESLint type-aware con eslint-plugin-security y reglas propias.
//   DEC-017  Prohibido Math.random(), PRNG sembrados y timestamps como entropia
//            en los paquetes que pueden influir en un sorteo.
//
// Ownership (docs/TASK_OWNERSHIP.md, DEC-024): este archivo es zona neutral
// raiz, creado por `backend-sweepstakes`. Cada workspace puede extenderlo con
// su propio `eslint.config.mjs` (por ejemplo `apps/web`, con las reglas de
// React y accesibilidad), pero NINGUN workspace debe relajar las reglas
// marcadas abajo como no negociables: cambiarlas exige un DEC nuevo.
// ---------------------------------------------------------------------------

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * DEC-017 / DEC-018: paquetes en los que la aleatoriedad debil o sembrada esta
 * prohibida. Son los que pueden influir, directa o indirectamente, en la
 * seleccion de un ganador o en material de auditoria.
 */
const RANDOMNESS_CRITICAL = [
  "packages/security/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  "packages/tpa/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  "packages/sweepstakes/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
];

/** Fuentes TypeScript de los workspaces: lint con informacion de tipos. */
const WORKSPACE_TS = ["apps/**/*.{ts,tsx,mts,cts}", "packages/**/*.{ts,tsx,mts,cts}"];

export default tseslint.config(
  // -------------------------------------------------------------------------
  // 0. Rutas ignoradas
  // -------------------------------------------------------------------------
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.min.js",
      // Migraciones SQL y artefactos generados: no son fuente TypeScript.
      "**/drizzle/**",
      "**/generated/**",
    ],
  },

  // -------------------------------------------------------------------------
  // 1. Base para todo el repositorio
  // -------------------------------------------------------------------------
  js.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-var": "error",
      "prefer-const": "error",
      "no-param-reassign": ["error", { props: false }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },

  // -------------------------------------------------------------------------
  // 2. TypeScript con informacion de tipos (DEC-002 / DEC-018)
  // -------------------------------------------------------------------------
  {
    files: WORKSPACE_TS,
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        // `projectService` descubre el tsconfig de cada workspace sin que la
        // raiz tenga que enumerarlos: cada agente controla el suyo.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ----- NO NEGOCIABLE (DEC-002) -----
      "@typescript-eslint/no-explicit-any": "error",

      // ----- Coherencia con el modo strict del compilador -----
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
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

  // -------------------------------------------------------------------------
  // 3. DEC-017 / DEC-018 - aleatoriedad en paquetes criticos
  //
  //    NO NEGOCIABLE. Cualquier valor que acabe influyendo en la seleccion de
  //    un ganador, o en material de auditoria, debe venir del CSPRNG del
  //    sistema operativo (node:crypto) con rechazo de muestreo.
  // -------------------------------------------------------------------------
  {
    files: RANDOMNESS_CRITICAL,
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "DEC-017: Math.random() prohibido aqui. Usa el CSPRNG del sistema (node:crypto: randomInt / randomBytes) con rechazo de muestreo.",
        },
        {
          object: "crypto",
          property: "pseudoRandomBytes",
          message: "DEC-017: pseudoRandomBytes no es un CSPRNG. Usa randomBytes / randomInt.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            "DEC-017: Math.random() prohibido aqui. Usa el CSPRNG del sistema (node:crypto) con rechazo de muestreo.",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "DEC-017: un timestamp no es entropia. Si necesitas el instante para un registro, recibelo como parametro explicito (occurred_at); nunca como semilla.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "DEC-011/DEC-017: no leas el reloj implicitamente en estos paquetes. Recibe el instante como parametro explicito, evaluado contra la timezone legal de la promocion.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "seedrandom",
              message: "DEC-017: PRNG sembrado prohibido. Usa node:crypto.",
            },
            {
              name: "chance",
              message: "DEC-017: PRNG sembrado prohibido. Usa node:crypto.",
            },
            {
              name: "random-seed",
              message: "DEC-017: PRNG sembrado prohibido. Usa node:crypto.",
            },
            {
              name: "faker",
              message: "DEC-017: generador sembrado prohibido en codigo de produccion.",
            },
            {
              name: "@faker-js/faker",
              message: "DEC-017: generador sembrado prohibido en codigo de produccion.",
            },
          ],
        },
      ],
      "security/detect-pseudoRandomBytes": "error",
    },
  },

  // -------------------------------------------------------------------------
  // 4. Ficheros de configuracion: sin informacion de tipos
  // -------------------------------------------------------------------------
  {
    files: ["*.{js,mjs,cjs}", "**/*.config.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-console": "off",
    },
  },

  // -------------------------------------------------------------------------
  // 5. Prettier al final: desactiva reglas de formato en conflicto.
  //    El formato lo decide Prettier, no ESLint.
  // -------------------------------------------------------------------------
  prettier,
);
