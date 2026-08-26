"use server";

import { revalidatePath } from "next/cache";

import { FALLBACK_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { redirect } from "@/i18n/navigation";
import { addCartItem, removeCartItem, updateCartItem, type ApiFailure } from "@/lib/api";

import { mutableSession } from "./session-server";

/**
 * Mutaciones del carrito, como Server Actions.
 *
 * POR QUE SERVER ACTIONS Y NO `fetch` DESDE EL NAVEGADOR
 * ------------------------------------------------------
 * 1. **El navegador nunca habla con `apps/api`.** La base de la API la publica
 *    el backend en una variable NO publica y las llamadas salen del servidor de
 *    Next, igual que las lecturas (DEC-013 para los flags, y el mismo criterio
 *    para todo lo demas). No hay que exponer la superficie de la API ni la
 *    cookie de sesion a JavaScript de cliente.
 * 2. **Funcionan sin JavaScript.** Cada mutacion es un `<form>` con `action`.
 *    Anadir al carrito, cambiar cantidad y quitar una linea siguen funcionando
 *    con JS desactivado o todavia sin cargar, que en movil es la mitad de la
 *    vida util de la pagina.
 * 3. **No abren la puerta a calcular entries en el cliente.** La accion no
 *    devuelve un carrito para que el navegador lo pinte por su cuenta:
 *    invalida la ruta y el servidor vuelve a renderizar con la cotizacion que
 *    produjo el backend (DEC-023, requisito R13 de `security`).
 *
 * LO QUE ESTAS ACCIONES NO HACEN
 * ------------------------------
 * No calculan totales, no calculan participaciones y no deciden elegibilidad.
 * Mandan la intencion al backend y vuelven a pedir el estado. Toda cifra que
 * aparece en el carrito la produjo el servidor.
 */

/** Resultado de una mutacion, ya reducido a lo que la pantalla necesita. */
export interface CartActionResult {
  readonly ok: boolean;
  /**
   * Codigo estable del fallo (DEC-031), o `null` si fue bien. La pantalla lo
   * traduce; aqui no se compone ni una frase.
   */
  readonly code: string | null;
  readonly requestId: string | null;
}

function toResult(failure: ApiFailure): CartActionResult {
  const code =
    failure.kind === "network"
      ? "NETWORK_UNAVAILABLE"
      : failure.kind === "malformed"
        ? "MALFORMED_RESPONSE"
        : failure.code;

  return { ok: false, code, requestId: failure.requestId };
}

const SUCCESS: CartActionResult = { ok: false, code: null, requestId: null };

/**
 * Lee el locale del formulario y lo valida.
 *
 * Viene en un campo oculto porque una Server Action no tiene acceso al segmento
 * de ruta. Se VALIDA en vez de confiar: lo que llega de un formulario es
 * entrada de usuario, aunque lo haya puesto nuestra propia pagina.
 */
function localeFrom(formData: FormData): Locale | null {
  const raw = formData.get("locale");
  if (typeof raw !== "string") return null;
  return isLocale(raw) ? raw : null;
}

function integerFrom(formData: FormData, field: string): number | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) return null;

  return parsed;
}

function textFrom(formData: FormData, field: string): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
}

/** Anade una variante al carrito. */
export async function addToCartAction(formData: FormData): Promise<CartActionResult> {
  const locale = localeFrom(formData);
  const variantId = textFrom(formData, "variant_id");
  const quantity = integerFrom(formData, "quantity");

  if (locale === null || variantId === null || quantity === null || quantity < 1) {
    return { ok: false, code: "VALIDATION_FAILED", requestId: null };
  }

  const session = await mutableSession();
  const result = await addCartItem({ variant_id: variantId, quantity }, locale, session);

  if (!result.ok) return toResult(result.error);

  revalidatePath(`/${locale}/cart`);
  return { ...SUCCESS, ok: true };
}

/**
 * Cambia la cantidad de una linea.
 *
 * Una cantidad de 0 se trata como QUITAR. Es lo que espera quien vacia el campo
 * y guarda, y evita que el backend tenga que decidir si un carrito puede
 * contener una linea de cero unidades.
 */
export async function updateCartItemAction(formData: FormData): Promise<CartActionResult> {
  const locale = localeFrom(formData);
  const lineId = textFrom(formData, "line_id");
  const quantity = integerFrom(formData, "quantity");

  if (locale === null || lineId === null || quantity === null || quantity < 0) {
    return { ok: false, code: "VALIDATION_FAILED", requestId: null };
  }

  const session = await mutableSession();
  const result =
    quantity === 0
      ? await removeCartItem(lineId, locale, session)
      : await updateCartItem(lineId, { quantity }, locale, session);

  if (!result.ok) return toResult(result.error);

  revalidatePath(`/${locale}/cart`);
  return { ...SUCCESS, ok: true };
}

/** Quita una linea del carrito. */
export async function removeCartItemAction(formData: FormData): Promise<CartActionResult> {
  const locale = localeFrom(formData);
  const lineId = textFrom(formData, "line_id");

  if (locale === null || lineId === null) {
    return { ok: false, code: "VALIDATION_FAILED", requestId: null };
  }

  const session = await mutableSession();
  const result = await removeCartItem(lineId, locale, session);

  if (!result.ok) return toResult(result.error);

  revalidatePath(`/${locale}/cart`);
  return { ...SUCCESS, ok: true };
}

/**
 * Envoltorios para usar en un `<form action>` de servidor.
 *
 * POR QUE HACEN FALTA
 * -------------------
 * Un `<form action>` de React admite una funcion que no devuelve nada. Las
 * acciones de arriba SI devuelven resultado, porque el formulario de la ficha
 * de producto lo consume con `useActionState` para enseñar el fallo junto al
 * boton.
 *
 * En el carrito no hay `useActionState`: las lineas se renderizan en servidor y
 * no hay estado de cliente donde guardar nada. Asi que el fallo se comunica por
 * el unico canal que sobrevive a una navegacion completa y funciona sin
 * JavaScript: la URL. La pagina del carrito lee `?error=` y lo traduce con el
 * mismo mapa que el resto de la interfaz.
 *
 * Un fallo NO puede quedarse en silencio aqui. "He pulsado Actualizar y no ha
 * pasado nada" es peor que un mensaje de error: deja al participante creyendo
 * que su carrito dice algo que no dice.
 */
function cartHref(errorCode: string | null): string {
  return errorCode === null ? "/cart" : `/cart?error=${encodeURIComponent(errorCode)}`;
}

/**
 * Redirige al carrito del idioma correcto.
 *
 * Usa el `redirect` de `@/i18n/navigation` y no el de `next/navigation`
 * (DEC-021): el de Next no conoce el prefijo de idioma y sacaria al
 * participante de su idioma justo despues de tocar su carrito.
 */
function backToCart(locale: Locale, errorCode: string | null): void {
  redirect({ href: cartHref(errorCode), locale });
}

export async function updateCartItemFormAction(formData: FormData): Promise<void> {
  const result = await updateCartItemAction(formData);
  const locale = localeFrom(formData) ?? FALLBACK_LOCALE;

  backToCart(locale, result.ok ? null : (result.code ?? "INTERNAL_ERROR"));
}

export async function removeCartItemFormAction(formData: FormData): Promise<void> {
  const result = await removeCartItemAction(formData);
  const locale = localeFrom(formData) ?? FALLBACK_LOCALE;

  backToCart(locale, result.ok ? null : (result.code ?? "INTERNAL_ERROR"));
}
