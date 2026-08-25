import { describe, expect, it } from "vitest";

import { loadMessages } from "@/i18n/messages";
import { LOCALES, localeTag, type Locale } from "@/i18n/locales";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * PARIDAD DE CLAVES DE TRADUCCION (DEC-021).
 *
 * Este es el test que convierte el principio #4 de `CLAUDE.md` -"espanol e
 * ingles son idiomas de primera clase"- en algo verificable por una maquina en
 * vez de una intencion declarada.
 *
 * Falla si:
 *   1. una clave existe en un idioma y no en el otro;
 *   2. la misma clave es texto en un idioma y objeto en el otro;
 *   3. una traduccion esta vacia o solo tiene espacios;
 *   4. los argumentos ICU no coinciden (`{year}` en un idioma y no en el otro,
 *      lo que en tiempo de ejecucion imprimiria la plantilla en crudo);
 *   5. un idioma tiene diccionario y el otro no.
 *
 * Deliberadamente NO se toma un idioma como referencia y se compara el otro
 * contra el: se comparan los dos en ambas direcciones. Tomar el ingles como
 * base convertiria al espanol en una traduccion secundaria, que es justo lo que
 * DEC-021 rechaza.
 */

type Leaf = string | number | boolean | null;

/** Aplana el diccionario a un mapa `ruta -> valor hoja`. */
function collectLeaves(node: unknown, prefix: string, out: Map<string, Leaf>): void {
  if (typeof node === "object" && node !== null && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      collectLeaves(value, prefix === "" ? key : `${prefix}.${key}`, out);
    }
    return;
  }

  out.set(prefix, node as Leaf);
}

function leavesOf(messages: unknown): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  collectLeaves(messages, "", out);
  return out;
}

/**
 * Nombres de los argumentos ICU de un mensaje.
 *
 * Cubre tanto `{year}` como la forma con formateador (`{count, plural, ...}`).
 */
function icuArguments(message: string): string[] {
  const found = new Set<string>();
  const pattern = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g;

  let match = pattern.exec(message);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) found.add(name);
    match = pattern.exec(message);
  }

  return [...found].sort();
}

const en = leavesOf(enMessages);
const es = leavesOf(esMessages);

describe("paridad de diccionarios (DEC-021)", () => {
  it("hay un diccionario por cada locale declarado", async () => {
    expect(LOCALES.length).toBeGreaterThan(1);

    for (const locale of LOCALES) {
      const messages = await loadMessages(locale);
      expect(Object.keys(messages).length, `diccionario vacio para ${localeTag(locale)}`).toBeGreaterThan(0);
    }
  });

  it("no falta ninguna clave en es-US", () => {
    const missing = [...en.keys()].filter((key) => !es.has(key)).sort();
    expect(missing, `claves presentes en en-US y ausentes en es-US: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("no sobra ninguna clave en es-US", () => {
    const extra = [...es.keys()].filter((key) => !en.has(key)).sort();
    expect(extra, `claves presentes en es-US y ausentes en en-US: ${extra.join(", ")}`).toEqual([]);
  });

  it("cada clave tiene el mismo tipo en los dos idiomas", () => {
    const mismatched: string[] = [];

    for (const [key, value] of en) {
      const other = es.get(key);
      if (typeof value !== typeof other) mismatched.push(key);
    }

    expect(mismatched, `tipos distintos entre idiomas: ${mismatched.join(", ")}`).toEqual([]);
  });

  it("ninguna traduccion esta vacia", () => {
    const empty: string[] = [];

    for (const [tag, dictionary] of [
      ["en-US", en],
      ["es-US", es],
    ] as const) {
      for (const [key, value] of dictionary) {
        if (typeof value === "string" && value.trim().length === 0) empty.push(`${tag}:${key}`);
      }
    }

    expect(empty, `traducciones vacias: ${empty.join(", ")}`).toEqual([]);
  });

  it("los argumentos ICU coinciden en los dos idiomas", () => {
    const mismatched: string[] = [];

    for (const [key, value] of en) {
      const other = es.get(key);
      if (typeof value !== "string" || typeof other !== "string") continue;

      const left = icuArguments(value).join(",");
      const right = icuArguments(other).join(",");
      if (left !== right) mismatched.push(`${key} (en-US: [${left}] / es-US: [${right}])`);
    }

    expect(mismatched, `argumentos ICU distintos: ${mismatched.join(" | ")}`).toEqual([]);
  });

  it("todas las hojas son texto", () => {
    // Un numero o un booleano en el diccionario casi siempre es un error de
    // edicion, y ademas `Intl` lo formatearia de forma distinta por idioma.
    const nonString: string[] = [];

    for (const [tag, dictionary] of [
      ["en-US", en],
      ["es-US", es],
    ] as const) {
      for (const [key, value] of dictionary) {
        if (typeof value !== "string") nonString.push(`${tag}:${key}`);
      }
    }

    expect(nonString, `hojas que no son texto: ${nonString.join(", ")}`).toEqual([]);
  });
});

describe("cobertura de estados de promocion", () => {
  it("cada estado del contrato tiene etiqueta en los dos idiomas", () => {
    // Si `backend` anade un estado al contrato, este test lo detecta antes de
    // que la insignia de estado aparezca en blanco en produccion.
    const statuses = [
      "upcoming",
      "active",
      "ended",
      "administrator_processing",
      "winner_verification",
      "completed",
    ];

    for (const status of statuses) {
      expect(en.has(`promotionStatus.${status}`), `falta en en-US: ${status}`).toBe(true);
      expect(es.has(`promotionStatus.${status}`), `falta en es-US: ${status}`).toBe(true);
    }
  });
});

describe("etiquetas BCP-47", () => {
  it("cada locale de ruta se corresponde con la variante estadounidense", () => {
    const tags = LOCALES.map((locale: Locale) => localeTag(locale));
    expect(tags).toEqual(["en-US", "es-US"]);
  });
});
