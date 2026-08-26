/**
 * `HO-014`: la regla de lint contra la trampa de los escapes, y un escaner que
 * la respalda mientras no este conectada a la configuracion raiz.
 *
 * POR QUE HAY DOS COSAS AQUI
 *
 *   La regla vive en `packages/security` pero solo actua cuando
 *   `eslint.config.mjs` la registra, y ese fichero es de `backend`. Hasta que se
 *   conecte, la regla seria una recomendacion. El escaner de la segunda mitad de
 *   este fichero recorre el repositorio entero y no depende de que nadie la
 *   conecte: hoy es el gate, y cuando la regla este conectada seguira siendo la
 *   red que detecta a quien la desactive con un comentario.
 *
 * Y POR QUE LA REGLA SE PRUEBA CON EL `RuleTester` DE VERDAD
 *
 *   Punto 3 de `HO-014`: todo escaner lleva tests de sus propios patrones. Una
 *   regla de lint es un escaner. Sin casos que DEBEN y que NO DEBEN coincidir,
 *   "no encontre nada" y "no busque nada" son indistinguibles, que es
 *   literalmente el defecto que este handoff persigue.
 */

import { RuleTester } from "eslint";
import type { Rule } from "eslint";
import { describe, expect, it } from "vitest";

import { noUnrawRegexpSource } from "@lsw/security";

import { listRepoTextFiles, readRepoFile, repoRoot } from "../helpers/repo.js";
import { join } from "node:path";

const rule = noUnrawRegexpSource as unknown as Rule.RuleModule;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: "module" },
});

describe("la regla no-unraw-regexp-source", () => {
  it("acepta lo que debe aceptar y rechaza lo que debe rechazar", () => {
    ruleTester.run("no-unraw-regexp-source", rule, {
      valid: [
        // Literales de expresion regular: aqui el problema no existe.
        { code: "const p = /\\s+/u;" },
        { code: "const p = /\\bpalabra\\b/gu;" },
        // String.raw, que es la respuesta correcta cuando hay interpolacion.
        { code: "const p = new RegExp(String.raw`\\s*${x}\\s*`);" },
        { code: "const p = new RegExp(String.raw`Math\\s*\\.\\s*random`);" },
        // Sin barras invertidas no hay nada que colapsar.
        { code: "const p = new RegExp(`^${prefijo}$`);" },
        { code: 'const p = new RegExp("^[a-z]+$");' },
        { code: "const config = { matcher: [`/((?!api).*)`] };" },
        // La barra duplicada tambien es correcta, aunque se lea peor.
        { code: 'const p = new RegExp("\\\\s+");' },
        // Propiedades que no son patrones, aunque lleven barras.
        { code: 'const x = { path: "C:\\\\tmp" };' },
        // Una propiedad calculada no se puede resolver: no se inventa.
        { code: 'const k = "pattern"; const x = { [k]: "\\\\d" };' },
      ],

      invalid: [
        // El caso que tumbo el escaner de aleatoriedad: `\s` colapsa a `s`.
        {
          code: "const p = new RegExp(`Math\\s*\\.\\s*random`);",
          errors: [{ messageId: "regexpArgument" }],
        },
        // El caso que NINGUNA regla estandar detecta: `\b` es un escape VALIDO
        // de cadena, asi que `no-useless-escape` calla. En regex se pretendia un
        // limite de palabra y se obtiene el caracter de retroceso U+0008.
        {
          code: "const p = new RegExp(`\\b${palabra}\\b`);",
          errors: [{ messageId: "regexpArgument" }],
        },
        {
          code: "const p = new RegExp(`\\n`);",
          errors: [{ messageId: "regexpArgument" }],
        },
        // Sin `new`, igual de roto.
        {
          code: "const p = RegExp(`\\d+`);",
          errors: [{ messageId: "regexpArgument" }],
        },
        // Cadena normal, no plantilla.
        {
          code: 'const p = new RegExp("\\d+");',
          errors: [{ messageId: "regexpArgument" }],
        },
        // El defecto del middleware de `frontend`: el patron es una cadena en
        // un objeto de configuracion y quien lo compila es el framework.
        {
          code: 'export const config = { matcher: ["/((?!api|_next)\\..*)"] };',
          errors: [{ messageId: "patternProperty" }],
        },
        {
          code: "const x = { pattern: `\\s+` };",
          errors: [{ messageId: "patternProperty" }],
        },
        {
          code: 'const x = { regex: "\\w" };',
          errors: [{ messageId: "patternProperty" }],
        },
      ],
    });

    // `RuleTester.run` lanza si algun caso falla; llegar aqui ya es el aserto.
    expect(true).toBe(true);
  });

  it("declara los dos mensajes que emite", () => {
    expect(Object.keys(noUnrawRegexpSource.meta.messages).sort()).toStrictEqual([
      "patternProperty",
      "regexpArgument",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Escaner de respaldo sobre el repositorio.
// ---------------------------------------------------------------------------

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/u;

const IGNORED_PREFIXES: readonly string[] = [
  // Este fichero contiene, a proposito, todos los patrones rotos que persigue.
  "tests/security/src/lint/",
  // Y la propia regla habla de ellos en sus mensajes.
  "packages/security/src/lint/",
];

/**
 * Detecta `new RegExp(` seguido de una comilla invertida SIN `String.raw`
 * delante, en la misma linea.
 *
 * El patron se escribe como literal `/.../` justamente por lo que dice
 * `HO-014`: en cuanto se construye con interpolacion hay que acordarse de
 * `String.raw`, y "acordarse" es lo que ya fallo tres veces.
 */
const UNRAW_REGEXP_CONSTRUCTION = /(?:new\s+)?RegExp\s*\(\s*`/u;

/** La forma correcta, que el patron de arriba NO debe confundir con la rota. */
const RAW_TAGGED = /(?:new\s+)?RegExp\s*\(\s*String\.raw`/u;

/**
 * Misma aritmetica que la regla: una serie IMPAR de barras invertidas deja una
 * suelta, que se come el caracter siguiente. Una par se cancela.
 */
function consumesEscape(text: string): boolean {
  let run = 0;
  for (const character of text) {
    if (character === String.fromCharCode(92)) {
      run += 1;
      continue;
    }
    if (run % 2 === 1) {
      return true;
    }
    run = 0;
  }
  return run % 2 === 1;
}

interface Offence {
  readonly location: string;
  readonly text: string;
}

function scanRepository(): readonly Offence[] {
  const offences: Offence[] = [];

  for (const file of listRepoTextFiles(repoRoot())) {
    if (!SOURCE_FILE.test(file.path)) {
      continue;
    }
    if (IGNORED_PREFIXES.some((prefix) => file.path.startsWith(prefix))) {
      continue;
    }

    for (const [index, line] of readRepoFile(file.path).split("\n").entries()) {
      if (!UNRAW_REGEXP_CONSTRUCTION.test(line) || RAW_TAGGED.test(line)) {
        continue;
      }
      // Solo molesta si hay una barra que el motor de cadenas va a consumir.
      // Una barra duplicada (`\\s`) produce el patron correcto y no se reporta:
      // un gate que castiga la solucion se desactiva el mismo dia.
      if (!consumesEscape(line)) {
        continue;
      }
      offences.push({ location: `${file.path}:${String(index + 1)}`, text: line.trim() });
    }
  }

  return offences;
}

describe("HO-014: ninguna expresion regular se construye desde una plantilla sin String.raw", () => {
  it("el repositorio esta limpio", () => {
    const offences = scanRepository();
    expect(
      offences.map((offence) => `${offence.location}  ${offence.text}`),
      "Plantilla con barra invertida usada como expresion regular. En una cadena " +
        "normal `\\s` colapsa a `s` y `\\b` pasa a ser el caracter de retroceso: " +
        "el patron compila y no encuentra nada. Usa String.raw o un literal /.../.",
    ).toStrictEqual([]);
  });

  it("los propios patrones detectan lo que dicen detectar", () => {
    const debenCoincidir: readonly string[] = [
      "const p = new RegExp(`\\s+`);",
      "const p = new RegExp( `\\s+` );",
      "const p = RegExp(`\\b${x}\\b`);",
      "new RegExp(`${a}\\d`)",
    ];
    for (const sample of debenCoincidir) {
      expect(UNRAW_REGEXP_CONSTRUCTION.test(sample), sample).toBe(true);
      expect(RAW_TAGGED.test(sample), sample).toBe(false);
    }

    const noDebenCoincidir: readonly string[] = [
      "const p = /\\s+/u;",
      'const p = new RegExp("\\\\s+");',
      "const nombre = `hola ${quien}`;",
      "// new RegExp con comillas normales",
    ];
    for (const sample of noDebenCoincidir) {
      expect(UNRAW_REGEXP_CONSTRUCTION.test(sample), sample).toBe(false);
    }

    // La aritmetica de las barras. Y una nota sobre este propio test: los
    // literales de abajo llevan las barras DUPLICADAS en el fuente porque una
    // sola se la come el propio compilador antes de que `consumesEscape` la
    // vea. La primera version de estas tres lineas cayo en la trampa que este
    // fichero persigue, y fallo en rojo, que es exactamente para lo que esta.
    expect(consumesEscape("new RegExp(`\\s`)")).toBe(true);
    expect(consumesEscape("new RegExp(`\\\\s`)")).toBe(false);
    expect(consumesEscape("sin barras")).toBe(false);

    // Y la forma correcta se reconoce como correcta: si `RAW_TAGGED` estuviera
    // roto, el escaner reportaria como defecto justo la solucion que recomienda.
    const correctos: readonly string[] = [
      "const p = new RegExp(String.raw`\\s+`);",
      "const p = RegExp(String.raw`\\b${x}\\b`);",
    ];
    for (const sample of correctos) {
      expect(RAW_TAGGED.test(sample), sample).toBe(true);
    }
  });

  it("nadie desactiva la regla con un comentario suelto", () => {
    const suppressions: string[] = [];
    const suppression = /eslint-disable(?:-next-line|-line)?[^\n]*no-unraw-regexp-source/u;

    for (const file of listRepoTextFiles(join(repoRoot(), "packages"))) {
      if (!SOURCE_FILE.test(file.path)) {
        continue;
      }
      for (const [index, line] of readRepoFile(file.path).split("\n").entries()) {
        if (suppression.test(line)) {
          suppressions.push(`${file.path}:${String(index + 1)}`);
        }
      }
    }

    expect(suppressions, suppressions.join("\n")).toStrictEqual([]);
  });
});
