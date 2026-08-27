import type { AmoeConfig, AmoeFieldSpec, LocalizedText } from "@/lib/api";

/**
 * Configuracion AMOE normalizada, lista para pintar.
 *
 * POR QUE EXISTE ESTA CAPA
 * ------------------------
 * El contrato declara los campos de `AmoeConfig` como obligatorios y nulables,
 * pero el backend puede publicar -y hoy publica- una respuesta que sencillamente
 * NO trae algunos: `instructions`, `required_fields`, `promotion_id` y
 * `external_url` no estan en la version que sirve `apps/api`.
 *
 * La diferencia entre "ausente" y "nulo" no deberia importar, y por eso se
 * borra aqui, en un solo sitio. Si cada pantalla comparase con `=== null`, un
 * `undefined` se colaria por la rama del "si hay valor" y
 * `pickLocalized(undefined)` lanzaria: la via gratuita -la unica que no exige
 * comprar nada- se convertiria en una pantalla rota. Con `?? null`, un campo
 * ausente y uno nulo significan lo mismo y la interfaz cae en su estado
 * deliberado.
 *
 * NO ES TOLERANCIA A CUALQUIER COSA. Lo que no se normaliza es `enabled`: si el
 * backend no dice si la via existe, la respuesta segura es que no existe, y eso
 * se decide abajo de forma explicita.
 */
export interface NormalizedAmoeConfig {
  readonly enabled: boolean;
  readonly mode: AmoeConfig["mode"];
  readonly promotionId: string | null;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly instructions: LocalizedText | null;
  readonly fields: readonly AmoeFieldSpec[];
  readonly externalUrl: string | null;
}

export function normalizeAmoeConfig(config: AmoeConfig): NormalizedAmoeConfig {
  /*
   * `enabled` se exige BOOLEANO ESTRICTO, no se normaliza con `??`. Un valor
   * ausente, o de otro tipo, significa que no se sabe si la via existe, y la
   * unica respuesta segura a eso es que no existe: anunciar un metodo gratuito
   * que no esta configurado es afirmar algo sobre las condiciones de
   * participacion (CLAUDE.md #1 y #2).
   */
  const enabled = config.enabled === true;

  // El resto SI se normaliza: ausente y nulo significan lo mismo, "no hay dato".
  const window = config.submission_window ?? { opens_at: null, closes_at: null };

  return {
    enabled,
    mode: config.mode ?? null,
    promotionId: config.promotion_id ?? null,
    opensAt: window.opens_at ?? null,
    closesAt: window.closes_at ?? null,
    instructions: config.instructions ?? null,
    fields: config.required_fields ?? [],
    externalUrl: config.external_url ?? null,
  };
}

/**
 * Si el destino externo se puede pintar como enlace.
 *
 * SOLO `https:`. Un destino con otro esquema -`javascript:`, `data:`-
 * renderizado como `href` es ejecucion de codigo de terceros en la pagina, y
 * aqui el destino lo escribe quien configura la promocion.
 */
export function isSafeExternalUrl(value: string | null): boolean {
  if (value === null || value.length === 0) return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
