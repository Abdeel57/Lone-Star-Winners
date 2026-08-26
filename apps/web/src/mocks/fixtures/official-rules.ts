import type { OfficialRulesContent, OfficialRulesDocument } from "@/lib/api";

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
 */

const ENGLISH_CONTENT: OfficialRulesContent = {
  locale: "en-US",
  is_legally_controlling: true,
  is_informational_translation: false,
  title: "Official Rules (placeholder document)",
  sections: [
    {
      heading: "Placeholder section",
      paragraphs: [
        "This document is a placeholder served by the simulated API. It is not a set of Official Rules and it states no eligibility, no dates and no method of participation.",
        "The approved text is drafted by the client attorney and delivered through the backend.",
      ],
    },
  ],
};

const SPANISH_CONTENT: OfficialRulesContent = {
  locale: "es-US",
  is_legally_controlling: false,
  is_informational_translation: true,
  title: "Reglas Oficiales (documento de relleno)",
  sections: [
    {
      heading: "Seccion de relleno",
      paragraphs: [
        "Este documento es relleno servido por la API simulada. No son Reglas Oficiales y no establece elegibilidad, ni fechas, ni metodo de participacion.",
        "El texto aprobado lo redacta el abogado del cliente y llega desde el backend.",
      ],
    },
  ],
};

/**
 * Caso habitual: el ingles controla y el espanol es traduccion informativa.
 *
 * Es el reparto mas probable en un producto estadounidense, pero NO se da por
 * supuesto en ningun sitio del codigo: la interfaz lo lee de las banderas.
 */
export const officialRules: OfficialRulesDocument = {
  promotion_id: "prm_0000000000000001",
  promotion_slug: "sample-promotion",
  rules_version_id: "prv_0000000000000001",
  version_label: "placeholder-1",
  effective_at: "2026-08-01T05:00:00.000Z",
  legal_timezone: "America/Chicago",
  contents: [ENGLISH_CONTENT, SPANISH_CONTENT],
};

/**
 * Caso invertido: el espanol controla.
 *
 * Existe para comprobar que la interfaz NO tiene el ingles cableado como idioma
 * controlante. Si alguien lo asumiera en algun componente, este fixture lo
 * destapa.
 */
export const officialRulesSpanishControlling: OfficialRulesDocument = {
  ...officialRules,
  contents: [
    { ...ENGLISH_CONTENT, is_legally_controlling: false, is_informational_translation: true },
    { ...SPANISH_CONTENT, is_legally_controlling: true, is_informational_translation: false },
  ],
};

/** Caso en el que ambas versiones estan aprobadas como controlantes. */
export const officialRulesBothControlling: OfficialRulesDocument = {
  ...officialRules,
  contents: [
    ENGLISH_CONTENT,
    { ...SPANISH_CONTENT, is_legally_controlling: true, is_informational_translation: false },
  ],
};

/**
 * Caso DEFECTUOSO: ninguna version se declara controlante.
 *
 * No es un caso hipotetico: es lo que llega si el backend publica una version
 * sin marcar la bandera. La interfaz tiene que decirlo en vez de elegir una por
 * su cuenta, porque elegir seria afirmar algo legal que nadie ha aprobado.
 */
export const officialRulesWithoutControlling: OfficialRulesDocument = {
  ...officialRules,
  contents: [
    { ...ENGLISH_CONTENT, is_legally_controlling: false, is_informational_translation: true },
    SPANISH_CONTENT,
  ],
};

/** Caso en el que solo existe una version publicada. */
export const officialRulesEnglishOnly: OfficialRulesDocument = {
  ...officialRules,
  contents: [ENGLISH_CONTENT],
};
