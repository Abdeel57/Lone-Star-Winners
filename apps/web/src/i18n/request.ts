import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { loadMessages } from "./messages";
import { routing } from "./routing";

/**
 * Configuracion por peticion de next-intl.
 *
 * Sobre `timeZone`
 * ----------------
 * DEC-011 prohibe usar la zona horaria del navegador o la del servidor como
 * fuente de verdad. Aqui se fija UTC como zona NEUTRA de formateo: garantiza
 * que servidor y cliente rendericen lo mismo y evita el aviso de next-intl.
 *
 * Cualquier instante legalmente relevante (apertura y cierre de promocion,
 * plazos de las Official Rules) NO se formatea con esta zona: se formatea
 * explicitamente contra `promotion.legal_timezone`, que llega desde la API.
 * Ver `src/i18n/formatters.ts`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: "UTC",
  };
});
