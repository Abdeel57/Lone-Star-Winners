"use client";

import { Alert, Button, FormField, Input, MediaFrame, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { useAvailabilityLabel } from "@/i18n/storefront-labels";
import { pickLocalized, type ProductDetail, type ProductVariant } from "@/lib/api";
import { addToCartAction, type CartActionResult } from "@/lib/cart-actions";
import { safeImageUrl } from "@/lib/media-url";

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
 * EL SELECTOR LISTA TAMBIEN LAS VARIANTES QUE HOY NO SE PUEDEN PEDIR
 * ------------------------------------------------------------------
 * Deshabilitadas y con su estado en la etiqueta. Ocultarlas haria que una talla
 * sin existencias pareciera no existir, y quien la busca acabaria pensando que
 * se equivoco de producto.
 *
 * LA UNICA SENAL QUE HAY ES `availability.status`
 * -----------------------------------------------
 * Este formulario deshabilitaba por `is_purchasable`, un campo que la API NO
 * publica y que sigue pendiente de decision (HO-017). Mientras no exista, la
 * variante se deshabilita por FALTA DE EXISTENCIAS y la etiqueta dice
 * exactamente eso.
 *
 * Lo que NO se hace es afirmar que el articulo esta retirado de la venta:
 * `docs/API_CONTRACT.md` seccion 4 dice que esa pregunta -"¿esta a la venta?"-
 * no se deduce de esta, porque una variante retirada puede tener existencias de
 * sobra. Deducirla seria inventar un estado que nadie ha publicado.
 *
 * Y deshabilitar no es la ultima palabra: el backend vuelve a comprobar
 * existencias y puede responder `409 INSUFFICIENT_STOCK` o
 * `409 VARIANT_NOT_PURCHASABLE`, que esta pantalla traduce. El selector evita
 * el intento inutil; la decision sigue siendo del servidor.
 */

const INITIAL: CartActionResult = { ok: false, code: null, requestId: null };

/**
 * Como se llama una variante en el selector.
 *
 * `name` NULO Y `name` AUSENTE SIGNIFICAN COSAS DISTINTAS EN EL CONTRATO -la
 * variante unica sin nombre y el campo que la API no publica- pero AQUI se
 * tratan igual, y a proposito: en los dos casos no hay nombre que enseñar, y lo
 * unico que queda para distinguir una variante de otra es el SKU. Ramificar
 * produciria dos etiquetas distintas para el mismo hueco.
 */
function variantName(variant: ProductVariant, locale: Locale): string {
  const name = variant.name ?? null;
  return name === null ? variant.sku : pickLocalized(name, locale);
}

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

  const purchasable = product.variants.filter(
    (variant) => variant.availability.status !== "OUT_OF_STOCK",
  );

  /*
   * EL ESTADO SE DECLARA ANTES DE LOS RETORNOS TEMPRANOS.
   *
   * No es estilo: un hook detras de un `return` condicional cambia el numero de
   * hooks entre renders y React lo rechaza. El valor inicial es el mismo que
   * tenia el `defaultValue` de antes -la primera variante que se puede pedir- y
   * la cadena vacia cubre el producto sin variantes, que sale por el retorno de
   * abajo antes de usarla.
   */
  const [selectedId, setSelectedId] = useState<string>(purchasable[0]?.id ?? "");

  if (product.variants.length === 0) {
    return <Alert tone="info">{t("noVariants")}</Alert>;
  }

  if (purchasable.length === 0) {
    return <Alert tone="warning">{t("unavailable")}</Alert>;
  }

  const selected = product.variants.find((variant) => variant.id === selectedId) ?? null;
  const selectedImage = safeImageUrl(selected?.image_url);

  /*
   * LA ETIQUETA DEL SELECTOR DEPENDE DE LO QUE HAY DENTRO.
   *
   * Con variantes con NOMBRE -colores, tallas- la pregunta es "que opcion";
   * sin nombre, lo unico que las distingue es el SKU y llamar a eso "opcion"
   * suena a que falta algo. Es la misma informacion dicha con la palabra que
   * corresponde a los datos que hay.
   */
  const named = product.variants.some(
    (variant) => variant.name !== undefined && variant.name !== null,
  );
  const variantLabel = named ? t("variantLabel") : t("variantLabelSku");

  /*
   * El texto alternativo NOMBRA la variante y no describe la fotografia: quien
   * usa lector de pantalla necesita saber de que opcion es la imagen, y una
   * descripcion del producto la acaba de leer en el titular. Sin nombre, la
   * imagen es decorativa y el `alt` correcto es la cadena vacia.
   */
  const selectedName = selected === null ? null : (selected.name ?? null);
  const selectedImageAlt =
    selectedName === null
      ? ""
      : t("variantImageAlt", { name: pickLocalized(selectedName, locale) });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* La accion no ve el segmento de ruta: se lo pasamos y ella lo valida. */}
      <input type="hidden" name="locale" value={locale} />

      {state.code === null ? null : <AddToCartError code={state.code} />}
      {state.ok ? <Alert tone="success">{t("added")}</Alert> : null}

      <FormField label={variantLabel} controlId="variant">
        <Select
          name="variant_id"
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
          }}
        >
          {product.variants.map((variant) => {
            const price = formatMoney(variant.price, locale);
            const name = variantName(variant, locale);
            const status = variant.availability.status;

            // El estado se dice tambien cuando la variante SI se puede pedir
            // pero queda justo lo preguntado: es informacion util antes de
            // elegir, y el diccionario es el mismo que usa el carrito.
            const suffix = status === "IN_STOCK" ? null : availabilityLabel(status);

            return (
              <option key={variant.id} value={variant.id} disabled={status === "OUT_OF_STOCK"}>
                {[name, price, suffix].filter((part) => part !== null).join(" · ")}
              </option>
            );
          })}
        </Select>
      </FormField>

      {/*
       * IMAGEN DE LA VARIANTE ELEGIDA (DEC-053).
       *
       * En las gorras, cinco colores comparten ficha y solo se distinguen por
       * su fotografia: un selector con cinco nombres y una sola foto obliga a
       * imaginarse el color, que es exactamente lo que hace devolver una gorra.
       *
       * ES EL UNICO ESTADO DE CLIENTE DE ESTE FORMULARIO, y por eso el
       * formulario sigue funcionando sin JavaScript: sin bundle, el `<select>`
       * envia igual y lo que falta es la vista previa, no la compra. El
       * `defaultValue` que tenia antes pasa a `value` controlado para poder
       * seguir la eleccion; el valor inicial es el mismo.
       *
       * La URL se filtra antes de pintarla y el fichero puede no existir
       * todavia -no hay almacen de medios (DEC-053)-: el marco reserva el hueco
       * y absorbe el 404 sin descuadrar la columna.
       */}
      {selectedImage === null ? null : (
        <MediaFrame
          ratio="square"
          tone="light"
          className="lsw-studio-light max-w-[12rem] rounded-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedImage} alt={selectedImageAlt} loading="lazy" />
        </MediaFrame>
      )}

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
    // La API rechaza la linea (409) cuando la version de reglas activa no tiene
    // una formula de calculo valida: es un fallo de configuracion de la
    // promocion, no del comprador, y el texto lo dice sin culparle.
    case "CALCULATION_CONFIG_INVALID":
      message = tErrors("CALCULATION_CONFIG_INVALID");
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
