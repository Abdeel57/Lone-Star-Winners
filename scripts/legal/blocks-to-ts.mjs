#!/usr/bin/env node
/**
 * Paso 2 de 2: bloques JSON (de `docx-to-blocks.ps1`) -> modulo TypeScript.
 *
 * Uso:
 *   node scripts/legal/blocks-to-ts.mjs <bloques.json> <salida.ts> <CONSTANTE> <clave> "<Titulo>" "<archivo.docx>"
 *
 * Separa la cabecera del documento -titulo, "Lone Star Winners LLC" y la linea
 * "Last updated and effective: ..."- del cuerpo, y deriva `version` (fecha ISO)
 * de esa linea. La version es lo que se guarda cuando alguien acepta el
 * documento: "acepto los Terminos" sin version es una afirmacion sin fecha.
 *
 * El texto NO se toca: es el del abogado tal cual. Si cambia el documento, se
 * vuelve a generar; el modulo lleva una cabecera que lo dice.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [input, output, constName, key, title, source] = process.argv.slice(2);
if (!input || !output || !constName || !key || !title || !source) {
  console.error(
    'Uso: node blocks-to-ts.mjs <bloques.json> <salida.ts> <CONSTANTE> <clave> "<Titulo>" "<archivo.docx>"',
  );
  process.exit(1);
}

const BOM = String.fromCharCode(0xfeff);
const raw = readFileSync(input, "utf8");
const blocks = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw);

const textOf = (block) =>
  block.t === "h" ? block.text : block.t === "p" ? block.runs.map((run) => run.x).join("") : "";

const lastUpdatedIndex = blocks.findIndex(
  (block, index) => index < 6 && /last updated/iu.test(textOf(block)),
);
if (lastUpdatedIndex === -1) {
  console.error(`No encuentro la linea "Last updated" al principio de ${source}.`);
  process.exit(1);
}

const lastUpdated = textOf(blocks[lastUpdatedIndex]).trim();
const match = /:\s*([A-Za-z]+ \d{1,2}, \d{4})/u.exec(lastUpdated);
if (match === null) {
  console.error(`La linea "${lastUpdated}" no trae una fecha reconocible.`);
  process.exit(1);
}
const parsed = new Date(`${match[1]} 12:00:00 UTC`);
const version = parsed.toISOString().slice(0, 10);

// Fuera de la cabecera: los titulos antes de "Last updated", la propia linea y
// la linea con el nombre de la empresa. Un parrafo de contenido que aparezca
// antes -la Politica de Privacidad empieza asi- se queda.
const body = blocks.filter((block, index) => {
  if (index > lastUpdatedIndex + 1) return true;
  if (index === lastUpdatedIndex) return false;
  if (index < lastUpdatedIndex && block.t === "h") return false;
  if (block.t === "p" && textOf(block).trim() === "Lone Star Winners LLC") return false;
  return true;
});

const documentObject = {
  key,
  version,
  language: "en-US",
  title,
  lastUpdated,
  source,
  blocks: body,
};

const banner = `/*
 * GENERADO por scripts/legal/blocks-to-ts.mjs desde "${source}".
 * No se edita a mano: el texto es el del abogado del cliente, tal cual. Para
 * actualizarlo, se regenera con scripts/legal/docx-to-blocks.ps1 y este script.
 */
`;

writeFileSync(
  output,
  `${banner}
import type { LegalDocument } from "./types";

export const ${constName} = ${JSON.stringify(documentObject, null, 2)} satisfies LegalDocument;
`,
  "utf8",
);

console.log(`${basename(output)}: version ${version}, ${body.length} bloques`);
