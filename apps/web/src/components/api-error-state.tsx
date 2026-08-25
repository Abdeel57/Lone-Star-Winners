import { ErrorState } from "@lsw/ui";
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
 * participante hispanohablante.
 *
 * SUPUESTO PENDIENTE (HO-005): la busqueda se hace por `error.code`, que
 * DEC-022 describe como enum estable. El envelope trae ademas `message_key`.
 * Cual de los dos es la clave canonica de traduccion hay que acordarlo con
 * `backend`; cambiar de uno a otro es una linea de este archivo.
 */

/**
 * Codigos con traduccion propia. Anadir uno es un acto deliberado que obliga a
 * escribir el texto en `en-US.json` y en `es-US.json`, y el test de paridad se
 * encarga de comprobar que no falte ninguno.
 */
const TRANSLATED_CODES = [
  "NETWORK_UNAVAILABLE",
  "MALFORMED_RESPONSE",
  "INTERNAL_ERROR",
  "PROMOTION_NOT_FOUND",
] as const;

type TranslatedCode = (typeof TRANSLATED_CODES)[number];

function isTranslatedCode(value: string | null): value is TranslatedCode {
  return value !== null && (TRANSLATED_CODES as readonly string[]).includes(value);
}

export function ApiErrorState({
  failure,
  action,
  headingLevel,
  className,
}: {
  readonly failure: ApiFailure;
  readonly action?: ReactNode;
  readonly headingLevel?: "h2" | "h3" | "h4";
  readonly className?: string;
}) {
  const t = useTranslations();
  const tErrors = useTranslations("apiErrors");

  // Un fallo de red o una respuesta que no respeta el envelope no traen codigo
  // de dominio; se les asigna uno propio para poder decir algo util.
  const code: string | null =
    failure.kind === "network"
      ? "NETWORK_UNAVAILABLE"
      : failure.kind === "malformed"
        ? "MALFORMED_RESPONSE"
        : failure.code;

  let description: string;
  if (isTranslatedCode(code)) {
    switch (code) {
      case "NETWORK_UNAVAILABLE":
        description = tErrors("NETWORK_UNAVAILABLE");
        break;
      case "MALFORMED_RESPONSE":
        description = tErrors("MALFORMED_RESPONSE");
        break;
      case "INTERNAL_ERROR":
        description = tErrors("INTERNAL_ERROR");
        break;
      case "PROMOTION_NOT_FOUND":
        description = tErrors("PROMOTION_NOT_FOUND");
        break;
    }
  } else {
    description = tErrors("fallback");
  }

  return (
    <ErrorState
      title={t("states.loadFailed.title")}
      description={description}
      requestIdLabel={t("states.loadFailed.requestIdLabel")}
      {...(failure.requestId === null ? {} : { requestId: failure.requestId })}
      {...(action === undefined ? {} : { action })}
      {...(headingLevel === undefined ? {} : { headingLevel })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
