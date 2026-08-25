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
 * se detecte a si mismo.
 */

import { describe, expect, it } from "vitest";

import { listRepoTextFiles, readRepoFile, repoPathExists } from "../helpers/repo.js";

const FLAG = `internal${"_draw_enabled"}`;
const PREFIX = `INTERNAL${"_DRAW"}`;

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly rule: string;
}

const RULES: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  {
    id: "flag-asignado-a-verdadero",
    pattern: new RegExp(`${FLAG}["']?\s*[:=]\s*true`, "i"),
  },
  {
    id: "columna-con-default-verdadero",
    pattern: new RegExp(`${FLAG}[^\n]{0,120}default\s+true`, "i"),
  },
  {
    id: "variable-de-entorno-que-activa-el-sorteo",
    pattern: new RegExp(`${PREFIX}[A-Z_]*\s*=\s*(true|1|on|yes|enabled)`, "i"),
  },
];

// Ficheros que describen la invariante en prosa y no pueden violarla.
const DOCUMENTATION = new Set(["docs/DECISIONS.md", "docs/SECURITY.md", "docs/THREAT_MODEL.md"]);

function scanRepository(): readonly Offence[] {
  const offences: Offence[] = [];

  for (const file of listRepoTextFiles()) {
    if (DOCUMENTATION.has(file.path)) {
      continue;
    }
    const contents = readRepoFile(file.path);
    if (!contents.toLowerCase().includes(FLAG) && !contents.includes(PREFIX)) {
      continue;
    }
    const lines = contents.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] ?? "";
      for (const rule of RULES) {
        if (rule.pattern.test(text)) {
          offences.push({ file: file.path, line: index + 1, text: text.trim(), rule: rule.id });
        }
      }
    }
  }

  return offences;
}

describe("DEC-017: el sorteo interno esta desactivado por defecto", () => {
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
