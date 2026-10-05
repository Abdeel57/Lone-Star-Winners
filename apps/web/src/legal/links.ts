import { CALIFORNIA_NOTICE } from "./california-notice";
import { PRIVACY_POLICY } from "./privacy-policy";
import { TERMS_AND_CONDITIONS } from "./terms-and-conditions";
import type { LegalDocument } from "./types";

/**
 * Rutas de los documentos legales.
 *
 * `/privacychoices` no es negociable: la Politica de Privacidad y el Aviso de
 * California publican esa URL literal (`https://LoneStarWinners.com/privacychoices`)
 * como la via para ejercer derechos. Sin prefijo de idioma, el middleware la
 * lleva a `/en` o `/es`.
 */
export const LEGAL_ROUTES = {
  terms: "/terms",
  privacy: "/privacy",
  californiaNotice: "/california-notice",
  privacyChoices: "/privacychoices",
} as const;

/** Los tres documentos, en el orden en que se enlazan. */
export const LEGAL_DOCUMENTS: readonly {
  readonly route: string;
  readonly labelKey: "terms" | "privacy" | "californiaNotice";
  readonly document: LegalDocument;
}[] = [
  { route: LEGAL_ROUTES.terms, labelKey: "terms", document: TERMS_AND_CONDITIONS },
  { route: LEGAL_ROUTES.privacy, labelKey: "privacy", document: PRIVACY_POLICY },
  {
    route: LEGAL_ROUTES.californiaNotice,
    labelKey: "californiaNotice",
    document: CALIFORNIA_NOTICE,
  },
];

/**
 * Datos de contacto del negocio que publica el pie.
 *
 * La direccion es la de las Reglas Oficiales del 2026-10-04 (Patrocinador),
 * que es el documento legal mas reciente. Los Terminos y la Politica del
 * 2026-09-30 todavia dicen "2200 N Alto Dr." -los Terminos con un
 * "[INSERT BOX NUMBER]" sin rellenar-: esos textos se publican tal cual llegaron
 * y los corrige el abogado, no este archivo.
 */
export const BUSINESS_CONTACT = {
  legalName: "Lone Star Winners LLC",
  email: "info@LoneStarWinners.com",
  street: "3601 N Grimes St Ste 400 PMB 263",
  cityStateZip: "Hobbs, NM 88240",
} as const;
