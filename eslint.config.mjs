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

import { noUnrawRegexpSource } from "./packages/security/dist/index.js";

/**
 * POR QUE NINGUN GLOB DE ESTE ARCHIVO LLEVA PREFIJO DE DIRECTORIO
 *
 * En flat config, los globs de `files` se resuelven contra el BASE PATH, que
 * es el directorio del `eslint.config.mjs` que ESLint acabe cargando. Cuando
 * un workspace tiene su propia configuracion que importa esta (`apps/web`,
 * `packages/ui`, `tests/security`), el base path pasa a ser ESE directorio, y
 * un glob como `packages/**` deja de coincidir con nada.
 *
 * El fallo es silencioso y peor que un error: ESLint sigue corriendo, informa
 * de las reglas basicas y la capa type-aware -que es donde viven las reglas NO
 * NEGOCIABLES de DEC-002 y DEC-017- simplemente no se aplica. Como
 * `turbo run lint` ejecuta paquete a paquete, ese era el modo habitual de
 * ejecucion. Detectado por `frontend`; corregido aqui.
 *
 * Por eso los globs son relativos (`**\/*.ts`) y el alcance se acota con
 * `ignores`, que se comportan igual desde cualquier base path.
 */

/**
 * DEC-017 / DEC-018: paquetes en los que la aleatoriedad debil o sembrada esta
 * prohibida. Son los que pueden influir, directa o indirectamente, en la
 * seleccion de un ganador o en material de auditoria.
 *
 * Esta capa es la UNICA que conserva prefijo de directorio, porque su alcance
 * es un subconjunto de paquetes y no hay forma de nombrarlos con un glob
 * relativo: cuando el base path ya ES el paquete, su nombre no aparece en la
 * ruta del fichero.
 *
 * Funciona hoy porque ninguno de los tres tiene `eslint.config.mjs` propio, de
 * modo que ESLint sube hasta la raiz y el base path es el del monorepo.
 *
 * ADVERTENCIA para quien anada uno: el dia que `packages/security`,
 * `packages/tpa` o `packages/sweepstakes` tenga configuracion local, ESTA CAPA
 * DEJA DE APLICARSE en ese paquete sin decir nada. Esa configuracion local
 * tiene que repetirla, igual que `apps/web` repite la capa type-aware.
 */
const RANDOMNESS_CRITICAL = [
  "packages/security/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  "packages/tpa/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  "packages/sweepstakes/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  // Peticion de `security` al cerrar S3/S4: `packages/audit` contiene la hash
  // chain de DEC-008, el arbol de Merkle y el generador de exports
  // reproducibles. Es material de auditoria, que es justo lo que esta lista
  // protege, y faltaba.
  "packages/audit/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
];

/**
 * Fuentes TypeScript de los workspaces: lint con informacion de tipos.
 * Sin prefijo de directorio, a proposito (ver la nota de arriba).
 */
const WORKSPACE_TS = ["**/*.{ts,tsx,mts,cts}"];

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
      "**/.next-smoke/**",
      "**/.next-build/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.min.js",
      // Migraciones SQL y artefactos generados: no son fuente TypeScript.
      "**/drizzle/**",
      "**/generated/**",
      // Generado por Next en cada arranque; no lo escribe nadie.
      "**/next-env.d.ts",
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
  // 3.bis  HO-014 - una expresion regular no se construye desde una cadena con
  //        barras invertidas.
  //
  //    NO NEGOCIABLE, y en TODO el workspace, no solo en los paquetes
  //    criticos. La regla la escribio `security` y vive en
  //    `packages/security/src/lint/`; aqui solo se conecta, porque
  //    `eslint.config.mjs` es zona neutral raiz (DEC-024).
  //
  //    POR QUE HACE FALTA HABIENDO YA `no-useless-escape`
  //
  //      `no-useless-escape` solo avisa cuando el escape es INUTIL, es decir
  //      cuando `\x` no es una secuencia valida de cadena y colapsa a `x`. Deja
  //      fuera el caso peor: `\b`, `\n`, `\t`, `\0`, `\xNN` SI son validos en
  //      una cadena, y significan algo completamente distinto en una expresion
  //      regular.
  //
  //      Una plantilla que use un limite de palabra alrededor de una variable,
  //      sin String.raw, compila, corre y no encuentra nada nunca. (El ejemplo
  //      literal no se escribe aqui a proposito: el escaner de invariante de
  //      `tests/security` recorre el repositorio en texto plano y lo detectaria
  //      como una infraccion real, que es exactamente lo que debe hacer.)
  //
  //      Eso ya paso aqui tres veces en dos dominios distintos: un escaner que
  //      reportaba verde por AUSENCIA de busqueda, no por limpieza. Ninguna
  //      regla estandar lo detecta.
  //
  //    POR QUE SE IMPORTA DE `dist` Y NO DEL FUENTE
  //
  //      `eslint.config.mjs` lo carga Node directamente, sin pasar por
  //      TypeScript, asi que no puede leer un `.ts`. La tarea `lint` de
  //      `turbo.json` declara `dependsOn: ["^build"]` para que el paquete este
  //      compilado antes de que ESLint arranque.
  //
  //      Si el `dist` no existe, la carga de esta configuracion falla y NO se
  //      lintea nada. Es deliberado: la alternativa -desactivar la regla en
  //      silencio cuando falta el build- convertiria un gate de seguridad en
  //      algo que depende de si alguien compilo antes.
  // -------------------------------------------------------------------------
  {
    files: WORKSPACE_TS,
    plugins: { lsw: { rules: { "no-unraw-regexp-source": noUnrawRegexpSource } } },
    rules: {
      "lsw/no-unraw-regexp-source": "error",
      // HO-014, punto 2: deja de tratarse como cosmetico. En este proyecto es
      // el indicador de un patron corrupto, no de un estilo descuidado.
      "no-useless-escape": "error",
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
