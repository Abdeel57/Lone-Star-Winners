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
      expect(
        Object.keys(messages).length,
        `diccionario vacio para ${localeTag(locale)}`,
      ).toBeGreaterThan(0);
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

describe("cobertura de la maquina de estados", () => {
  it("cada fase tiene titulo y cuerpo en los dos idiomas", () => {
    // La insignia dice COMO se llama el estado; el aviso dice QUE significa.
    // Sin la segunda mitad, los dos estados intermedios volverian a ser
    // indistinguibles de "cerrado", que es lo que la maquina de estados existe
    // para evitar.
    const noticeKeys = [
      "upcoming",
      "active",
      "ended",
      "administratorProcessing",
      "winnerVerification",
      "completed",
    ];

    for (const key of noticeKeys) {
      for (const field of ["title", "body"]) {
        expect(en.has(`promotionState.${key}.${field}`), `falta en en-US: ${key}.${field}`).toBe(
          true,
        );
        expect(es.has(`promotionState.${key}.${field}`), `falta en es-US: ${key}.${field}`).toBe(
          true,
        );
      }
    }
  });
});

describe("cobertura de modalidades AMOE (DEC-032)", () => {
  it("las cuatro modalidades tienen texto en los dos idiomas", () => {
    // `amoe_mode` es enum precisamente porque cada modalidad necesita su propia
    // pantalla. Una modalidad sin texto dejaria sin explicacion el unico metodo
    // de participacion que no exige comprar nada.
    const modes = ["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"];

    for (const mode of modes) {
      expect(en.has(`amoe.${mode}`), `falta en en-US: ${mode}`).toBe(true);
      expect(es.has(`amoe.${mode}`), `falta en es-US: ${mode}`).toBe(true);
    }

    // Y el caso de flag encendido sin modalidad publicada.
    expect(en.has("amoe.modeNotPublished")).toBe(true);
    expect(es.has("amoe.modeNotPublished")).toBe(true);
  });

  it("las cuatro modalidades dicen cosas distintas en cada idioma", () => {
    const modes = ["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"];

    for (const dictionary of [en, es]) {
      const texts = modes.map((mode) => dictionary.get(`amoe.${mode}`));
      expect(new Set(texts).size).toBe(modes.length);
    }
  });
});

describe("lenguaje de cumplimiento (CLAUDE.md seccion 1)", () => {
  /**
   * El producto NO es una rifa, ni una loteria, ni una venta de boletos, y el
   * texto no puede describirlo asi en ninguno de los dos idiomas.
   *
   * Esto importa especialmente en espanol: una traduccion laxa -"compra tus
   * boletos", "oportunidades de ganar"- crearia una representacion legal
   * distinta de la inglesa sobre el mismo producto. El riesgo no es de estilo.
   *
   * Se comprueba sobre el DICCIONARIO ENTERO y no sobre las pantallas: asi la
   * red cubre tambien el texto que todavia no se usa en ninguna pantalla.
   */
  const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
    { pattern: /\braffles?\b/i, why: "rifa" },
    { pattern: /\blotter(y|ies)\b/i, why: "loteria" },
    { pattern: /\brifas?\b/i, why: "rifa" },
    { pattern: /\bloter[ií]as?\b/i, why: "loteria" },
    { pattern: /\bboletos?\b/i, why: "boletos" },
    { pattern: /\bticket(s)?\b/i, why: "boletos" },
    { pattern: /\bgambl\w*/i, why: "juego de azar" },
    { pattern: /\bapuestas?\b/i, why: "apuestas" },
    { pattern: /\bcasino\b/i, why: "casino" },
    // Describir la compra como adquisicion de participaciones u oportunidades.
    //
    // Los verbos van con todas sus formas a proposito. La primera version de
    // esta red solo cazaba `buy entries` y dejaba pasar `buying entries`, de
    // modo que marcaba la pregunta del FAQ en espanol y no su equivalente en
    // ingles. Una red asimetrica entre los dos idiomas es peor que no tenerla:
    // da por bueno en uno lo que prohibe en el otro.
    //
    // La ventana intermedia esta ACOTADA (`{0,12}`) en vez de usar un grupo
    // opcional con `\s+` dentro: dos cuantificadores anidados sobre el mismo
    // conjunto de caracteres es el patron que dispara retroceso catastrofico, y
    // no hace falta ninguno para cazar "buying the entries".
    {
      pattern:
        /\b(?:buy|buys|buying|bought|purchase|purchases|purchasing)\b[^.!?]{0,12}\b(?:entries|entry|chances|tickets)\b/i,
      why: "comprar participaciones",
    },
    { pattern: /\bchances?\s+to\s+win\b/i, why: "oportunidades de ganar" },
    {
      pattern:
        /\b(?:compr|adquir)[a-zé]{1,8}\b[^.!?]{0,12}\b(?:participaciones|boletos|oportunidades)\b/i,
      why: "comprar participaciones",
    },
    { pattern: /\boportunidades?\s+de\s+ganar\b/i, why: "oportunidades de ganar" },
  ];

  /**
   * Excepciones, por CLAVE y no por idioma.
   *
   * Que la excepcion sea la clave y no la cadena es deliberado: exime a la vez
   * a los dos idiomas, de modo que no puede existir una version inglesa mas
   * permisiva que la espanola ni al reves.
   *
   * `faq.q2.question` es la unica: la frase aparece formulada como PREGUNTA
   * ("¿estoy comprando participaciones?" / "am I buying entries?") y la
   * respuesta contigua la niega expresamente. Es el sitio donde el producto
   * aclara la confusion, no donde la comete.
   */
  const ALLOWED_KEYS: readonly string[] = ["faq.q2.question"];

  it("ningun texto describe la compra como una rifa, una loteria o boletos", () => {
    const offenders: string[] = [];

    for (const [tag, dictionary] of [
      ["en-US", en],
      ["es-US", es],
    ] as const) {
      for (const [key, value] of dictionary) {
        if (typeof value !== "string") continue;
        if (ALLOWED_KEYS.includes(key)) continue;

        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(value)) offenders.push(`${tag}:${key} (${why}): "${value}"`);
        }
      }
    }

    expect(offenders, `lenguaje prohibido:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("toda excepcion existe en los dos idiomas y su respuesta niega la premisa", () => {
    for (const key of ALLOWED_KEYS) {
      expect(en.has(key), `excepcion sin equivalente en en-US: ${key}`).toBe(true);
      expect(es.has(key), `excepcion sin equivalente en es-US: ${key}`).toBe(true);
    }

    // La excepcion solo se sostiene mientras la respuesta siga negandolo. Si
    // alguien reescribiera la respuesta, esto lo detiene.
    expect(en.get("faq.q2.answer")).toMatch(/^No\./);
    expect(es.get("faq.q2.answer")).toMatch(/^No\./);
  });

  it("las Reglas Oficiales se nombran igual en todo el producto", () => {
    // Si el documento aparece con tres nombres distintos, deja de ser evidente
    // que las tres referencias hablan del mismo texto vinculante.
    expect(en.get("nav.officialRules")).toBe("Official Rules");
    expect(es.get("nav.officialRules")).toBe("Reglas Oficiales");
    expect(en.get("officialRules.title")).toBe("Official Rules");
    expect(es.get("officialRules.title")).toBe("Reglas Oficiales");
  });
});

describe("etiquetas BCP-47", () => {
  it("cada locale de ruta se corresponde con la variante estadounidense", () => {
    const tags = LOCALES.map((locale: Locale) => localeTag(locale));
    expect(tags).toEqual(["en-US", "es-US"]);
  });
});
