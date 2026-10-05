"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/locales";
import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "@/lib/action-result";
import { setAdminShippingRate } from "@/lib/api";
import { mutableSession } from "@/lib/session-server";

import { priceToMinorUnits } from "./catalog-input";

/**
 * Poner la tarifa fija de envio desde el panel (DEC-079).
 *
 * El importe se teclea con decimales ("7.99") y se convierte a centavos con el
 * MISMO conversor que el precio de un producto (`priceToMinorUnits`): sin coma
 * flotante y con los decimales que admite la moneda.
 *
 * NUNCA CERO
 *   Se rechaza aqui, junto al campo, antes de llamar a la API. La API lo rechaza
 *   tambien (422) y el motor de base de datos tambien (CHECK de la 0036): este
 *   es solo el sitio donde el mensaje puede decir por que.
 */
export async function setShippingRateAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const rawLocale = formData.get("locale");
  if (typeof rawLocale !== "string" || !isLocale(rawLocale)) return invalid("VALIDATION_FAILED");
  const locale = rawLocale;

  const rawCurrency = formData.get("currency");
  const currency = typeof rawCurrency === "string" ? rawCurrency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/u.test(currency)) return invalid("VALIDATION_FAILED");

  const rawAmount = formData.get("amount");
  const amountText = typeof rawAmount === "string" ? rawAmount.trim() : "";
  if (amountText.length === 0) return invalid("FIELD_REQUIRED", "amount");

  const amountMinor = priceToMinorUnits(amountText, currency);
  if (amountMinor === null) return invalid("PRICE_INVALID", "amount");
  if (amountMinor < 1) return invalid("SHIPPING_RATE_ZERO", "amount");

  const result = await setAdminShippingRate(
    { amount_minor: amountMinor, currency },
    locale,
    await mutableSession(),
  );
  if (!result.ok) return fromFailure(result.error, "amount");

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}
