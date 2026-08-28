import type { CursorPage, LocalizedText, PromotionStatus } from "./contract";

/**
 * [CONTRATO] Altas del panel: catalogo y promociones (seccion 12).
 *
 * VIVE EN SU PROPIO FICHERO Y NO EN `contract.ts` por una razon de trabajo en
 * paralelo, no de arquitectura: `contract.ts` lo reescribe otra sesion para
 * alinear el escaparate con la API real, y dos manos sobre el mismo fichero
 * a la vez es como se pierden ediciones. La regla de `index.ts` sigue intacta:
 * los componentes importan de alli y nunca de aqui.
 *
 * Estas formas NO son provisionales: son las que publica `docs/API_CONTRACT.md`
 * seccion 12, escritas contra rutas que ya responden en produccion.
 *
 * TRES COSAS QUE LA INTERFAZ NO PUEDE DECIDIR
 * -------------------------------------------
 * 1. `price_amount_minor` es CADENA, no numero: un importe en unidad menor
 *    puede superar el entero seguro de JavaScript. `null` significa que el
 *    producto aun no tiene variante, NO que sea gratis.
 * 2. Los dos idiomas son obligatorios en el alta (principio 4). No hay
 *    `optional` en `LocalizedText` y no hay fallback de uno al otro.
 * 3. El estado no viaja en el `PATCH`: publicar, programar, activar y cerrar
 *    son rutas aparte porque exigen otra capacidad y el autorizador decide por
 *    (metodo, camino) antes de leer el cuerpo.
 */

export type AdminProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export const ADMIN_PRODUCT_STATUSES: readonly AdminProductStatus[] = [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
];

/** Producto tal como lo publica el panel: con su primera variante aplanada. */
export interface AdminProductRow {
  readonly id: string;
  readonly sku: string;
  readonly slug: string;
  readonly status: AdminProductStatus;
  /** ISO-4217, en mayusculas. */
  readonly currency: string;
  readonly name: LocalizedText;
  /** Unidad menor como cadena (DEC-010). `null` = sin variante todavia. */
  readonly price_amount_minor: string | null;
  /** `null` = existencias no gestionadas, que NO es lo mismo que cero. */
  readonly stock_quantity: number | null;
  readonly variant_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export type AdminProductPage = CursorPage<AdminProductRow>;

export interface AdminProductInput {
  readonly sku: string;
  readonly slug: string;
  readonly currency: string;
  readonly name: LocalizedText;
  readonly description: { readonly "es-US": string | null; readonly "en-US": string | null };
  /** Entero en unidad menor. Se manda como numero porque JSON no tiene enteros grandes. */
  readonly price_amount_minor: number;
  readonly stock_quantity: number | null;
}

export interface AdminProductPatch {
  readonly name?: LocalizedText;
  readonly price_amount_minor?: number;
  readonly stock_quantity?: number | null;
}

export interface AdminPromotionRow {
  readonly id: string;
  readonly slug: string;
  /** Solo lo ve el equipo. El nombre publico va en `public_name`. */
  readonly internal_name: string;
  readonly status: PromotionStatus;
  /** Zona horaria IANA legal (DEC-011). No se edita despues de crear. */
  readonly legal_timezone: string;
  /** ISO-8601 UTC, o `null` mientras no se haya fijado. */
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  /** `null` significa que NO puede activarse todavia (DEC-012). */
  readonly active_rules_version_id: string | null;
  readonly public_name: LocalizedText;
  readonly created_at: string;
  readonly updated_at: string;
}

export type AdminPromotionPage = CursorPage<AdminPromotionRow>;

export interface AdminPromotionInput {
  readonly slug: string;
  readonly internal_name: string;
  readonly legal_timezone: string;
  readonly public_name: LocalizedText;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
}

export interface AdminPromotionPatch {
  readonly internal_name?: string;
  readonly public_name?: LocalizedText;
  readonly starts_at?: string | null;
  readonly ends_at?: string | null;
}

/**
 * Motivo de una transicion sensible.
 *
 * `reason_code` lo lee el AUTORIZADOR antes del handler, con la misma forma que
 * se persiste en la traza. Sin el, la respuesta es 403 -de la puerta- y no 422.
 */
export interface AdminReasonInput {
  readonly reason_code: string;
  readonly reason_text: string | null;
}
