/**
 * Tipos de solicitud que acepta `POST /privacy-requests` (DEC-063).
 *
 * Modulo sin dependencias a proposito: lo importan el formulario de cliente y
 * la capa de API de servidor, y un import de servidor dentro de un componente
 * de cliente rompe el build de Next aunque tsc y vitest pasen.
 */
export const PRIVACY_REQUEST_TYPES = [
  "ACCESS",
  "DELETE",
  "CORRECT",
  "OPT_OUT_SALE_SHARING",
  "LIMIT_SENSITIVE",
  "APPEAL",
  "OTHER",
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export function isPrivacyRequestType(value: string | null): value is PrivacyRequestType {
  return value !== null && (PRIVACY_REQUEST_TYPES as readonly string[]).includes(value);
}
