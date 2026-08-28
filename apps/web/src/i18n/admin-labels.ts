import { getTranslations } from "next-intl/server";

import type {
  AdjustmentStatus,
  AmoeSubmissionStatus,
  DrawAuthorizationStatus,
  ExportSnapshotStatus,
  RulesVersionStatus,
} from "@/lib/api";

import type { Locale } from "./locales";

/**
 * Texto de los enums del panel (DEC-022).
 *
 * POR QUE AQUI SON FABRICAS ASINCRONAS Y EN EL ESCAPARATE SON HOOKS
 * ----------------------------------------------------------------
 * En el escaparate, `useTranslations()` resuelve el idioma a partir de
 * `requestLocale`, que escribe el middleware de next-intl. Bajo `/admin` ese
 * middleware NO corre (DEC-048): el idioma esta en el segmento de ruta y lo
 * unico fiable es pasarlo EXPLICITAMENTE. `getTranslations({ locale, namespace })`
 * lo acepta; un hook no.
 *
 * La consecuencia practica es que las pantallas del panel son componentes de
 * servidor ASINCRONOS, que es lo que ya son de todos modos porque piden datos.
 *
 * EL RESTO DEL PATRON ES EL DEL ESCAPARATE
 * ----------------------------------------
 *   - El backend manda un CODIGO estable; el texto es del frontend. Ningun
 *     identificador tecnico aparece en pantalla como si fuera una frase.
 *   - La lista de valores traducidos es EXPLICITA y el `switch` es exhaustivo:
 *     anadir un valor al contrato deja de compilar en vez de pintar una clave.
 *   - Las listas ABIERTAS -motivos, claves de reglas, advertencias- caen a un
 *     texto generico que INCLUYE el identificador. Delante de un cliente eso
 *     seria inaceptable; delante de quien opera es justo lo que necesita para
 *     pedir el permiso correcto o localizar la clave en las Official Rules.
 */

export async function amoeStatusLabeller(
  locale: Locale,
): Promise<(status: AmoeSubmissionStatus) => string> {
  const t = await getTranslations({ locale, namespace: "admin.amoeStatus" });

  return (status) => {
    switch (status) {
      case "SUBMITTED":
        return t("SUBMITTED");
      case "PENDING_REVIEW":
        return t("PENDING_REVIEW");
      case "APPROVED":
        return t("APPROVED");
      case "REJECTED":
        return t("REJECTED");
      case "CANCELLED":
        return t("CANCELLED");
    }
  };
}

export async function adjustmentStatusLabeller(
  locale: Locale,
): Promise<(status: AdjustmentStatus) => string> {
  const t = await getTranslations({ locale, namespace: "admin.adjustmentStatus" });

  return (status) => {
    switch (status) {
      case "PENDING_APPROVAL":
        return t("PENDING_APPROVAL");
      case "APPROVED":
        return t("APPROVED");
      case "REJECTED":
        return t("REJECTED");
      case "APPLIED":
        return t("APPLIED");
    }
  };
}

export async function rulesStatusLabeller(
  locale: Locale,
): Promise<(status: RulesVersionStatus) => string> {
  const t = await getTranslations({ locale, namespace: "admin.rulesStatus" });

  return (status) => {
    switch (status) {
      case "DRAFT":
        return t("DRAFT");
      case "ACTIVE":
        return t("ACTIVE");
      case "ARCHIVED":
        return t("ARCHIVED");
    }
  };
}

export async function exportStatusLabeller(
  locale: Locale,
): Promise<(status: ExportSnapshotStatus) => string> {
  const t = await getTranslations({ locale, namespace: "admin.exportStatus" });

  return (status) => {
    switch (status) {
      case "DRAFT":
        return t("DRAFT");
      case "VALIDATING":
        return t("VALIDATING");
      case "VALIDATED":
        return t("VALIDATED");
      case "FINALIZED":
        return t("FINALIZED");
      case "DELIVERED":
        return t("DELIVERED");
      case "FAILED":
        return t("FAILED");
    }
  };
}

export async function drawStatusLabeller(
  locale: Locale,
): Promise<(status: DrawAuthorizationStatus) => string> {
  const t = await getTranslations({ locale, namespace: "admin.drawStatus" });

  return (status) => {
    switch (status) {
      case "PENDING_APPROVAL":
        return t("PENDING_APPROVAL");
      case "AUTHORIZED":
        return t("AUTHORIZED");
      case "REVOKED":
        return t("REVOKED");
      case "CONSUMED":
        return t("CONSUMED");
    }
  };
}

/**
 * Claves requeridas que bloquean la activacion de una version de reglas
 * (DEC-012).
 *
 * LA LISTA NO ESTA CERRADA Y NO PUEDE ESTARLO: que claves son requeridas lo
 * decide la configuracion legal, y `docs/LEGAL_PENDING.md` sigue creciendo. Las
 * que aqui tienen texto son las que hoy aparecen en ese documento; cualquier
 * otra se muestra con su IDENTIFICADOR TECNICO, que es lo que permite buscarla
 * en las Official Rules en vez de adivinar a que se refiere.
 */
const TRANSLATED_RULES_KEYS = [
  "minimum_age",
  "eligible_states",
  "excluded_states",
  "promotion_period",
  "amoe_mechanism",
  "entry_limits",
  "prize_description",
  "arv",
  "winner_selection_method",
  "winner_notification",
  "odds_statement",
  "sponsor_identity",
] as const;

type TranslatedRulesKey = (typeof TRANSLATED_RULES_KEYS)[number];

function isTranslatedRulesKey(value: string): value is TranslatedRulesKey {
  return (TRANSLATED_RULES_KEYS as readonly string[]).includes(value);
}

export async function rulesKeyLabeller(locale: Locale): Promise<(key: string) => string> {
  const t = await getTranslations({ locale, namespace: "admin.rulesKeys" });

  return (key) => {
    if (!isTranslatedRulesKey(key)) return t("unknown", { key });

    switch (key) {
      case "minimum_age":
        return t("minimum_age");
      case "eligible_states":
        return t("eligible_states");
      case "excluded_states":
        return t("excluded_states");
      case "promotion_period":
        return t("promotion_period");
      case "amoe_mechanism":
        return t("amoe_mechanism");
      case "entry_limits":
        return t("entry_limits");
      case "prize_description":
        return t("prize_description");
      case "arv":
        return t("arv");
      case "winner_selection_method":
        return t("winner_selection_method");
      case "winner_notification":
        return t("winner_notification");
      case "odds_statement":
        return t("odds_statement");
      case "sponsor_identity":
        return t("sponsor_identity");
    }
  };
}

/**
 * Motivos de las acciones sensibles.
 *
 * Ver la peticion abierta en `src/lib/admin/reason-codes.ts`: estas claves
 * deberian llegar del backend, que ya las valida. Mientras tanto son las que el
 * panel ofrece, y todas son OPERATIVAS: ninguna afirma nada sobre elegibilidad,
 * edad o condiciones de participacion (CLAUDE.md #2).
 */
const TRANSLATED_REASONS = [
  "MEETS_REQUIREMENTS",
  "MANUAL_VERIFICATION_PASSED",
  "INCOMPLETE_SUBMISSION",
  "DUPLICATE_SUBMISSION",
  "OUTSIDE_WINDOW",
  "PERIOD_LIMIT_REACHED",
  "FAILED_VERIFICATION",
  "SYSTEM_ERROR_CORRECTION",
  "PAYMENT_RECONCILIATION",
  "SUPPORT_RESOLUTION",
  "COMPLIANCE_DIRECTIVE",
  "REVIEWED_AND_CORRECT",
  "PROMOTION_LAUNCH_APPROVED",
  "ENTRY_PERIOD_ENDED",
  "EARLY_TERMINATION",
  "OTHER",
] as const;

type TranslatedReason = (typeof TRANSLATED_REASONS)[number];

function isTranslatedReason(value: string): value is TranslatedReason {
  return (TRANSLATED_REASONS as readonly string[]).includes(value);
}

export async function reasonLabeller(locale: Locale): Promise<(key: string) => string> {
  const t = await getTranslations({ locale, namespace: "admin.reasons" });

  return (key) => {
    if (!isTranslatedReason(key)) return t("unknown", { key });

    switch (key) {
      case "MEETS_REQUIREMENTS":
        return t("MEETS_REQUIREMENTS");
      case "MANUAL_VERIFICATION_PASSED":
        return t("MANUAL_VERIFICATION_PASSED");
      case "INCOMPLETE_SUBMISSION":
        return t("INCOMPLETE_SUBMISSION");
      case "DUPLICATE_SUBMISSION":
        return t("DUPLICATE_SUBMISSION");
      case "OUTSIDE_WINDOW":
        return t("OUTSIDE_WINDOW");
      case "PERIOD_LIMIT_REACHED":
        return t("PERIOD_LIMIT_REACHED");
      case "FAILED_VERIFICATION":
        return t("FAILED_VERIFICATION");
      case "SYSTEM_ERROR_CORRECTION":
        return t("SYSTEM_ERROR_CORRECTION");
      case "PAYMENT_RECONCILIATION":
        return t("PAYMENT_RECONCILIATION");
      case "SUPPORT_RESOLUTION":
        return t("SUPPORT_RESOLUTION");
      case "COMPLIANCE_DIRECTIVE":
        return t("COMPLIANCE_DIRECTIVE");
      case "REVIEWED_AND_CORRECT":
        return t("REVIEWED_AND_CORRECT");
      case "PROMOTION_LAUNCH_APPROVED":
        return t("PROMOTION_LAUNCH_APPROVED");
      case "ENTRY_PERIOD_ENDED":
        return t("ENTRY_PERIOD_ENDED");
      case "EARLY_TERMINATION":
        return t("EARLY_TERMINATION");
      case "OTHER":
        return t("OTHER");
    }
  };
}

/**
 * Advertencias que el motor devuelve en la previsualizacion de un ajuste.
 *
 * Lista abierta: el motor puede anadir una advertencia nueva y la interfaz
 * tiene que seguir mostrandola. Una advertencia que no se pinta por no estar
 * traducida es peor que una traducida a medias.
 */
const TRANSLATED_WARNINGS = [
  "ENTRY_CAP_REACHED",
  "PROMOTION_NOT_ACTIVE",
  "PARTICIPANT_DISQUALIFIED",
  "BALANCE_WOULD_GO_NEGATIVE",
  "RULES_VERSION_ARCHIVED",
] as const;

type TranslatedWarning = (typeof TRANSLATED_WARNINGS)[number];

function isTranslatedWarning(value: string): value is TranslatedWarning {
  return (TRANSLATED_WARNINGS as readonly string[]).includes(value);
}

export async function warningLabeller(locale: Locale): Promise<(key: string) => string> {
  const t = await getTranslations({ locale, namespace: "admin.warnings" });

  return (key) => {
    if (!isTranslatedWarning(key)) return t("unknown", { key });

    switch (key) {
      case "ENTRY_CAP_REACHED":
        return t("ENTRY_CAP_REACHED");
      case "PROMOTION_NOT_ACTIVE":
        return t("PROMOTION_NOT_ACTIVE");
      case "PARTICIPANT_DISQUALIFIED":
        return t("PARTICIPANT_DISQUALIFIED");
      case "BALANCE_WOULD_GO_NEGATIVE":
        return t("BALANCE_WOULD_GO_NEGATIVE");
      case "RULES_VERSION_ARCHIVED":
        return t("RULES_VERSION_ARCHIVED");
    }
  };
}

/**
 * Condiciones que bloquean una autorizacion de sorteo (DEC-017).
 *
 * Igual que las claves de reglas: una desconocida se muestra con su
 * identificador, porque quien opera necesita saber CUAL falta, no que "falta
 * algo".
 */
const TRANSLATED_DRAW_BLOCKERS = [
  "INTERNAL_DRAW_DISABLED",
  "NO_FINALIZED_SNAPSHOT",
  "PROMOTION_NOT_CLOSED",
  "RULES_VERSION_NOT_ACTIVE",
  "SECOND_APPROVAL_MISSING",
  "SAME_ACTOR_APPROVAL",
] as const;

type TranslatedDrawBlocker = (typeof TRANSLATED_DRAW_BLOCKERS)[number];

function isTranslatedDrawBlocker(value: string): value is TranslatedDrawBlocker {
  return (TRANSLATED_DRAW_BLOCKERS as readonly string[]).includes(value);
}

export async function drawBlockerLabeller(locale: Locale): Promise<(key: string) => string> {
  const t = await getTranslations({ locale, namespace: "admin.drawBlockers" });

  return (key) => {
    if (!isTranslatedDrawBlocker(key)) return t("unknown", { key });

    switch (key) {
      case "INTERNAL_DRAW_DISABLED":
        return t("INTERNAL_DRAW_DISABLED");
      case "NO_FINALIZED_SNAPSHOT":
        return t("NO_FINALIZED_SNAPSHOT");
      case "PROMOTION_NOT_CLOSED":
        return t("PROMOTION_NOT_CLOSED");
      case "RULES_VERSION_NOT_ACTIVE":
        return t("RULES_VERSION_NOT_ACTIVE");
      case "SECOND_APPROVAL_MISSING":
        return t("SECOND_APPROVAL_MISSING");
      case "SAME_ACTOR_APPROVAL":
        return t("SAME_ACTOR_APPROVAL");
    }
  };
}

/**
 * Formatea un delta de participaciones CON SU SIGNO.
 *
 * Es FORMATEO, no aritmetica: el signo ya viene en el numero y aqui solo se
 * decide como escribirlo. `Math.abs` no cambia la magnitud y la red
 * `no-client-entry-math.test.ts` distingue las dos cosas -por eso el patron
 * exige un operador aritmetico junto a un campo del contrato, y aqui no hay
 * ninguno.
 */
export function formatSignedEntries(value: number, format: (value: number) => string): string {
  return value < 0 ? `-${format(Math.abs(value))}` : `+${format(value)}`;
}
