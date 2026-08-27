import { useTranslations } from "next-intl";

import type { AmoeSubmissionStatus } from "@/lib/api";

/**
 * Texto de la via gratuita de participacion (DEC-022).
 *
 * EL FRONTEND NO REDACTA NADA DE AMOE. Las instrucciones -direccion postal,
 * formato del sobre, limites, plazos- son contenido legalmente controlante y
 * llegan del backend, que las publica en los dos idiomas y la interfaz las
 * renderiza tal cual. Lo que si es del frontend es el CROMO: las etiquetas de
 * los campos, los nombres de los estados y las explicaciones de que hace cada
 * pantalla.
 *
 * LAS ETIQUETAS DE CAMPO SON UNA LISTA CERRADA CON RESPALDO
 * ---------------------------------------------------------
 * `required_fields[].label_key` es una clave de copy del frontend, igual que
 * `ConsentRequirement.text_key`. Si el backend manda una que la interfaz no
 * conoce, el campo se pinta con una etiqueta GENERICA -nunca con la clave en
 * crudo- y se sigue enviando: perder el campo seria peor que etiquetarlo mal, y
 * ensenar `participant_full_legal_name` a alguien que quiere participar gratis
 * es lo peor de las dos opciones.
 */

const TRANSLATED_FIELD_KEYS = [
  "fullName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "dateOfBirth",
  "code",
  "note",
] as const;

type TranslatedFieldKey = (typeof TRANSLATED_FIELD_KEYS)[number];

function isTranslatedFieldKey(value: string): value is TranslatedFieldKey {
  return (TRANSLATED_FIELD_KEYS as readonly string[]).includes(value);
}

export function useAmoeFieldLabel(): (labelKey: string) => string {
  const t = useTranslations("amoe.fields");

  return (labelKey: string): string => {
    if (isTranslatedFieldKey(labelKey)) {
      switch (labelKey) {
        case "fullName":
          return t("fullName");
        case "email":
          return t("email");
        case "phone":
          return t("phone");
        case "addressLine1":
          return t("addressLine1");
        case "addressLine2":
          return t("addressLine2");
        case "city":
          return t("city");
        case "region":
          return t("region");
        case "postalCode":
          return t("postalCode");
        case "dateOfBirth":
          return t("dateOfBirth");
        case "code":
          return t("code");
        case "note":
          return t("note");
      }
    }

    return t("fallback");
  };
}

/**
 * Estado de un envio, para el portal del participante.
 *
 * `SUBMITTED` y `PENDING_REVIEW` conviven en la union por una razon concreta:
 * `docs/API_CONTRACT.md` publica el primero y la revision de este hito pidio el
 * segundo. Los dos se traducen con textos distintos porque significan cosas
 * distintas -"recibido" frente a "en revision"- y el dia que el backend cierre
 * cual usa, sobra uno.
 */
export function useAmoeSubmissionStatusLabel(): (status: AmoeSubmissionStatus) => string {
  const t = useTranslations("amoe.status");

  return (status: AmoeSubmissionStatus): string => {
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

/**
 * Motivo de rechazo de un envio, como clave estable.
 *
 * Lista abierta: el backend puede rechazar por un motivo nuevo y el
 * participante tiene que leer algo util. Una clave desconocida cae a un texto
 * generico que remite a las Reglas Oficiales, nunca a la clave en crudo.
 */
const TRANSLATED_REJECTION_REASONS = [
  "INCOMPLETE_SUBMISSION",
  "DUPLICATE_SUBMISSION",
  "OUTSIDE_WINDOW",
  "PERIOD_LIMIT_REACHED",
  "FAILED_VERIFICATION",
] as const;

type TranslatedRejectionReason = (typeof TRANSLATED_REJECTION_REASONS)[number];

function isTranslatedRejectionReason(value: string): value is TranslatedRejectionReason {
  return (TRANSLATED_REJECTION_REASONS as readonly string[]).includes(value);
}

export function useAmoeRejectionReason(): (reasonKey: string) => string {
  const t = useTranslations("amoe.rejection");

  return (reasonKey: string): string => {
    if (isTranslatedRejectionReason(reasonKey)) {
      switch (reasonKey) {
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
      }
    }

    return t("fallback");
  };
}
