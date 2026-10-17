"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/locales";
import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "@/lib/action-result";
import { setAdminCatalogOrder, type ProductKind } from "@/lib/api";
import { mutableSession } from "@/lib/session-server";

/** El mismo tope que la API (`CATALOG_ORDER_GROUP_LIMIT`). */
const GROUP_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function kindFrom(value: FormDataEntryValue | null): ProductKind | null {
  return value === "MERCHANDISE" || value === "ENTRY_PACKAGE" ? value : null;
}

/**
 * Guardar el orden de UN grupo de la tienda (DEC-088).
 *
 * El formulario manda los productos en el orden de la pantalla, un
 * `product_id` por fila. `intent=automatic` manda la lista vacia, que devuelve
 * el grupo al orden automatico.
 *
 * Si la tienda cambio mientras se ordenaba -alguien archivo un producto- la API
 * responde 409 `CATALOG_ORDER_STALE` y no guarda nada; la pantalla lo dice y
 * pide recargar. Guardar "lo que se pueda" dejaria un orden que nadie vio.
 */
export async function setCatalogOrderAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const rawLocale = formData.get("locale");
  if (typeof rawLocale !== "string" || !isLocale(rawLocale)) return invalid("VALIDATION_FAILED");
  const locale = rawLocale;

  const kind = kindFrom(formData.get("kind"));
  if (kind === null) return invalid("VALIDATION_FAILED");

  const automatic = formData.get("intent") === "automatic";
  const productIds = automatic
    ? []
    : formData.getAll("product_id").filter((value): value is string => typeof value === "string");

  if (
    productIds.length > GROUP_LIMIT ||
    productIds.some((id) => !UUID.test(id)) ||
    new Set(productIds).size !== productIds.length
  ) {
    return invalid("VALIDATION_FAILED");
  }

  const result = await setAdminCatalogOrder(
    { kind, product_ids: productIds },
    locale,
    await mutableSession(),
  );
  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}
