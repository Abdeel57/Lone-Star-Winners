import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * NINGUNA CIFRA DE PARTICIPACIONES SE DERIVA EN EL CLIENTE (R13, DEC-023).
 *
 * POR QUE HACE FALTA UNA RED DE ESTE TIPO
 * ---------------------------------------
 * Los tests de render comprueban que la pantalla pinta lo que le mandan. No
 * pueden detectar al siguiente que, con toda la buena intencion, escriba
 * `summary.purchase_entries + summary.amoe_entries` porque "es obvio que el
 * total es la suma". No lo es: en cuanto hay un ajuste manual aprobado -que no
 * es ni compra ni AMOE- deja de serlo, y la pantalla empieza a ensenar una
 * cifra que no coincide con la del backend sin que nada falle.
 *
 * Peor: en este producto una cifra de participaciones tiene consecuencias
 * legales. Que exista en el repositorio una segunda forma de calcularla es el
 * problema, aunque hoy diera el mismo resultado.
 *
 * QUE COMPRUEBA, EXACTAMENTE
 * --------------------------
 * Que ningun campo de participaciones del contrato aparece junto a un operador
 * aritmetico, y que no se agrega una lista de movimientos con `reduce`. Es una
 * HEURISTICA sobre el texto del fuente, no un analisis semantico, y esta
 * calibrada para no dar falsos positivos con lo que si es legitimo:
 *
 *   - COMPARAR dos cifras (`final_entries !== entries_before_caps`) para decidir
 *     si hace falta explicar por que una bajo;
 *   - FORMATEAR una cifra (`formatEntryCount(x, locale)`);
 *   - pintar el SIGNO de un delta que ya viene con signo.
 *
 * Los operadores de comparacion no cuentan como aritmetica, y por eso el patron
 * exige `+ - * /` con espacio y descarta `<` y `>`, que ademas son JSX.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Todo lo que pinta interfaz. Los fixtures se revisan aparte, mas abajo. */
const SCANNED_DIRECTORIES = [
  join(HERE, "..", "app"),
  join(HERE, "..", "components"),
  join(HERE, "..", "lib"),
];

/** Directorio de fixtures, con su propia regla. */
const FIXTURES_DIRECTORY = join(HERE, "..", "mocks", "fixtures");

/**
 * Campos que llevan una cifra de participaciones, tal como los publica el
 * contrato. Se listan explicitamente: un campo nuevo hay que anadirlo aqui, y
 * ese acto deliberado es parte de la red.
 */
const ENTRY_FIELDS = [
  "active_entries",
  "purchase_entries",
  "amoe_entries",
  "entries_before_caps",
  "final_entries",
  "entries_granted",
  "quantity_delta",
  "entries_after",
  "entries_before",
  "base_entries_per_unit",
  /*
   * Los nombres que cerro HO-031. `entries_awarded` es el mismo dato en las tres
   * formas AMOE, y los tres de la cola de revision son la PROYECCION que calcula
   * el motor: sumar `entries_before` y `entries_if_approved` para pintar el
   * "despues" seria exactamente la segunda implementacion que esta red impide,
   * y ademas daria un numero distinto en cuanto haya un tope o una caducidad.
   *
   * `proposed_delta` viene con signo desde la previsualizacion: se formatea, no
   * se opera con el.
   */
  "entries_awarded",
  "entries_if_approved",
  "entries_after_if_approved",
  "proposed_delta",
];

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de import.meta.url, no de entrada de usuario
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
      continue;
    }

    const isSource = entry.name.endsWith(".ts") || entry.name.endsWith(".tsx");
    const isTest = entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx");
    if (isSource && !isTest) files.push(full);
  }

  return files;
}

/** Elimina comentarios: la prosa que EXPLICA la regla no puede violarla. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findEntryArithmetic(source: string): string[] {
  const found: string[] = [];

  for (const field of ENTRY_FIELDS) {
    // El campo a la izquierda de un operador aritmetico, o a la derecha.
    // `\s` obligatorio alrededor del operador: descarta nombres con guion y
    // descarta el `-` de una propiedad en un objeto literal.
    /* eslint-disable security/detect-non-literal-regexp -- `field` sale de
     * ENTRY_FIELDS, una lista literal de este archivo. No hay ninguna cadena
     * que proceda de una peticion ni de un fichero de terceros. */
    const patterns = [
      new RegExp(`${field}\\s*[+*/]\\s`),
      new RegExp(`${field}\\s-\\s`),
      new RegExp(`[+*/]\\s*[\\w.]*${field}\\b`),
      // La resta se trata aparte y exige espacios a los dos lados: sin eso, un
      // nombre de clase como `mt-s4` o una propiedad con guion darian positivo.
      new RegExp(`\\s-\\s+[\\w.]*${field}\\b`),
      new RegExp(`\\+=\\s*[\\w.]*${field}\\b`),
    ];

    /* eslint-enable security/detect-non-literal-regexp */

    for (const pattern of patterns) {
      if (pattern.test(source)) found.push(field);
    }
  }

  // Agregacion de una lista. `reduce` sobre movimientos del ledger es la otra
  // forma de reconstruir un saldo en el cliente.
  if (/\.reduce\s*\(/.test(source)) found.push("reduce");

  return [...new Set(found)];
}

describe("ninguna cifra de participaciones se calcula en el frontend (R13)", () => {
  const files = SCANNED_DIRECTORIES.flatMap((directory) => listSourceFiles(directory));

  it("encuentra fuentes que escanear", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * El detector se prueba a si mismo.
   *
   * Un escaner que no detecta nada pasa siempre, y una red que pasa siempre no
   * es una red. Aqui se le dan los dos patrones que existe para impedir y los
   * dos que NO debe marcar, de modo que un cambio que lo desafile -por ejemplo,
   * relajar el patron para callar un falso positivo- rompe este test antes de
   * dejar pasar el de verdad.
   */
  it("el detector reconoce lo que existe para impedir, y solo eso", () => {
    expect(
      findEntryArithmetic("const total = summary.purchase_entries + summary.amoe_entries;"),
    ).toContain("purchase_entries");

    expect(findEntryArithmetic("const left = cap.limit - quote.final_entries;")).toContain(
      "final_entries",
    );

    expect(
      findEntryArithmetic("items.reduce((sum, item) => sum + item.quantity_delta, 0)"),
    ).toContain("reduce");

    // Comparar dos cifras para poder explicar por que una bajo es legitimo.
    expect(findEntryArithmetic("quote.final_entries !== quote.entries_before_caps")).toEqual([]);

    // Formatear una cifra que llega calculada, tambien.
    expect(findEntryArithmetic("formatEntryCount(summary.active_entries, locale)")).toEqual([]);
  });

  it("ninguna pantalla opera aritmeticamente con un campo de participaciones", () => {
    const offenders: string[] = [];

    for (const file of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la estructura del repositorio
      const source = stripComments(readFileSync(file, "utf8"));

      for (const field of findEntryArithmetic(source)) {
        offenders.push(`${relative(HERE, file)}: ${field}`);
      }
    }

    expect(
      offenders,
      `aritmetica sobre cifras de participaciones en el cliente:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("los fixtures tampoco calculan ninguna cifra", () => {
    // Un fixture que calculara la cotizacion seria una segunda implementacion
    // del motor viviendo en el repositorio, y los tests pasarian a comprobar
    // que esa copia coincide consigo misma.
    const offenders: string[] = [];

    for (const file of listSourceFiles(FIXTURES_DIRECTORY)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de la estructura del repositorio
      const source = stripComments(readFileSync(file, "utf8"));

      for (const field of findEntryArithmetic(source)) {
        offenders.push(`${relative(HERE, file)}: ${field}`);
      }
    }

    expect(offenders, `fixtures que calculan:\n${offenders.join("\n")}`).toEqual([]);
  });
});
