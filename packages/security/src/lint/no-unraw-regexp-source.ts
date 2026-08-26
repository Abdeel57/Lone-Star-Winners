/**
 * Regla de ESLint: una expresion regular no se construye desde una cadena con
 * barras invertidas sin `String.raw`.
 *
 * POR QUE EXISTE ESTA REGLA, HABIENDO YA `no-useless-escape`
 *
 *   `HO-014`. La misma trampa del lenguaje produjo tres defectos reales en dos
 *   dominios distintos, y en los tres casos ESLint estaba avisando con
 *   `no-useless-escape`, que se leyo como un detalle de estilo.
 *
 *   Pero `no-useless-escape` NO cubre el caso peor. Solo avisa cuando el escape
 *   es INUTIL, es decir cuando `\x` no es una secuencia valida de cadena y
 *   colapsa a `x`. Eso deja fuera todas las secuencias que SI son validas en una
 *   cadena y que significan algo COMPLETAMENTE distinto en una expresion
 *   regular:
 *
 *     `\b`  en cadena es el caracter de retroceso U+0008.
 *           En regex es el limite de palabra.
 *     `\n`, `\t`, `\v`, `\f`, `\0`, `\xNN`, `\uNNNN`  idem: caracteres
 *           literales donde se pretendia una clase o un ancla.
 *
 *   `new RegExp(`\b${palabra}\b`)` compila sin error, corre sin excepcion y no
 *   encuentra nada nunca. No lo detecta ninguna regla estandar. Ese es el modo
 *   de fallo que ya se materializo aqui: un escaner que reportaba verde por
 *   AUSENCIA, no por limpieza.
 *
 * QUE HACE
 *   Prohibe la barra invertida en el texto FUENTE de una expresion regular
 *   construida desde una cadena. La solucion es siempre una de estas tres:
 *
 *     1. un literal `/.../ ` , donde el problema no existe;
 *     2. `String.raw` si hay interpolacion;
 *     3. duplicar la barra (`\\s`), que funciona pero se lee peor.
 *
 * QUE NO HACE
 *   No mira el contenido de un literal `/.../`. Para eso estan
 *   `no-useless-escape` y `no-empty-character-class`, que ahi si funcionan.
 *
 * POR QUE NO IMPORTA LOS TIPOS DE `eslint`
 *   Para que `packages/security` no adquiera una dependencia de ESLint solo por
 *   declarar una regla. Los tipos de abajo son estructurales y describen
 *   unicamente los nodos que la regla toca; ESLint pasa nodos reales, que son
 *   compatibles. La regla se prueba con el `RuleTester` de verdad desde
 *   `tests/security`, que si tiene ESLint.
 */

interface SourceNode {
  readonly type: string;
}

interface TemplateElementNode extends SourceNode {
  readonly value: { readonly raw: string };
}

interface TemplateLiteralNode extends SourceNode {
  readonly type: "TemplateLiteral";
  readonly quasis: readonly TemplateElementNode[];
}

interface StringLiteralNode extends SourceNode {
  readonly type: "Literal";
  readonly value: unknown;
  readonly raw?: string;
}

interface IdentifierNode extends SourceNode {
  readonly type: "Identifier";
  readonly name: string;
}

interface ArrayExpressionNode extends SourceNode {
  readonly type: "ArrayExpression";
  readonly elements: readonly (SourceNode | null)[];
}

interface CallLikeNode extends SourceNode {
  readonly callee: SourceNode;
  readonly arguments: readonly SourceNode[];
}

interface PropertyNode extends SourceNode {
  readonly key: SourceNode;
  readonly computed: boolean;
  readonly value: SourceNode;
}

export interface RuleReportDescriptor {
  readonly node: SourceNode;
  readonly messageId: string;
}

export interface RuleContext {
  report(descriptor: RuleReportDescriptor): void;
}

export interface EslintRuleModule {
  readonly meta: {
    readonly type: string;
    readonly docs: { readonly description: string };
    readonly schema: readonly unknown[];
    readonly messages: Readonly<Record<string, string>>;
  };
  readonly create: (context: RuleContext) => Record<string, (node: never) => void>;
}

/**
 * Nombres de propiedad que en este repositorio contienen una expresion regular
 * aunque nadie llame a `new RegExp` al lado.
 *
 * `matcher` esta aqui por el caso concreto que motivo `HO-014`: el middleware de
 * `apps/web` declaraba su patron como cadena en un objeto de configuracion, y
 * quien lo consume y lo compila es Next, no nuestro codigo. Sin esta rama, la
 * regla no habria visto ese defecto.
 */
const PATTERN_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "matcher",
  "matchers",
  "pattern",
  "patterns",
  "regex",
  "regexp",
  "regExp",
]);

const BACKSLASH = String.fromCharCode(92);

function isTemplateLiteral(node: SourceNode): node is TemplateLiteralNode {
  return node.type === "TemplateLiteral";
}

function isStringLiteral(node: SourceNode): node is StringLiteralNode {
  return node.type === "Literal" && typeof (node as StringLiteralNode).value === "string";
}

/**
 * `true` si el texto contiene una barra invertida que el motor de CADENAS va a
 * consumir antes de que el motor de expresiones regulares llegue a verla.
 *
 * NO basta con buscar una barra invertida, y esa distincion es la que separa
 * esta regla de un generador de ruido:
 *
 *   "\\s"   la barra esta escapada; la cadena resultante es `\s` y el patron
 *           es CORRECTO. Se lee peor que String.raw, pero funciona.
 *   "\s"    la barra NO esta escapada; la cadena resultante es `s` y el
 *           patron esta roto.
 *
 * La regla es aritmetica: en una serie consecutiva de barras invertidas, una
 * cantidad IMPAR deja una barra suelta que se come el caracter siguiente; una
 * cantidad par se cancela entre si. Sin esta distincion, la regla marcaria como
 * defecto justo la forma correcta, y una regla que castiga la solucion se
 * desactiva el mismo dia.
 */
function consumesEscape(raw: string): boolean {
  let run = 0;
  for (const character of raw) {
    if (character === BACKSLASH) {
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

/**
 * Se mira SIEMPRE el texto crudo (`raw`), nunca el valor ya interpretado.
 *
 * Es la diferencia entera: para cuando existe el valor cocido, `\b` ya se ha
 * convertido en U+0008 y la evidencia del error ha desaparecido, junto con la
 * posibilidad de distinguirlo de un retroceso escrito a proposito.
 */
function hasBackslashInSource(node: SourceNode): boolean {
  if (isTemplateLiteral(node)) {
    return node.quasis.some((quasi) => consumesEscape(quasi.value.raw));
  }
  if (isStringLiteral(node)) {
    const raw = node.raw;
    return typeof raw === "string" && consumesEscape(raw);
  }
  return false;
}

function calleeIsRegExp(node: CallLikeNode): boolean {
  const callee = node.callee;
  return callee.type === "Identifier" && (callee as IdentifierNode).name === "RegExp";
}

function propertyName(node: PropertyNode): string | null {
  if (node.computed) {
    return null;
  }
  const key = node.key;
  if (key.type === "Identifier") {
    return (key as IdentifierNode).name;
  }
  if (isStringLiteral(key) && typeof key.value === "string") {
    return key.value;
  }
  return null;
}

export const noUnrawRegexpSource: EslintRuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prohibe construir una expresion regular desde una cadena con barras invertidas sin String.raw (HO-014).",
    },
    schema: [],
    messages: {
      regexpArgument:
        "HO-014: esta cadena lleva una barra invertida y se compila como expresion regular. En una cadena normal `\\s` colapsa a `s` y `\\b` se convierte en el caracter de retroceso: el patron resultante no es el que aparenta, compila sin error y no encuentra nada. Usa un literal /.../, o String.raw`...` si necesitas interpolar.",
      patternProperty:
        "HO-014: esta propiedad se interpreta como expresion regular y su cadena lleva una barra invertida, que el motor de cadenas consume antes de que el motor de regex la vea. Usa String.raw`...` o duplica la barra.",
    },
  },

  create(context: RuleContext) {
    const checkRegExpConstruction = (node: CallLikeNode): void => {
      if (!calleeIsRegExp(node)) {
        return;
      }
      const source = node.arguments[0];
      if (source !== undefined && hasBackslashInSource(source)) {
        context.report({ node: source, messageId: "regexpArgument" });
      }
    };

    const checkPatternProperty = (node: PropertyNode): void => {
      const name = propertyName(node);
      if (name === null || !PATTERN_PROPERTY_NAMES.has(name)) {
        return;
      }

      const value = node.value;

      if (hasBackslashInSource(value)) {
        context.report({ node: value, messageId: "patternProperty" });
        return;
      }

      if (value.type === "ArrayExpression") {
        for (const element of (value as ArrayExpressionNode).elements) {
          if (element !== null && hasBackslashInSource(element)) {
            context.report({ node: element, messageId: "patternProperty" });
          }
        }
      }
    };

    // Los tipos de nodo declarados arriba son mas estrechos que `never`, que es
    // lo que hace que ESLint pueda invocarlos con cualquier nodo: el parametro
    // es contravariante, asi que no hace falta ninguna asercion.
    return {
      NewExpression: checkRegExpConstruction,
      CallExpression: checkRegExpConstruction,
      Property: checkPatternProperty,
    };
  },
};

/** Nombre con el que se registra en `eslint.config.mjs`. */
export const NO_UNRAW_REGEXP_SOURCE_RULE_ID = "lsw/no-unraw-regexp-source";
