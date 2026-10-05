"use client";

import { Button, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { addToCartAction, type CartActionResult } from "@/lib/cart-actions";

/**
 * "Anadir al carrito" directo desde la tarjeta de un paquete.
 *
 * SOLO PARA PAQUETES DE UNA VARIANTE
 * ----------------------------------
 * La tarjeta de mercancia no tiene boton porque elegir variante es del
 * participante (ver `ProductCard`). Un paquete de UNA sola variante no deja nada
 * que elegir, y por eso aqui si: quien llama pasa el `variantId` solo cuando el
 * paquete tiene exactamente una. Con mas, la tarjeta enlaza a la ficha.
 *
 * Es el mismo `<form>` con server action que `AddToCartForm`, con cantidad 1: la
 * accion se pasa DIRECTAMENTE a `action`, asi que el boton funciona antes de
 * que cargue el bundle. `useActionState` solo sirve para enseñar el resultado
 * junto al boton.
 *
 * SIN SESION NO HAY CARRITO
 * -------------------------
 * Las rutas de carrito son de participante. El primer intento sin sesion vuelve
 * con `UNAUTHENTICATED` y la tarjeta ofrece entrar, en vez de un error.
 */

const INITIAL: CartActionResult = { ok: false, code: null, requestId: null };

async function submit(_previous: CartActionResult, formData: FormData): Promise<CartActionResult> {
  return addToCartAction(formData);
}

export function PackageQuickAdd({
  variantId,
  locale,
  soldOut,
  className,
}: {
  readonly variantId: string;
  readonly locale: Locale;
  readonly soldOut: boolean;
  readonly className?: string;
}) {
  const t = useTranslations("entryPackages");
  const tProduct = useTranslations("product");
  const tErrors = useTranslations("apiErrors");
  const [state, formAction, pending] = useActionState(submit, INITIAL);

  return (
    <form action={formAction} className={cn("flex flex-col gap-s2", className)}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="variant_id" value={variantId} />
      <input type="hidden" name="quantity" value="1" />

      {/* ROJO (DEC-042): es la accion de compra. */}
      <Button
        type="submit"
        variant="accent"
        size="lg"
        fullWidth
        loading={pending}
        disabled={soldOut}
        className="lsw-display italic tracking-wide"
      >
        {soldOut ? t("soldOut") : tProduct("addToCart")}
      </Button>

      {/* El resultado se anuncia: un cambio que solo se ve no existe para un
          lector de pantalla. */}
      <p aria-live="polite" className="min-h-[1.25rem] text-caption text-light-text-muted">
        {state.ok ? (
          <>
            {t("added")}{" "}
            <Link href="/cart" className="font-semibold text-light-accent underline">
              {t("viewCart")}
            </Link>
          </>
        ) : state.code === "UNAUTHENTICATED" ? (
          <Link href="/account/login" className="font-semibold text-light-accent underline">
            {t("signIn")}
          </Link>
        ) : state.code === null ? null : (
          <span className="text-light-accent">{errorMessage(state.code, tErrors)}</span>
        )}
      </p>
    </form>
  );
}

/**
 * El mismo reparto que `AddToCartForm`: un codigo que esta pantalla no conozca
 * cae al mensaje generico y nunca se muestra en crudo.
 */
function errorMessage(code: string, tErrors: ReturnType<typeof useTranslations<"apiErrors">>) {
  switch (code) {
    case "VARIANT_NOT_PURCHASABLE":
      return tErrors("VARIANT_NOT_PURCHASABLE");
    case "INSUFFICIENT_STOCK":
      return tErrors("INSUFFICIENT_STOCK");
    case "CALCULATION_CONFIG_INVALID":
      return tErrors("CALCULATION_CONFIG_INVALID");
    case "VALIDATION_FAILED":
      return tErrors("VALIDATION_FAILED");
    case "PRODUCT_NOT_FOUND":
      return tErrors("PRODUCT_NOT_FOUND");
    case "NETWORK_UNAVAILABLE":
      return tErrors("NETWORK_UNAVAILABLE");
    default:
      return tErrors("fallback");
  }
}
