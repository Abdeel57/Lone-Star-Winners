import type { Locale } from "@/i18n/locales";

import { fetchSiteConfig } from "./api";
import type { AmoeMode } from "./api/contract";
import { NO_FLAGS_LOADED, toFeatureFlags, type FeatureFlags } from "./flags";

/**
 * Lectura de feature flags en servidor (DEC-013).
 *
 * Se llama desde Server Components, en la misma peticion que el render. No hay
 * equivalente para el cliente y no debe haberlo: DEC-013 prohibe expresamente
 * leer un flag legalmente material desde el navegador o desde una variable de
 * entorno publica.
 *
 * Si la configuracion no se puede leer, no se devuelve ningun flag leido y cada
 * consulta cae en su valor SEGURO (ver `safeDefaultFor` en `./flags`). Para
 * casi todos eso significa apagado; para la segunda aprobacion de acciones
 * sensibles significa encendido, que es su direccion segura.
 */
export async function loadFeatureFlags(locale: Locale): Promise<FeatureFlags> {
  const result = await fetchSiteConfig(locale);
  return result.ok ? toFeatureFlags(result.data) : NO_FLAGS_LOADED;
}

/**
 * Configuracion de la interfaz que depende del servidor.
 *
 * Los flags y la modalidad AMOE se leen JUNTOS y en una sola llamada. Separarlos
 * en dos lecturas abriria una ventana en la que la interfaz podria creer que
 * `amoe_enabled` esta encendido y no saber todavia que modalidad renderizar, que
 * es exactamente la clase de estado a medias que DEC-013 quiere evitar.
 */
export interface ServerUiConfig {
  readonly flags: FeatureFlags;
  readonly amoeMode: AmoeMode | null;
}

export async function loadServerUiConfig(locale: Locale): Promise<ServerUiConfig> {
  const result = await fetchSiteConfig(locale);

  if (!result.ok) {
    return { flags: NO_FLAGS_LOADED, amoeMode: null };
  }

  return {
    flags: toFeatureFlags(result.data),
    amoeMode: result.data.amoe_mode,
  };
}
