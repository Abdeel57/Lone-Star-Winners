import type { OfficialRulesDocumentContent, OfficialRulesResponse } from "@/lib/api";

/**
 * Fixtures de Reglas Oficiales.
 *
 * AVISO IMPORTANTE
 * ----------------
 * El texto de estos fixtures NO son reglas. Es relleno explicito, escrito para
 * que se note que es relleno, porque las Official Rules las redacta el abogado
 * del cliente y el repositorio solo las consume (CLAUDE.md #1).
 *
 * Aqui no hay ni una edad minima, ni un estado elegible, ni una fecha de
 * sorteo, ni un metodo de participacion concreto. Si alguien copiara este
 * archivo a produccion, no habria colado ninguna afirmacion legal: se veria a
 * simple vista que falta el documento.
 *
 * Lo que estos fixtures SI sirven para probar es la mecanica de DEC-022: que el
 * frontend renderiza el texto tal como llega, que dice que idioma es el
 * legalmente controlante y cual es traduccion informativa, y que sabe
 * comportarse cuando esa informacion falta.
 *
 * El cuerpo va en una sola cadena con lineas en blanco entre parrafos, que es
 * la forma que publica `docs/API_CONTRACT.md`.
 */

const ENGLISH_CONTENT: OfficialRulesDocumentContent = {
  locale: "en-US",
  is_legally_controlling: true,
  is_informational_translation: false,
  title: "Official Rules — awaiting the approved text",
  body: [
    "This is not a set of Official Rules. It is a placeholder served by the development API so that this page can be built and reviewed before the approved document exists.",
    "It deliberately states nothing: no eligibility, no minimum age, no covered states or territories, no promotion dates, no method of entry, no odds and no winner selection procedure. Every one of those is determined by the client attorney and reaches this page from the backend, exactly as issued.",
    "Until that text is published, this page shows what is here and nothing more. Nothing on this screen may be relied on.",
  ].join("\n\n"),
};

const SPANISH_CONTENT: OfficialRulesDocumentContent = {
  locale: "es-US",
  is_legally_controlling: false,
  is_informational_translation: true,
  title: "Reglas Oficiales — a la espera del texto aprobado",
  body: [
    "Esto no son Reglas Oficiales. Es un texto de relleno servido por la API de desarrollo, para poder construir y revisar esta página antes de que exista el documento aprobado.",
    "No afirma nada, y es deliberado: ni elegibilidad, ni edad mínima, ni estados o territorios cubiertos, ni fechas de la promoción, ni método de participación, ni probabilidades, ni procedimiento de selección del ganador. Todo eso lo determina el abogado del cliente y llega a esta página desde el backend, tal como fue emitido.",
    "Hasta que se publique ese texto, esta página muestra lo que hay aquí y nada más. Nada de esta pantalla puede darse por válido.",
  ].join("\n\n"),
};

/**
 * Caso habitual: el ingles controla y el espanol es traduccion informativa.
 *
 * Es el reparto mas probable en un producto estadounidense, pero NO se da por
 * supuesto en ningun sitio del codigo: la interfaz lo lee de las banderas.
 */
export const officialRules: OfficialRulesResponse = {
  rules_version_id: "prv_0000000000000001",
  version: 1,
  effective_at: "2026-08-01T05:00:00.000Z",
  documents: [ENGLISH_CONTENT, SPANISH_CONTENT],
};

/**
 * Caso invertido: el espanol controla.
 *
 * Existe para comprobar que la interfaz NO tiene el ingles cableado como idioma
 * controlante. Si alguien lo asumiera en algun componente, este fixture lo
 * destapa.
 */
export const officialRulesSpanishControlling: OfficialRulesResponse = {
  ...officialRules,
  documents: [
    { ...ENGLISH_CONTENT, is_legally_controlling: false, is_informational_translation: true },
    { ...SPANISH_CONTENT, is_legally_controlling: true, is_informational_translation: false },
  ],
};

/** Caso en el que ambas versiones estan aprobadas como controlantes. */
export const officialRulesBothControlling: OfficialRulesResponse = {
  ...officialRules,
  documents: [
    ENGLISH_CONTENT,
    { ...SPANISH_CONTENT, is_legally_controlling: true, is_informational_translation: false },
  ],
};

/**
 * Caso DEFECTUOSO: ninguna version se declara controlante.
 *
 * No es un caso hipotetico: es lo que llega hoy, porque el idioma legalmente
 * controlante sigue en `TBD` (`docs/LEGAL_PENDING.md`). La interfaz tiene que
 * decirlo en vez de elegir una por su cuenta, porque elegir seria afirmar algo
 * legal que nadie ha aprobado.
 */
export const officialRulesWithoutControlling: OfficialRulesResponse = {
  ...officialRules,
  documents: [
    { ...ENGLISH_CONTENT, is_legally_controlling: false, is_informational_translation: true },
    SPANISH_CONTENT,
  ],
};

/** Caso en el que solo existe una version publicada. */
export const officialRulesEnglishOnly: OfficialRulesResponse = {
  ...officialRules,
  documents: [ENGLISH_CONTENT],
};
