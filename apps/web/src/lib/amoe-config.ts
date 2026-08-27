import {
  AMOE_FIELD_TYPES,
  type AmoeConfig,
  type AmoeFieldSpec,
  type AmoeFieldType,
  type LocalizedText,
} from "@/lib/api";

/**
 * Campo AMOE normalizado, listo para pintar un control.
 *
 * `maxLength` es `number | null` y no `number` opcional: la API declara
 * `max_length` SIEMPRE -el dominio pone 500 cuando la configuracion no dice
 * otra cosa- pero una respuesta que llegara sin el tiene que producir un control
 * SIN tope, no un tope inventado. `null` significa exactamente eso, y lo dice
 * una sola vez en lugar de repetir `?? undefined` en cada pantalla.
 *
 * `type` se resuelve contra la lista del contrato: un valor que la interfaz no
 * conozca cae a `TEXT`, que es el control que puede transportar cualquier texto.
 * Descartar el campo seria peor -un envio incompleto que el backend rechaza- y
 * adivinar el control a partir del nombre de la clave seria inventarse el
 * formulario, que es justo lo que `required_fields` existe para impedir.
 */
export interface NormalizedAmoeField {
  /** Nombre con el que el dato viaja en el `payload`. */
  readonly key: string;
  readonly type: AmoeFieldType;
  readonly required: boolean;
  /** Clave de copy del frontend (DEC-022), sin namespace. */
  readonly labelKey: string;
  readonly maxLength: number | null;
}

/**
 * Configuracion AMOE normalizada, lista para pintar.
 *
 * POR QUE EXISTE ESTA CAPA
 * ------------------------
 * El contrato declara los campos de `AmoeConfig` como obligatorios y nulables,
 * y la API ya los sirve todos (HO-031). Pero "los sirve hoy" no es "no puede
 * faltar nunca": una promocion configurada a medias, una version anterior del
 * backend o una respuesta de un entorno distinto siguen pudiendo llegar sin
 * alguno de ellos.
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
  /**
   * Promocion a la que pertenece la configuracion.
   *
   * VIENE TAMBIEN CON LA VIA APAGADA. No es un dato de AMOE: es el dato con el
   * que se pregunto, y encontrarlo relleno junto a `enabled: false` no es
   * ninguna incoherencia que haya que detectar ni corregir.
   */
  readonly promotionId: string | null;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly instructions: LocalizedText | null;
  readonly fields: readonly NormalizedAmoeField[];
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
    fields: (config.required_fields ?? []).map(normalizeAmoeField),
    externalUrl: config.external_url ?? null,
  };
}

/**
 * Un campo del formulario, con sus ausencias resueltas.
 *
 * NO INVENTA NI UN CAMPO NI UNA REGLA: solo decide que control pintar cuando el
 * tipo no llega o no se reconoce, y que no haya tope cuando no lo declaran. Lo
 * que se pide, cuantos campos hay y cuales son obligatorios sigue viniendo
 * entero de `required_fields` (CLAUDE.md #1 y #2).
 */
export function normalizeAmoeField(field: AmoeFieldSpec): NormalizedAmoeField {
  const declaredType = field.type;
  const type = AMOE_FIELD_TYPES.includes(declaredType) ? declaredType : "TEXT";

  /*
   * Un tope tiene que ser un entero POSITIVO para servir de algo:
   * `maxLength="0"` en el marcado impide escribir en el campo, y un valor que
   * no sea numero convertiria el atributo en `NaN`. En los dos casos se pinta
   * sin tope, que es lo que hace el navegador cuando el atributo no esta.
   */
  const declaredMax = field.max_length;
  const usableMax =
    typeof declaredMax === "number" && Number.isSafeInteger(declaredMax) && declaredMax > 0;

  return {
    key: field.key,
    type,
    // `=== true` estricto: un campo obligatorio que llegara como cadena no puede
    // marcarse obligatorio por ser "truthy", y uno ausente no es obligatorio.
    // El backend revalida de todos modos y es quien decide.
    required: field.required === true,
    labelKey: field.label_key,
    maxLength: usableMax ? declaredMax : null,
  };
}

/**
 * Si el destino externo se puede pintar como enlace.
 *
 * SOLO `https:`. Un destino con otro esquema -`javascript:`, `data:`-
 * renderizado como `href` es ejecucion de codigo de terceros en la pagina, y
 * aqui el destino lo escribe quien configura la promocion.
 *
 * EL BACKEND YA LO COMPROBO -una promocion con otro esquema responde
 * `409 AMOE_CONFIG_INVALID` en vez de servir la configuracion- y esta
 * comprobacion se hace IGUALMENTE. La duplicidad es deliberada: la validacion
 * que importa es la del lado que construye el `href`, y cuesta una llamada a
 * `new URL`. Quitarla por "ya lo valida el backend" deja la pagina dependiendo
 * de que ninguna otra ruta, entorno o version sirva jamas un destino sin filtrar.
 */
export function isSafeExternalUrl(value: string | null): boolean {
  if (value === null || value.length === 0) return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
