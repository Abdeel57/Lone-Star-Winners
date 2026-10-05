/**
 * Documentos legales del sitio: Terminos, Politica de Privacidad y Aviso de
 * recopilacion de California.
 *
 * El TEXTO no es nuestro: es el del abogado del cliente, generado desde sus
 * .docx con `scripts/legal/` (CLAUDE.md #1). Aqui solo se declara su forma, que
 * es la minima que necesitan esos documentos -titulos, parrafos con negritas y
 * enlaces, listas y una tabla- para pintarse sin perder estructura.
 *
 * Las Reglas Oficiales NO estan aqui: cada promocion tiene las suyas, con
 * versiones, y viven en la version de reglas (DEC-012).
 */

export type LegalDocumentKey = "terms" | "privacy" | "california-notice";

/** Un tramo de texto con su formato. `href` solo si el .docx traia el enlace. */
export interface LegalRun {
  readonly x: string;
  readonly b?: boolean;
  readonly i?: boolean;
  readonly href?: string;
}

export type LegalBlock =
  | { readonly t: "h"; readonly text: string }
  | { readonly t: "p"; readonly runs: readonly LegalRun[] }
  | {
      readonly t: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly LegalRun[])[];
    }
  | {
      readonly t: "table";
      /** Filas -> celdas -> parrafos -> tramos. La primera fila es la cabecera. */
      readonly rows: readonly (readonly (readonly (readonly LegalRun[])[])[])[];
    };

export interface LegalDocument {
  readonly key: LegalDocumentKey;
  /**
   * Fecha ISO de "Last updated and effective". Es la VERSION que se guarda
   * cuando alguien acepta el documento.
   */
  readonly version: string;
  /** Los documentos del abogado solo existen en ingles. */
  readonly language: "en-US";
  readonly title: string;
  /** La linea tal como la escribe el documento. */
  readonly lastUpdated: string;
  /** El .docx del que se genero. */
  readonly source: string;
  readonly blocks: readonly LegalBlock[];
}
