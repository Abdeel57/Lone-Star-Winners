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

export const variantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  price: moneySchema,
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

export const productSummarySchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  currency: z.string().length(3),
  variants: z.array(variantSchema),
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
