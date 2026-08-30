/**
 * Esquemas de respuesta compartidos.
 *
 * Se declaran una vez y se reutilizan porque el serializador de DEC-014 hace
 * algo mas que dar formato: un campo que el esquema no declara NO SALE. Con un
 * esquema por handler, cada uno seria una oportunidad de dejarse un campo de
 * mas -un identificador interno, un correo- y la unica forma de saberlo seria
 * leerlos todos.
 *
 * DEC-010 gobierna los tipos: el dinero viaja como CADENA de digitos y las
 * cantidades de entries como entero. En este archivo no hay ni un `z.number()`
 * que represente dinero.
 */

import { z } from "zod";

/** DEC-030. Las dos claves son obligatorias; nunca se sirve un hueco. */
export const localizedTextSchema = z.object({
  "en-US": z.string(),
  "es-US": z.string(),
});

/** DEC-010: `amount_minor` es cadena, no numero. */
export const moneySchema = z.object({
  amount_minor: z.string(),
  currency: z.string().length(3),
});

/** DEC-052. Etiqueta de catalogo: NO dice cuantas participaciones da nada. */
export const productKindSchema = z.enum(["MERCHANDISE", "ENTRY_PACKAGE"]);

export const promotionStatusSchema = z.enum([
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
  "CANCELLED",
]);

export const promotionSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  status: promotionStatusSchema,
  title: localizedTextSchema,
  summary: localizedTextSchema,
  /** DEC-011: zona legal IANA. Los deadlines los evalua el servidor contra ella. */
  legal_timezone: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  rules_version_id: z.uuid().nullable(),
  /**
   * `null` SIEMPRE hoy: no existe todavia ningun modelo de premio, y el valor
   * de un premio es un dato legalmente material que nadie ha aprobado. El campo
   * se sirve para que `frontend` no tenga que cambiar de forma cuando exista,
   * pero inventarle un importe seria violar el principio 2.
   */
  prize_value: moneySchema.nullable(),
});

/** Un par de enteros (DEC-010). `2X` es `2/1`; nunca un decimal. */
const rationalSchema = z.object({
  numerator: z.number().int(),
  denominator: z.number().int(),
});

/**
 * Un periodo bonus tal y como se ANUNCIA. Los mismos campos que declara la
 * version de reglas, sin nada derivado: el frontend pinta, no interpreta.
 */
export const bonusPeriodSchema = z.object({
  id: z.string(),
  multiplier: rationalSchema,
  starts_at: z.string(),
  ends_at: z.string(),
  product_kind_scope: z.array(productKindSchema).nullable(),
  sku_scope: z.array(z.string()).nullable(),
});

/**
 * Lo que la promocion ofrece, en cifras que el frontend NO calcula (13.5).
 *
 * DOS COSAS QUE ESTE OBJETO NO ES
 *
 *   1. NO es `entry_pool`. DEC-052 retiro el "universo total" de DEC-042: el
 *      10,000 del borrador v2 es el tope POR PERSONA, y publicarlo como
 *      emitidas/restantes seria describir un producto distinto del que
 *      aprueba el abogado. `per_participant_max` se pinta como "maximo N por
 *      persona" y nunca como cuantas quedan.
 *
 *   2. NO es la fuente de la configuracion AMOE. `amoe` es un RESUMEN para la
 *      portada; la fuente completa sigue siendo
 *      `GET /promotions/{slug}/amoe-config`. Duplicar la configuracion entera
 *      aqui produciria dos sitios que contestan lo mismo.
 */
export const promotionEntryOfferSchema = z.object({
  rules_version_id: z.uuid(),
  /**
   * Deriva de `purchase_entry_formula`. Con el modo por tipo, una entrada por
   * tipo CON tasa declarada; con `ENTRIES_PER_CURRENCY_UNIT`, una sola con
   * `product_kind: null`; con los demas modos, lista vacia -esas formulas no se
   * expresan como "X por dolar" y fingir que si seria inventar una tasa-.
   */
  rates: z.array(
    z.object({
      product_kind: productKindSchema.nullable(),
      entries_per_amount_unit: rationalSchema,
      /**
       * `currency` es NULABLE, y no es un descuido del contrato.
       *
       * `promotions` no tiene columna de moneda y la formula no la declara: la
       * unica fuente es `config.currency`, si las Official Rules la escriben.
       * Cuando no esta, la respuesta honesta es `null` -"la unidad de importe
       * son 100, y la moneda no la dice la configuracion"- y no un `USD`
       * puesto por el backend porque "es lo obvio". Es el mismo criterio que ya
       * aplica `promotion-context-repository`.
       */
      amount_unit: z.object({
        amount_minor: z.string(),
        currency: z.string().length(3).nullable(),
      }),
    }),
  ),
  per_participant_max: z.number().int().nullable(),
  per_order_max: z.number().int().nullable(),
  caps_enabled: z.boolean(),
  multipliers_enabled: z.boolean(),
  /**
   * El periodo vigente que el MOTOR aplicaria, con la estrategia declarada.
   * `null` si no hay ninguno o el flag esta apagado. Sale de la misma seleccion
   * que el calculo: un anuncio que eligiera por su cuenta acabaria prometiendo
   * un multiplicador que el motor no aplica.
   */
  active_bonus: bonusPeriodSchema.nullable(),
  /**
   * Todos los periodos de la version activa que no han terminado, ordenados por
   * inicio. Las Official Rules exigen anunciar los bonus ANTES de que empiecen.
   */
  bonus_periods: z.array(bonusPeriodSchema),
  amoe: z
    .object({
      enabled: z.boolean(),
      mode: z.enum(["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"]).nullable(),
      entries_per_approved_submission: z.number().int().nullable(),
      max_per_participant_per_period: z.number().int().nullable(),
      limit_period: z.enum(["DAY", "WEEK", "MONTH", "PROMOTION"]).nullable(),
    })
    .nullable(),
});

export const promotionDetailSchema = promotionSummarySchema.extend({
  rules_version: z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      effective_at: z.string().nullable(),
      /**
       * Si la version vigente tiene documento marcado como controlante. Puede
       * ser `false`: el idioma controlante sigue en `TBD`
       * (`docs/LEGAL_PENDING.md`) y el sistema no lo adivina.
       */
      has_controlling_document: z.boolean(),
    })
    .nullable(),
  /** `null` sin version de reglas activa, o si su configuracion no parsea. */
  entry_offer: promotionEntryOfferSchema.nullable(),
});

export const officialRulesSchema = z.object({
  rules_version_id: z.uuid(),
  version: z.number().int(),
  effective_at: z.string().nullable(),
  documents: z.array(
    z.object({
      locale: z.enum(["en-US", "es-US"]),
      title: z.string(),
      body: z.string(),
      is_legally_controlling: z.boolean(),
      is_informational_translation: z.boolean(),
    }),
  ),
});

/**
 * Disponibilidad publicada, en el carrito y en el catalogo (HO-017).
 *
 * ES UN OBJETO Y NO UNA CADENA porque el dia que se decida publicar la
 * cantidad, el campo cabe dentro sin cambiar el tipo de lo ya publicado.
 *
 * SOLO `status`, DE MOMENTO. `quantity_available` NO se publica: HO-017 pide
 * expresamente no revelar el inventario exacto y no hay ninguna decision en
 * `docs/DECISIONS.md` que lo autorice. Un campo opcional que aparece "por si
 * acaso" seria una decision de negocio tomada por el backend.
 *
 * LOS TRES ESTADOS SE DERIVAN DE `product_variants.stock_quantity`, la misma
 * columna que decide el `409 INSUFFICIENT_STOCK`, y de la cantidad por la que
 * pregunta cada superficie: la de la linea en el carrito, una unidad en el
 * catalogo. Ver `services/availability.ts` para la tabla exacta.
 */
export const availabilitySchema = z.object({
  status: z.enum(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]),
});

/**
 * Lo que una unidad de esta variante genera hoy (contrato 13.4).
 *
 * LO CALCULA EL BACKEND CON EL MOTOR REAL, y esa es toda la razon de que
 * exista. DRAFT v2 Opcion 2 exige que "the number of entries included in each
 * package is stated on the page where the package is offered", y la unica
 * forma honesta de decirlo es ejecutar el mismo motor que ejecutara la compra.
 * Que lo multiplicara el escaparate seria una segunda implementacion de la
 * formula sobre datos parciales -sin topes, sin elegibilidad, sin periodos- y
 * es justo lo que el escaner `no-client-entry-math` del frontend impide.
 *
 * `base_entries` se evalua con los multiplicadores APAGADOS y `entries_now` con
 * el flag real. Los dos viajan porque el anuncio de un bonus necesita ensenar
 * de cuanto se sube: con una sola cifra, "5X" seria una afirmacion que el
 * participante no puede comprobar.
 */
export const entryOfferSchema = z.object({
  base_entries: z.number().int(),
  entries_now: z.number().int(),
  multiplier_ids: z.array(z.string()),
  evaluated_at: z.string(),
  rules_version_id: z.uuid(),
});

export const variantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  /**
   * `null` = variante sin nombre, el caso normal de un producto de variante
   * unica. NO son dos cadenas vacias: la interfaz tiene que poder distinguir
   * "no hay nombre que pintar" de "el nombre esta a medias".
   */
  name: localizedTextSchema.nullable(),
  price: moneySchema,
  /** `null` = sin imagen propia; la interfaz cae a la del producto. */
  image_url: z.string().nullable(),
  /**
   * `null` cuando no hay promocion activa, no hay version de reglas activa, el
   * tipo de este producto no tiene tasa, el producto no es elegible o la
   * configuracion no parsea. NUNCA una cifra inventada: preferimos no decir
   * nada a decir un numero que la compra no va a cumplir.
   */
  entry_offer: entryOfferSchema.nullable(),
  /**
   * `stock_quantity` EN CRUDO YA NO SE PUBLICA.
   *
   * El catalogo es anonimo y publicaba el inventario exacto mientras el
   * carrito, que va con sesion, deliberadamente no lo publicaba (HO-017). Una
   * de las dos rutas estaba mal, y se resuelve hacia la que no filtra
   * informacion de negocio: aqui sale el MISMO objeto `availability` de la
   * linea del carrito, evaluado para una unidad.
   *
   * `is_purchasable` -"esta a la venta?", que no es lo mismo que "hay
   * existencias?"- sigue pendiente y NO se deduce de este campo.
   */
  availability: availabilitySchema,
});

/** Categoria comercial ya resuelta con su nombre en los dos idiomas (DEC-053). */
export const productCategorySchema = z.object({
  key: z.string(),
  name: localizedTextSchema,
});

export const productSummarySchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  slug: z.string(),
  kind: productKindSchema,
  /** `null` = sin clasificar. No es una categoria residual llamada "otras". */
  category: productCategorySchema.nullable(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  currency: z.string().length(3),
  /**
   * Enlace, no fichero. No hay almacen de medios todavia (`CLAUDE.md` 7): lo
   * que se guarda es una URL `https:` o una ruta raiz del propio sitio, y el
   * frontend vuelve a comprobar la forma antes de pintarla.
   */
  image_url: z.string().nullable(),
  variants: z.array(variantSchema),
});

export const productCategoryListSchema = z.object({
  items: z.array(productCategorySchema.extend({ position: z.number().int() })),
});

export const cartLineSchema = z.object({
  id: z.uuid(),
  variant_id: z.uuid(),
  product_slug: z.string(),
  sku: z.string(),
  name: localizedTextSchema,
  quantity: z.number().int(),
  unit_price: moneySchema,
  line_subtotal: moneySchema,
  /**
   * `null` SIEMPRE hoy, y el contrato lo dice: el esquema no tiene ninguna
   * tabla de medios -no hay `media`, `product_media` ni `variant_media`- y
   * `backend` no inventa una para rellenar un campo. Se publica igualmente,
   * nulable, para que `frontend` deje de degradar su tipo y pinte su marcador
   * de posicion sabiendo por que.
   *
   * `z.string()` y no `z.url()`: sin modelo de medios nadie ha decidido si la
   * referencia sera absoluta, relativa o de un CDN. Fijar `z.url()` aqui seria
   * tomar esa decision de pasada, y ademas haria fallar el serializador en
   * produccion el dia que se sirviera una ruta relativa.
   */
  image_url: z.string().nullable(),
  /** La cantidad por la que se pregunta es la de ESTA linea. */
  availability: availabilitySchema,
});

export const entryQuoteSchema = z.object({
  promotion_id: z.uuid(),
  rules_version_id: z.uuid(),
  engine_version: z.number().int(),
  evaluated_at: z.string(),
  eligible_subtotal: moneySchema.nullable(),
  entries_before_caps: z.number().int(),
  final_entries: z.number().int(),
  eligible_items: z.array(
    z.object({
      line_id: z.uuid(),
      sku: z.string(),
      quantity: z.number().int(),
      multiplier_ids: z.array(z.string()),
    }),
  ),
  ineligible_items: z.array(
    z.object({
      line_id: z.uuid(),
      sku: z.string(),
      /** Enum estable. El copy es de `frontend` (DEC-022). */
      reason_key: z.string(),
    }),
  ),
  applied_multipliers: z.array(
    z.object({
      id: z.string(),
      /** DEC-010: par de enteros, jamas un decimal. */
      numerator: z.number().int(),
      denominator: z.number().int(),
    }),
  ),
  applied_caps: z.array(
    z.object({
      kind: z.string(),
      limit: z.number().int(),
      entries_before: z.number().int(),
      entries_after: z.number().int(),
    }),
  ),
});

export const cartWithQuoteSchema = z.object({
  id: z.uuid(),
  currency: z.string().length(3).nullable(),
  /**
   * Ultima mutacion del carrito, LINEAS INCLUIDAS. ISO-8601 UTC.
   *
   * Existe por una razon medible que dio `frontend` en HO-017: comparado con
   * `entry_quote.evaluated_at` es lo que permite saber que la cifra de entries
   * en pantalla ya no corresponde al carrito. Sin el, la interfaz no puede
   * distinguir una cotizacion vigente de una caducada.
   *
   * `null` unicamente en el carrito vacio sintetico -el solicitante no tiene
   * carrito, no hay fila y por tanto no hay instante-. Devolver `now()` ahi
   * seria inventarse la frescura de algo que no existe.
   */
  updated_at: z.string().nullable(),
  /**
   * Suma de las cantidades de las lineas, entero. NO es el numero de lineas:
   * dos unidades de la misma variante son una linea y cuentan dos.
   *
   * Vale `0` -nunca `null`- en un carrito vacio: contar cero cosas es cero, no
   * ausencia de cuenta. La asimetria con `updated_at`, `currency` y `subtotal`
   * es deliberada.
   */
  item_count: z.number().int(),
  lines: z.array(cartLineSchema),
  subtotal: moneySchema.nullable(),
  /**
   * `null` cuando no hay promocion activa. Un carrito sigue siendo valido en el
   * periodo entre promociones: se puede comprar mercancia sin que haya nada que
   * cotizar. Devolver un 409 en `GET /cart` haria imposible ver el carrito.
   */
  entry_quote: entryQuoteSchema.nullable(),
});

export const publicConfigSchema = z.object({
  feature_flags: z.record(z.string(), z.boolean()),
  amoe_mode: z.enum(["ONLINE_FORM", "MAIL_IN_REVIEW", "CODE", "EXTERNAL_INSTRUCTIONS"]).nullable(),
  supported_locales: z.array(z.enum(["en-US", "es-US"])),
});
