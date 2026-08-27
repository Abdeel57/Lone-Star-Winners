import { useTranslations } from "next-intl";

import type { OrderEntryState, OrderStatus } from "@/lib/api";

/**
 * Traduccion de los enums del portal del participante.
 *
 * DOS PATRONES, Y LA DIFERENCIA IMPORTA
 * -------------------------------------
 * - `OrderStatus` y `OrderEntryState` son uniones CERRADAS que este frontend ha
 *   propuesto (`contract.ts`, marcadas `[PROVISIONAL]`). Se traducen con un
 *   `switch` exhaustivo: si `backend` anade un valor, deja de compilar en vez
 *   de aparecer en crudo en pantalla.
 * - `type`, `source_type` y `reason_key` del ledger son enums ABIERTOS: el
 *   contrato los llama "enums estables" y nombra tres valores como ejemplo sin
 *   cerrar la lista. Se traducen con el patron de `ApiErrorState`: lista
 *   explicita mas texto generico. Un valor que el backend anada manana produce
 *   una frase util -imprecisa, pero honesta- y NUNCA una clave tecnica delante
 *   de un participante.
 *
 * Fingir que los abiertos son cerrados seria peor que no traducirlos: el dia
 * que llegara un valor nuevo, el `switch` exhaustivo devolveria `undefined` y
 * la celda quedaria en blanco.
 */

export function useOrderStatusLabel(): (status: OrderStatus) => string {
  const t = useTranslations("orderStatus");

  return (status: OrderStatus): string => {
    switch (status) {
      case "PENDING_PAYMENT":
        return t("PENDING_PAYMENT");
      case "PAID":
        return t("PAID");
      case "FULFILLED":
        return t("FULFILLED");
      case "CANCELLED":
        return t("CANCELLED");
      case "REFUNDED":
        return t("REFUNDED");
      case "PARTIALLY_REFUNDED":
        return t("PARTIALLY_REFUNDED");
      case "CHARGEBACK":
        return t("CHARGEBACK");
    }
  };
}

export function useOrderEntryStateLabel(): (state: OrderEntryState) => string {
  const t = useTranslations("orderEntryState");

  return (state: OrderEntryState): string => {
    switch (state) {
      case "NOT_APPLICABLE":
        return t("NOT_APPLICABLE");
      case "PENDING_QUALIFICATION":
        return t("PENDING_QUALIFICATION");
      case "GRANTED":
        return t("GRANTED");
      case "PARTIALLY_REVERSED":
        return t("PARTIALLY_REVERSED");
      case "REVERSED":
        return t("REVERSED");
    }
  };
}

/**
 * Explicacion del estado de las participaciones de un pedido.
 *
 * Separada de la etiqueta a proposito: la etiqueta dice COMO se llama el
 * estado y esta dice QUE significa. Sin la segunda, "pendiente" y "otorgadas"
 * son dos palabras que quien acaba de comprar no puede interpretar, y la
 * diferencia entre las dos es justamente lo que este producto no puede dejar
 * ambiguo.
 *
 * `PARTIALLY_REVERSED` comparte texto con `REVERSED` porque lo que hay que
 * explicar es lo mismo -que hubo una reversion y que el movimiento original
 * sigue en el historial- y la etiqueta ya distingue el alcance.
 */
export function useOrderEntryStateBody(): (state: OrderEntryState) => string {
  const t = useTranslations("orderEntryState");

  return (state: OrderEntryState): string => {
    switch (state) {
      case "NOT_APPLICABLE":
        return t("notApplicableBody");
      case "PENDING_QUALIFICATION":
        return t("pendingBody");
      case "GRANTED":
        return t("grantedBody");
      case "PARTIALLY_REVERSED":
      case "REVERSED":
        return t("reversedBody");
    }
  };
}

/** Tipos de movimiento con texto propio en los dos idiomas. */
const TRANSLATED_ENTRY_TYPES = [
  "PURCHASE_EARNED",
  "AMOE_EARNED",
  "MANUAL_ADJUSTMENT",
  "REVERSAL",
  "EXPIRATION",
  "DISQUALIFICATION",
] as const;

type TranslatedEntryType = (typeof TRANSLATED_ENTRY_TYPES)[number];

function isTranslatedEntryType(value: string): value is TranslatedEntryType {
  return (TRANSLATED_ENTRY_TYPES as readonly string[]).includes(value);
}

export function useEntryTypeLabel(): (type: string) => string {
  const t = useTranslations("entryType");

  return (type: string): string => {
    if (isTranslatedEntryType(type)) {
      switch (type) {
        case "PURCHASE_EARNED":
          return t("PURCHASE_EARNED");
        case "AMOE_EARNED":
          return t("AMOE_EARNED");
        case "MANUAL_ADJUSTMENT":
          return t("MANUAL_ADJUSTMENT");
        case "REVERSAL":
          return t("REVERSAL");
        case "EXPIRATION":
          return t("EXPIRATION");
        case "DISQUALIFICATION":
          return t("DISQUALIFICATION");
      }
    }

    return t("fallback");
  };
}

/** Procedencias con texto propio en los dos idiomas (principio #9). */
const TRANSLATED_ENTRY_SOURCES = ["PURCHASE", "AMOE", "ADJUSTMENT"] as const;

type TranslatedEntrySource = (typeof TRANSLATED_ENTRY_SOURCES)[number];

function isTranslatedEntrySource(value: string): value is TranslatedEntrySource {
  return (TRANSLATED_ENTRY_SOURCES as readonly string[]).includes(value);
}

export function useEntrySourceLabel(): (source: string) => string {
  const t = useTranslations("entrySource");

  return (source: string): string => {
    if (isTranslatedEntrySource(source)) {
      switch (source) {
        case "PURCHASE":
          return t("PURCHASE");
        case "AMOE":
          return t("AMOE");
        case "ADJUSTMENT":
          return t("ADJUSTMENT");
      }
    }

    return t("fallback");
  };
}

/** Motivos con texto propio en los dos idiomas. */
const TRANSLATED_ENTRY_REASONS = [
  "ORDER_QUALIFIED",
  "ORDER_REFUNDED",
  "ORDER_CHARGEBACK",
  "AMOE_APPROVED",
  "MANUAL_ADJUSTMENT_APPROVED",
  "PARTICIPANT_DISQUALIFIED",
  "ENTRIES_EXPIRED",
  "PROMOTION_CANCELLED",
] as const;

type TranslatedEntryReason = (typeof TRANSLATED_ENTRY_REASONS)[number];

function isTranslatedEntryReason(value: string): value is TranslatedEntryReason {
  return (TRANSLATED_ENTRY_REASONS as readonly string[]).includes(value);
}

export function useEntryReasonLabel(): (reasonKey: string) => string {
  const t = useTranslations("entryReason");

  return (reasonKey: string): string => {
    if (isTranslatedEntryReason(reasonKey)) {
      switch (reasonKey) {
        case "ORDER_QUALIFIED":
          return t("ORDER_QUALIFIED");
        case "ORDER_REFUNDED":
          return t("ORDER_REFUNDED");
        case "ORDER_CHARGEBACK":
          return t("ORDER_CHARGEBACK");
        case "AMOE_APPROVED":
          return t("AMOE_APPROVED");
        case "MANUAL_ADJUSTMENT_APPROVED":
          return t("MANUAL_ADJUSTMENT_APPROVED");
        case "PARTICIPANT_DISQUALIFIED":
          return t("PARTICIPANT_DISQUALIFIED");
        case "ENTRIES_EXPIRED":
          return t("ENTRIES_EXPIRED");
        case "PROMOTION_CANCELLED":
          return t("PROMOTION_CANCELLED");
      }
    }

    return t("fallback");
  };
}

/** Textos de consentimiento con traduccion propia en los dos idiomas. */
const TRANSLATED_CONSENT_KEYS = ["OFFICIAL_RULES"] as const;

type TranslatedConsentKey = (typeof TRANSLATED_CONSENT_KEYS)[number];

function isTranslatedConsentKey(value: string): value is TranslatedConsentKey {
  return (TRANSLATED_CONSENT_KEYS as readonly string[]).includes(value);
}

/**
 * Texto de una casilla de consentimiento.
 *
 * El backend manda una clave y el texto es del frontend (DEC-022). Una clave
 * desconocida cae a un texto GENERICO que remite a las Reglas Oficiales, y la
 * casilla sigue siendo obligatoria: no marcarla porque el frontend no supo
 * traducirla seria dejar pasar un consentimiento que el backend exige.
 *
 * Lo que este frontend NO hace es redactar el consentimiento. El texto generico
 * no afirma nada concreto -ni edad, ni residencia, ni jurisdiccion- porque
 * inventar el contenido de un consentimiento legal es exactamente lo que
 * CLAUDE.md #2 prohibe.
 */
export function useConsentText(): (textKey: string) => string {
  const t = useTranslations("auth.consent");

  return (textKey: string): string => {
    if (isTranslatedConsentKey(textKey)) {
      switch (textKey) {
        case "OFFICIAL_RULES":
          return t("OFFICIAL_RULES");
      }
    }

    return t("fallback");
  };
}
