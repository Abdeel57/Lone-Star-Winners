"use client";

import { Alert, Button, FormField, Input, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { useAvailabilityLabel } from "@/i18n/storefront-labels";
import { pickLocalized, type ProductDetail } from "@/lib/api";
import { addToCartAction, type CartActionResult } from "@/lib/cart-actions";

/**
 * Formulario para anadir una variante al carrito.
 *
 * ES UN `<form>` CON SERVER ACTION
 * --------------------------------
 * La mutacion la ejecuta el servidor de Next, que es quien habla con
 * `apps/api`. El navegador no conoce la ruta de la API ni maneja la cookie de
 * sesion.
 *
 * `useActionState` esta aqui SOLO para poder enseñar el fallo junto al boton
 * -"esa talla se acaba de agotar" es informacion que pertenece a este
 * formulario, no a otra pagina-. La accion se pasa DIRECTAMENTE a `<form
 * action>`, asi que React la envia igual sin JavaScript: el formulario funciona
 * antes de que cargue el bundle, y con JavaScript ademas conserva el error sin
 * recargar.
 *
 * AQUI NO SE CALCULA NINGUNA PARTICIPACION
 * ----------------------------------------
 * No se dice cuantas entries dara este articulo, ni siquiera "aproximadamente".
 * La unica cifra que existe la produce el backend sobre el carrito de servidor
 * (DEC-023, requisito R13 de `security`), y aparece en `/cart`. El texto lo
 * dice con esas palabras en vez de dejar al participante suponer.
 *
 * EL SELECTOR LISTA TAMBIEN LAS VARIANTES NO COMPRABLES
 * -----------------------------------------------------
 * Deshabilitadas y con su motivo en la etiqueta. Ocultarlas haria que una talla
 * agotada pareciera no existir, y quien la busca acabaria pensando que se
 * equivoco de producto.
 */

const INITIAL: CartActionResult = { ok: false, code: null, requestId: null };

/**
 * Adaptador de firma para `useActionState`.
 *
 * `useActionState` llama a la accion con `(estadoPrevio, formData)`. La accion
 * del servidor no necesita el estado previo -cada intento es independiente- y
 * por eso lo descarta aqui en vez de aceptarlo y no usarlo.
 */
async function submit(_previous: CartActionResult, formData: FormData): Promise<CartActionResult> {
  return addToCartAction(formData);
}

export function AddToCartForm({
  product,
  locale,
}: {
  readonly product: ProductDetail;
  readonly locale: Locale;
}) {
  const t = useTranslations("product");
  const availabilityLabel = useAvailabilityLabel();
  const [state, formAction, pending] = useActionState(submit, INITIAL);

  const purchasable = product.variants.filter((variant) => variant.is_purchasable);

  if (product.variants.length === 0) {
    return <Alert tone="info">{t("noVariants")}</Alert>;
  }

  if (purchasable.length === 0) {
    return <Alert tone="warning">{t("unavailable")}</Alert>;
  }

  const defaultVariant = purchasable[0];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* La accion no ve el segmento de ruta: se lo pasamos y ella lo valida. */}
      <input type="hidden" name="locale" value={locale} />

      {state.code === null ? null : <AddToCartError code={state.code} />}
      {state.ok ? <Alert tone="success">{t("added")}</Alert> : null}

      <FormField label={t("variantLabel")} controlId="variant">
        <Select name="variant_id" defaultValue={defaultVariant?.id ?? ""}>
          {product.variants.map((variant) => {
            const price = formatMoney(variant.price, locale);
            const name = pickLocalized(variant.name, locale);
            const suffix = variant.is_purchasable ? null : availabilityLabel(variant.availability);

            return (
              <option key={variant.id} value={variant.id} disabled={!variant.is_purchasable}>
                {[name, price, suffix].filter((part) => part !== null).join(" · ")}
              </option>
            );
          })}
        </Select>
      </FormField>

      <FormField label={t("quantityLabel")} controlId="quantity" className="max-w-[10rem]">
        <Input
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          defaultValue={1}
        />
      </FormField>

      {/* ROJO (DEC-042): es la accion de COMPRA de la pantalla. El oro se
          reserva para la marca y para las cifras de participaciones; aqui lo
          que hay es un carrito. */}
      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("addToCart")}
      </Button>

      <p className="text-caption text-text-subtle">{t("quoteNote")}</p>
    </form>
  );
}

/**
 * Fallo del ultimo intento de anadir.
 *
 * El backend manda `VARIANT_NOT_PURCHASABLE` o `INSUFFICIENT_STOCK` y el texto
 * es del frontend (DEC-022, DEC-031). Un codigo que esta pantalla no conozca
 * cae al mensaje generico y nunca se muestra en crudo.
 */
function AddToCartError({ code }: { readonly code: string }) {
  const tErrors = useTranslations("apiErrors");

  let message: string;
  switch (code) {
    case "UNAUTHENTICATED":
      // Las rutas de carrito son `PARTICIPANT_SELF`: sin sesion no hay carrito.
      // Se dice como lo que es -falta iniciar sesion- y no como un fallo.
      message = tErrors("UNAUTHENTICATED");
      break;
    case "VARIANT_NOT_PURCHASABLE":
      message = tErrors("VARIANT_NOT_PURCHASABLE");
      break;
    case "INSUFFICIENT_STOCK":
      message = tErrors("INSUFFICIENT_STOCK");
      break;
    case "VALIDATION_FAILED":
      message = tErrors("VALIDATION_FAILED");
      break;
    case "PRODUCT_NOT_FOUND":
      message = tErrors("PRODUCT_NOT_FOUND");
      break;
    case "NETWORK_UNAVAILABLE":
      message = tErrors("NETWORK_UNAVAILABLE");
      break;
    default:
      message = tErrors("fallback");
      break;
  }

  return <Alert tone="danger">{message}</Alert>;
}
