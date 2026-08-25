import type { Locale } from "@/i18n/locales";

import { fetchSiteConfig } from "./api";
import { ALL_FLAGS_OFF, toFeatureFlags, type FeatureFlags } from "./flags";

/**
 * Lectura de feature flags en servidor (DEC-013).
 *
 * Se llama desde Server Components, en la misma peticion que el render. No hay
 * equivalente para el cliente y no debe haberlo: DEC-013 prohibe expresamente
 * leer un flag legalmente material desde el navegador o desde una variable de
 * entorno publica.
 *
 * Si la configuracion no se puede leer, devuelve TODO apagado. Es la unica
 * direccion segura del fallo: una pantalla que no aparece es un problema de
 * producto; una pantalla de participacion que aparece cuando el flag estaba
 * apagado es un problema legal.
 */
export async function loadFeatureFlags(locale: Locale): Promise<FeatureFlags> {
  const result = await fetchSiteConfig(locale);
  return result.ok ? toFeatureFlags(result.data) : ALL_FLAGS_OFF;
}
