/**
 * INVARIANTE: el sorteo interno esta apagado en todas partes.
 *
 * DEC-017, cerrojo 1, y principio #11 de CLAUDE.md. El riesgo real no es que
 * alguien programe mal un sorteo: es que el modulo acabe activado simplemente
 * porque existe, en una migracion semilla, en un `.env` de ejemplo o en un
 * valor por defecto de codigo que nadie volvio a mirar.
 *
 * Este test lee el repositorio entero, incluido el codigo que todavia no se ha
 * escrito cuando se lee esto. Si `backend` crea manana la tabla de flags con el
 * valor por defecto equivocado, el test falla ese mismo dia.
 *
 * Los patrones se construyen concatenando fragmentos para que este fichero no
 * se detecte a si mismo. Cuando hay interpolacion es obligatorio `String.raw`:
 * en un template literal normal `\s` colapsa a la letra `s`, y el patron pasa a
 * exigir "cero o mas eses" donde creia exigir espacios. Ese error dejo ciegos a
 * los tres patrones de este fichero durante la FASE 1 sin que ningun test
 * fallase, porque un escaner que no encuentra nada es indistinguible de un
 * escaner que no busca nada. Por eso ahora hay un test que verifica los
 * patrones contra muestras conocidas.
 */

import { describe, expect, it } from "vitest";

import { listRepoTextFiles, readRepoFile, repoPathExists } from "../helpers/repo.js";

// `internal_draw_enabled` y sus variantes de estilo (camelCase, MAYUSCULAS):
// el flag se escribe de tres formas segun sea columna, variable de entorno o
// campo de TypeScript, y las tres significan lo mismo.
const FLAG = String.raw`internal${"_?draw_?enabled"}`;
const PREFIX = `INTERNAL${"_DRAW"}`;

const MENTIONS_FLAG = new RegExp(FLAG, "i");

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly rule: string;
}

const RULES: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  {
    id: "flag-asignado-a-verdadero",
    // `flag: true`, `flag = true`, `"flag": true`, `flag: "true"`, `flag: 1`.
    pattern: new RegExp(String.raw`${FLAG}["']?\s*[:=]\s*["']?(?:true|1)\b`, "i"),
  },
  {
    id: "columna-con-default-verdadero",
    // SQL `DEFAULT TRUE`, Prisma `@default(true)`, Drizzle `.default(true)`.
    pattern: new RegExp(String.raw`${FLAG}[^\n]{0,160}\bdefault\b[^\n]{0,8}\btrue\b`, "i"),
  },
  {
    id: "variable-de-entorno-que-activa-el-sorteo",
    pattern: new RegExp(String.raw`${PREFIX}[A-Z_]*\s*=\s*["']?(?:true|1|on|yes|enabled)\b`, "i"),
  },
];

// Ficheros que describen la invariante en prosa y no pueden violarla.
const DOCUMENTATION = new Set(["docs/DECISIONS.md", "docs/SECURITY.md", "docs/THREAT_MODEL.md"]);

/**
 * Otros tests de invariante del repositorio llevan el nombre del flag dentro de
 * sus propias expresiones regulares -por ejemplo la comprobacion DEC-017 sobre
 * las migraciones, en `packages/database`-. Esas lineas son detectores, no
 * configuracion, y contarlas como infraccion enfrentaria un gate contra otro.
 *
 * El criterio es deliberadamente estrecho: se mira el texto que ha casado, no la
 * linea entera ni el fichero. Una activacion real (`...: true`, `... DEFAULT
 * TRUE`) nunca lleva una barra invertida dentro; solo la lleva el codigo fuente
 * de una expresion regular. Excluir el fichero entero, que era la alternativa
 * facil, habria creado un punto ciego permanente sobre codigo ajeno.
 */
function isDetector(matched: string): boolean {
  return matched.includes("\\");
}

function scanRepository(): readonly Offence[] {
  const offences: Offence[] = [];

  for (const file of listRepoTextFiles()) {
    if (DOCUMENTATION.has(file.path)) {
      continue;
    }
    const contents = readRepoFile(file.path);
    if (!MENTIONS_FLAG.test(contents) && !contents.includes(PREFIX)) {
      continue;
    }
    // `index` es el contador de un recorrido sobre el propio array de lineas,
    // no una clave de origen externo.
    for (const [index, text] of contents.split("\n").entries()) {
      for (const rule of RULES) {
        const match = rule.pattern.exec(text);
        if (match === null || isDetector(match[0])) {
          continue;
        }
        offences.push({ file: file.path, line: index + 1, text: text.trim(), rule: rule.id });
      }
    }
  }

  return offences;
}

describe("DEC-017: el sorteo interno esta desactivado por defecto", () => {
  it("los patrones detectan las formas reales de activar el flag", () => {
    const byId = new Map(RULES.map((rule) => [rule.id, rule.pattern]));

    // Las muestras se ensamblan en tiempo de ejecucion por el mismo motivo que
    // los patrones: si el nombre del flag apareciese entero en este fichero, el
    // escaner del test siguiente se detectaria a si mismo. La alternativa
    // -excluir este fichero del recorrido- crearia justo el punto ciego que
    // alguien podria ensanchar mas adelante.
    const snake = `internal${"_draw_enabled"}`;
    const camel = `internal${"DrawEnabled"}`;
    const env = `${PREFIX}_ENABLED`;

    const mustMatch: readonly (readonly [string, string])[] = [
      ["flag-asignado-a-verdadero", `${snake}: true,`],
      ["flag-asignado-a-verdadero", `${snake} = true`],
      ["flag-asignado-a-verdadero", `"${snake}": true`],
      ["flag-asignado-a-verdadero", `${camel}: true`],
      ["flag-asignado-a-verdadero", `${env}=1`],
      ["columna-con-default-verdadero", `${snake} boolean NOT NULL DEFAULT TRUE,`],
      ["columna-con-default-verdadero", `${camel} Boolean @default(true)`],
      ["columna-con-default-verdadero", `${snake}: boolean("x").default( true )`],
      ["variable-de-entorno-que-activa-el-sorteo", `${env} = true`],
      ["variable-de-entorno-que-activa-el-sorteo", `${env}=yes`],
    ];
    for (const [id, sample] of mustMatch) {
      expect(byId.get(id)?.test(sample), `${id} deberia detectar: ${sample}`).toBe(true);
    }

    const mustNotMatch: readonly string[] = [
      `${snake}: false,`,
      `${snake} boolean NOT NULL DEFAULT FALSE,`,
      `${env}=false`,
      `${snake}: 10,`,
      `if (!flags.${camel}) return;`,
    ];
    for (const sample of mustNotMatch) {
      for (const rule of RULES) {
        expect(rule.pattern.test(sample), `${rule.id} no deberia detectar: ${sample}`).toBe(false);
      }
    }
  });

  it("no hay ningun sitio del repositorio que lo deje activado", () => {
    const offences = scanRepository();
    const detail = offences
      .map((offence) => `${offence.file}:${String(offence.line)} [${offence.rule}] ${offence.text}`)
      .join("\n");
    expect(offences, `El sorteo interno aparece activado:\n${detail}`).toStrictEqual([]);
  });

  it("no existe ninguna variable de entorno que active el sorteo", () => {
    expect(repoPathExists(".env.example")).toBe(true);
    const example = readRepoFile(".env.example");
    const drawVariables = example
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))
      .map((line) => line.slice(0, line.indexOf("=")).trim())
      .filter((name) => /DRAW|SORTEO|WINNER_SELECT/i.test(name));

    expect(
      drawVariables,
      "DEC-017: el sorteo no se activa con una variable de entorno. Hacen falta cinco cerrojos, y uno es una DrawAuthorization viva.",
    ).toStrictEqual([]);
  });
});
