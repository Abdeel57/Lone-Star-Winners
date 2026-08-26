/**
 * INVARIANTE: la forma canonica es UNA, y rechaza todo lo que no lo sea.
 *
 * Un canonicalizador tiene dos modos de fallar, y el segundo no se ve:
 *
 *   - dar bytes DISTINTOS al mismo dato -se nota enseguida, la cadena deja de
 *     verificar-;
 *   - dar los MISMOS bytes a datos distintos, o borrar en silencio algo que
 *     debia cubrir. Eso no rompe nada, no falla ningun test escrito a la
 *     ligera, y convierte la cadena en un adorno.
 *
 * La mayoria de estos casos persiguen el segundo modo.
 *
 * Los caracteres no ASCII se construyen con `String.fromCodePoint` y nunca se
 * escriben como literales en el fichero. Un editor, un `git` mal configurado o
 * una herramienta de formato pueden normalizar el fuente, y entonces los dos
 * lados de una comparacion de normalizacion Unicode acabarian siendo el mismo
 * texto: el test pasaria sin comprobar nada. Es la misma clase de fallo que la
 * expresion regular sin `String.raw` que ya dejo ciegos a los escaneres de
 * este repositorio: verde por ausencia de comprobacion.
 */

import { describe, expect, it } from "vitest";

import { CanonicalizationError, canonicalizeToBytes, canonicalizeToString } from "@lsw/audit";

const decoder = new TextDecoder();

/** "e" con acento agudo, precompuesta (NFC). */
const E_NFC = String.fromCodePoint(0xe9);
/** "e" seguida de acento agudo combinante (NFD). Se ve igual. */
const E_NFD = `e${String.fromCodePoint(0x301)}`;

function canon(value: unknown): string {
  return decoder.decode(canonicalizeToBytes(value));
}

describe("canonicalizacion v1: mismo dato, mismos bytes", () => {
  it("el orden en que se escriben las claves es irrelevante", () => {
    expect(canon({ b: 1, a: 2, c: 3 })).toBe(canon({ c: 3, a: 2, b: 1 }));
    expect(canon({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("ordena por unidades de codigo UTF-16, como RFC 8785", () => {
    expect(canon({ a: 1, A: 2, "1": 3, z: 4 })).toBe('{"1":3,"A":2,"a":1,"z":4}');
  });

  it("ordena tambien las claves anidadas", () => {
    expect(canon({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it("el orden de un array SI es dato y se conserva", () => {
    expect(canon([1, 2, 3])).not.toBe(canon([3, 2, 1]));
  });

  it("no emite espacios insignificantes", () => {
    expect(canon({ a: [1, { b: null }] })).toBe('{"a":[1,{"b":null}]}');
  });

  it("normaliza a NFC: el mismo nombre tecleado de dos formas da un solo hash", () => {
    // macOS entrega NFD y Windows NFC. Sin normalizar, el mismo participante
    // produciria dos hashes distintos segun desde donde se escribiera.
    expect(`Jos${E_NFC}`).not.toBe(`Jos${E_NFD}`);
    expect(canon({ name: `Jos${E_NFC}` })).toBe(canon({ name: `Jos${E_NFD}` }));
  });

  it("normaliza tambien las claves", () => {
    expect(canon({ [`a${E_NFC}`]: 1 })).toBe(canon({ [`a${E_NFD}`]: 1 }));
  });

  it("-0 y 0 son el mismo numero", () => {
    expect(canon({ n: -0 })).toBe(canon({ n: 0 }));
  });
});

describe("canonicalizacion v1: datos distintos, bytes distintos", () => {
  it("un campo con null NO es lo mismo que un campo ausente", () => {
    expect(canon({ a: 1, b: null })).not.toBe(canon({ a: 1 }));
  });

  it('el numero 1 y la cadena "1" no colisionan', () => {
    expect(canon({ a: 1 })).not.toBe(canon({ a: "1" }));
  });

  it("una cadena con comillas no puede fabricar estructura", () => {
    expect(canon({ a: '","b":"x' })).not.toBe(canon({ a: "", b: "x" }));
  });
});

describe("canonicalizacion v1: lo que se rechaza, y por que importa", () => {
  it("undefined es un error, no una omision silenciosa", () => {
    // `JSON.stringify({a:1,b:undefined})` da `{"a":1}`. Heredar eso permitiria
    // omitir un campo sin que la cadena lo notase.
    expect(() => canonicalizeToBytes({ a: 1, b: undefined })).toThrow(CanonicalizationError);
  });

  it("la coma flotante se rechaza (DEC-010)", () => {
    expect(() => canonicalizeToBytes({ amount: 10.5 })).toThrow(CanonicalizationError);
    expect(() => canonicalizeToBytes({ amount: 0.1 + 0.2 })).toThrow(CanonicalizationError);
  });

  it("NaN e Infinity se rechazan", () => {
    expect(() => canonicalizeToBytes({ n: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalizeToBytes({ n: Number.POSITIVE_INFINITY })).toThrow(
      CanonicalizationError,
    );
  });

  it("un entero fuera del rango seguro debe viajar como cadena", () => {
    expect(() => canonicalizeToBytes({ seq: 2 ** 53 })).toThrow(CanonicalizationError);
    expect(canon({ seq: "9007199254740993" })).toBe('{"seq":"9007199254740993"}');
  });

  it("bigint se rechaza: seria una segunda representacion del mismo dato", () => {
    expect(() => canonicalizeToBytes({ seq: 10n })).toThrow(CanonicalizationError);
  });

  it("Date, Map y Buffer se rechazan", () => {
    expect(() => canonicalizeToBytes({ at: new Date(0) })).toThrow(CanonicalizationError);
    expect(() => canonicalizeToBytes({ m: new Map() })).toThrow(CanonicalizationError);
    expect(() => canonicalizeToBytes({ b: Buffer.from("x") })).toThrow(CanonicalizationError);
  });

  it("un surrogate suelto se rechaza", () => {
    expect(() => canonicalizeToBytes({ s: "\ud800" })).toThrow(CanonicalizationError);
  });

  it("dos claves que colapsan a la misma tras NFC son un error", () => {
    // Quedarse con una en silencio haria que un registro con la clave
    // "perdida" hashease igual que uno que nunca la tuvo. En JavaScript son
    // dos claves distintas; tras normalizar, una sola.
    const ambiguo: Record<string, number> = {};
    ambiguo[`a${E_NFC}`] = 1;
    ambiguo[`a${E_NFD}`] = 2;
    expect(Object.keys(ambiguo)).toHaveLength(2);
    expect(() => canonicalizeToBytes(ambiguo)).toThrow(CanonicalizationError);
  });

  it("el error dice DONDE esta el valor culpable", () => {
    try {
      canonicalizeToBytes({ metadata: { nested: [1, 2.5] } });
      expect.unreachable("deberia haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).path).toBe("metadata.nested.[1]");
    }
  });
});

describe("canonicalizacion v1: escapes de RFC 8785", () => {
  it("usa los escapes cortos", () => {
    expect(canonicalizeToString({ s: '\b\t\n\f\r"\\' })).toBe('{"s":"\\b\\t\\n\\f\\r\\"\\\\"}');
  });

  it("el resto de controles va como u00xx en minusculas", () => {
    expect(
      canonicalizeToString({ s: `${String.fromCodePoint(0x01)}${String.fromCodePoint(0x1f)}` }),
    ).toBe('{"s":"\\u0001\\u001f"}');
  });

  it("no escapa lo que RFC 8785 no escapa", () => {
    // Interoperabilidad: si escapasemos de mas, un tercero con una libreria
    // estandar de RFC 8785 obtendria otros bytes y no podria verificar nada.
    expect(canonicalizeToString({ s: `a/b${E_NFC}` })).toBe(`{"s":"a/b${E_NFC}"}`);
  });

  it("la salida es UTF-8 sin BOM", () => {
    const bytes = canonicalizeToBytes({ s: E_NFC });
    expect(bytes.at(0)).toBe(0x7b);
    expect([...bytes.slice(0, 3)]).not.toStrictEqual([0xef, 0xbb, 0xbf]);
  });
});
