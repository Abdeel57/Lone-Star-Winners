import type { ApiResult, SiteConfigResponse } from "@/lib/api";

/**
 * Longitud minima de contrasena publicada por `GET /config`.
 *
 * El numero es de `packages/security` y llega por la API; la web no tiene
 * copia. `null` cuando la configuracion fallo o no lo trae: el formulario
 * vuelve entonces a la pista generica y el minimo llega con el 422
 * `WEAK_PASSWORD`, igual que antes de que se publicara.
 *
 * Mismo criterio que los feature flags (`lib/flags.ts`): un valor que no es un
 * entero positivo se descarta en vez de pintarse.
 */
export function passwordMinimumFrom(result: ApiResult<SiteConfigResponse>): number | null {
  if (!result.ok) return null;

  const value = result.data.password_policy?.minimum_length;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
