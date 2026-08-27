import { ErrorState, type HeadingLevel } from "@lsw/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { ApiFailure } from "@/lib/api";

/**
 * Traduce un fallo de la capa de API a una pantalla de error.
 *
 * Es la aplicacion practica de DEC-022: el backend manda un CODIGO estable y el
 * texto lo pone el frontend. Este componente es el unico sitio donde un codigo
 * de la API se convierte en una frase, y solo lo hace para codigos que estan
 * traducidos en LOS DOS diccionarios. Cualquier otro cae al mensaje generico:
 * mas vale un mensaje generico que una cadena en ingles delante de un
 * participante hispanohablante, y peor todavia una clave tecnica.
 *
 * DEC-031 cierra el supuesto que quedaba abierto: `error.code` ES la clave
 * canonica de traduccion, y `message_key` esta eliminado del contrato. La
 * busqueda se hace por codigo y no existe ningun segundo campo que consultar.
 */

/**
 * Codigos con traduccion propia.
 *
 * Las tres familias que hay aqui:
 *
 * 1. Los TRANSVERSALES que publica `docs/API_CONTRACT.md` para todas las rutas.
 * 2. Los de DOMINIO de las rutas que la interfaz consume hoy (promociones,
 *    reglas, catalogo, carrito).
 * 3. Dos propios del frontend -`NETWORK_UNAVAILABLE`, `MALFORMED_RESPONSE`-
 *    para los fallos que no llegan a producir envelope. No vienen del backend
 *    y por eso no chocan con su espacio de nombres.
 *
 * Anadir uno es un acto deliberado que obliga a escribir el texto en
 * `en-US.json` y en `es-US.json`, y el test de paridad comprueba que no falte
 * ninguno de los dos.
 */
const TRANSLATED_CODES = [
  // Frontend
  "NETWORK_UNAVAILABLE",
  "MALFORMED_RESPONSE",
  "FIELD_REQUIRED",
  "PASSWORD_CONFIRMATION_MISMATCH",
  "CONSENT_REQUIRED",
  "CHECKOUT_MODE_UNSUPPORTED",
  "PAYMENT_PROVIDER_UNAVAILABLE",
  // Transversales del contrato
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "NOT_FOUND",
  // Dominio
  "PROMOTION_NOT_FOUND",
  "RULES_VERSION_NOT_FOUND",
  "PRODUCT_NOT_FOUND",
  "VARIANT_NOT_PURCHASABLE",
  "INSUFFICIENT_STOCK",
  "CART_ITEM_NOT_FOUND",
  "NO_ACTIVE_PROMOTION",
  "CALCULATION_CONFIG_INVALID",
  "ORDER_NOT_FOUND",
  "CART_EMPTY",
  "CHECKOUT_UNAVAILABLE",
  "SHIPPING_ADDRESS_INVALID",
  /*
   * Identidad (DEC-006). Estos codigos los publicara `packages/security`, no
   * `docs/API_CONTRACT.md`, y por eso son la parte mas provisional de esta
   * lista. Estan escritos con la forma que tiene el resto del contrato; si el
   * agente de identidad elige otros nombres, se renombran aqui y el resto de la
   * interfaz no se entera.
   *
   * `INVALID_CREDENTIALS` es UNO SOLO a proposito: nunca "ese correo no existe"
   * y "esa contrasena no es". Distinguirlos convierte la pantalla de inicio de
   * sesion en un comprobador de quien tiene cuenta.
   */
  "INVALID_CREDENTIALS",
  "EMAIL_ALREADY_REGISTERED",
  "WEAK_PASSWORD",
  "ACCOUNT_LOCKED",
  "EMAIL_NOT_VERIFIED",
  "RESET_TOKEN_INVALID",
  "RESET_TOKEN_EXPIRED",
  "VERIFICATION_TOKEN_INVALID",
  "VERIFICATION_TOKEN_EXPIRED",
  "MFA_CODE_INVALID",
] as const;

type TranslatedCode = (typeof TRANSLATED_CODES)[number];

function isTranslatedCode(value: string | null): value is TranslatedCode {
  return value !== null && (TRANSLATED_CODES as readonly string[]).includes(value);
}

/**
 * Texto de un codigo de error.
 *
 * `switch` exhaustivo sobre la union: anadir un codigo a `TRANSLATED_CODES` sin
 * escribir su rama deja de compilar, en vez de caer en silencio al generico.
 */
export function useApiErrorMessage(): (code: string | null) => string {
  const t = useTranslations("apiErrors");

  return (code: string | null): string => {
    if (!isTranslatedCode(code)) return t("fallback");

    switch (code) {
      case "NETWORK_UNAVAILABLE":
        return t("NETWORK_UNAVAILABLE");
      case "MALFORMED_RESPONSE":
        return t("MALFORMED_RESPONSE");
      case "UNAUTHENTICATED":
        return t("UNAUTHENTICATED");
      case "FORBIDDEN":
        return t("FORBIDDEN");
      case "VALIDATION_FAILED":
        return t("VALIDATION_FAILED");
      case "RATE_LIMITED":
        return t("RATE_LIMITED");
      case "INTERNAL_ERROR":
        return t("INTERNAL_ERROR");
      case "SERVICE_UNAVAILABLE":
        return t("SERVICE_UNAVAILABLE");
      case "PROMOTION_NOT_FOUND":
        return t("PROMOTION_NOT_FOUND");
      case "RULES_VERSION_NOT_FOUND":
        return t("RULES_VERSION_NOT_FOUND");
      case "PRODUCT_NOT_FOUND":
        return t("PRODUCT_NOT_FOUND");
      case "VARIANT_NOT_PURCHASABLE":
        return t("VARIANT_NOT_PURCHASABLE");
      case "INSUFFICIENT_STOCK":
        return t("INSUFFICIENT_STOCK");
      case "CART_ITEM_NOT_FOUND":
        return t("CART_ITEM_NOT_FOUND");
      case "NO_ACTIVE_PROMOTION":
        return t("NO_ACTIVE_PROMOTION");
      case "CALCULATION_CONFIG_INVALID":
        return t("CALCULATION_CONFIG_INVALID");
      case "FIELD_REQUIRED":
        return t("FIELD_REQUIRED");
      case "PASSWORD_CONFIRMATION_MISMATCH":
        return t("PASSWORD_CONFIRMATION_MISMATCH");
      case "CONSENT_REQUIRED":
        return t("CONSENT_REQUIRED");
      case "CHECKOUT_MODE_UNSUPPORTED":
        return t("CHECKOUT_MODE_UNSUPPORTED");
      case "PAYMENT_PROVIDER_UNAVAILABLE":
        return t("PAYMENT_PROVIDER_UNAVAILABLE");
      case "NOT_FOUND":
        return t("NOT_FOUND");
      case "ORDER_NOT_FOUND":
        return t("ORDER_NOT_FOUND");
      case "CART_EMPTY":
        return t("CART_EMPTY");
      case "CHECKOUT_UNAVAILABLE":
        return t("CHECKOUT_UNAVAILABLE");
      case "SHIPPING_ADDRESS_INVALID":
        return t("SHIPPING_ADDRESS_INVALID");
      case "INVALID_CREDENTIALS":
        return t("INVALID_CREDENTIALS");
      case "EMAIL_ALREADY_REGISTERED":
        return t("EMAIL_ALREADY_REGISTERED");
      case "WEAK_PASSWORD":
        return t("WEAK_PASSWORD");
      case "ACCOUNT_LOCKED":
        return t("ACCOUNT_LOCKED");
      case "EMAIL_NOT_VERIFIED":
        return t("EMAIL_NOT_VERIFIED");
      case "RESET_TOKEN_INVALID":
        return t("RESET_TOKEN_INVALID");
      case "RESET_TOKEN_EXPIRED":
        return t("RESET_TOKEN_EXPIRED");
      case "VERIFICATION_TOKEN_INVALID":
        return t("VERIFICATION_TOKEN_INVALID");
      case "VERIFICATION_TOKEN_EXPIRED":
        return t("VERIFICATION_TOKEN_EXPIRED");
      case "MFA_CODE_INVALID":
        return t("MFA_CODE_INVALID");
    }
  };
}

/**
 * Codigo efectivo de un fallo.
 *
 * Un fallo de red o una respuesta que no respeta el envelope no traen codigo de
 * dominio; se les asigna uno propio para poder decir algo util en vez de caer
 * al generico sin distinguir "no hay servicio" de "el servicio contesto mal".
 */
export function failureCode(failure: ApiFailure): string | null {
  switch (failure.kind) {
    case "network":
      return "NETWORK_UNAVAILABLE";
    case "malformed":
      return "MALFORMED_RESPONSE";
    case "http":
      return failure.code;
  }
}

export function ApiErrorState({
  failure,
  action,
  headingLevel,
  className,
}: {
  readonly failure: ApiFailure;
  readonly action?: ReactNode;
  readonly headingLevel?: HeadingLevel;
  readonly className?: string;
}) {
  const t = useTranslations();
  const message = useApiErrorMessage();

  return (
    <ErrorState
      title={t("states.loadFailed.title")}
      description={message(failureCode(failure))}
      requestIdLabel={t("states.loadFailed.requestIdLabel")}
      {...(failure.requestId === null ? {} : { requestId: failure.requestId })}
      {...(action === undefined ? {} : { action })}
      {...(headingLevel === undefined ? {} : { headingLevel })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
