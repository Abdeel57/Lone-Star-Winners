"use client";

import { Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import type { CheckoutDefaults, FulfillmentMethod, PaymentMethod } from "@/lib/api";
import { startCheckoutAction } from "@/lib/checkout-actions";

import { FormError, useFieldError } from "./auth-form-shell";
import { FulfillmentChoice, type CashDeliveryOptions } from "./fulfillment-choice";
import { PaymentMethodChoice } from "./payment-method-choice";

/**
 * Formulario de checkout.
 *
 * AQUI NO SE RECOGE NI UN DATO DE PAGO
 * ------------------------------------
 * Ni numero de tarjeta, ni caducidad, ni CVC. Lo que hay es una direccion de
 * envio; el cobro ocurre despues, fuera de este dominio, en la pantalla del
 * proveedor. Es la consecuencia directa de que el checkout sea un ADAPTADOR: el
 * backend responde COMO se cobra y la interfaz nunca es la que cobra.
 *
 * LOS CAMPOS NO LLEVAN NINGUNA REGLA DE ELEGIBILIDAD
 * ---------------------------------------------------
 * `region` es un campo de texto libre y no un desplegable de estados, y no hay
 * patron de codigo postal: la elegibilidad territorial la fijan las Official
 * Rules y sigue en `docs/LEGAL_PENDING.md`, asi que un desplegable con la lista
 * de estados admitidos seria una regla legal escrita por el frontend (CLAUDE.md
 * #2 y #14). DEC-092: el PAIS ya no se pregunta porque la tienda solo envia
 * dentro de Estados Unidos; eso es una regla de envio, no de quien participa.
 *
 * Lo que si llevan es `autoComplete` con los tokens estandar, que es lo que
 * hace que un telefono rellene la direccion de una vez.
 *
 * NO SE VUELVE A PEDIR LO QUE LA CUENTA YA SABE (DEC-092)
 * -------------------------------------------------------
 * Los campos llegan rellenados: con la direccion de su ultimo pedido o, si no
 * hay, con el nombre y el estado del alta. Todo se puede corregir. Y un carrito
 * solo de paquetes no pide direccion: no hay nada que enviar.
 *
 * EL CARRITO NO VIAJA EN ESTE FORMULARIO. Lo que se cobra sale del carrito de
 * servidor (DEC-023); si el cliente aportara las lineas, aportaria tambien los
 * precios.
 *
 * DOS FORMAS DE PAGAR (DEC-078)
 * -----------------------------
 * Tarjeta -la pasarela de siempre- o efectivo en un punto de venta fisico. Las
 * dos piden la misma direccion: identifica al cliente y dice a donde va la
 * mercancia. Lo unico que cambia en pantalla es el boton y la nota de debajo,
 * porque es lo que cambia para quien compra: con efectivo no se cobra nada
 * ahora y las participaciones llegan cuando la tienda confirma el pago.
 *
 * RECOGER O ENVIAR (DEC-079, DEC-091)
 * -----------------------------------
 * Quien paga en efectivo recibe el articulo en el mismo punto de venta: por
 * defecto lo recoge, sin envio y SIN DIRECCION (los campos desaparecen). Si
 * prefiere que se lo envien, elige envio y vuelven la direccion y el envio.
 *
 * Con tarjeta tambien se puede pasar por el pedido a un punto de venta. Ahi el
 * defecto es el envio -es lo que existia y lo que espera quien paga en linea-,
 * salvo que todavia no haya tarifa: entonces solo queda recoger.
 *
 * `cashDelivery` es `null` cuando el carrito no lleva mercancia (solo
 * paquetes): no hay nada que recoger ni que enviar, no se pregunta y, desde
 * DEC-092, tampoco se pide direccion.
 */
export function CheckoutForm({
  locale,
  cashDelivery,
  addressDefaults = null,
}: {
  readonly locale: Locale;
  readonly cashDelivery: CashDeliveryOptions | null;
  /** DEC-092: con que se rellena la direccion. `null` = campos vacios. */
  readonly addressDefaults?: CheckoutDefaults | null;
}) {
  const t = useTranslations("checkout");
  const [state, formAction, pending] = useActionState(startCheckoutAction, IDLE);
  const fieldError = useFieldError(state);
  const deliveryAvailable = (cashDelivery?.delivery ?? null) !== null;
  const defaultFulfillment = (payment: PaymentMethod): FulfillmentMethod =>
    payment === "CARD" && deliveryAvailable ? "DELIVERY" : "PICKUP";
  const [method, setMethod] = useState<PaymentMethod>("CARD");
  const [fulfillment, setFulfillment] = useState<FulfillmentMethod>(() =>
    defaultFulfillment("CARD"),
  );

  // Cambiar la forma de pago vuelve a su forma de entrega por defecto.
  const choosePayment = (next: PaymentMethod): void => {
    setMethod(next);
    setFulfillment(defaultFulfillment(next));
  };

  // Hay mercancia: se pregunta como se recibe, y si se envia hace falta direccion.
  const ships = cashDelivery !== null;
  const needsAddress = ships && fulfillment !== "PICKUP";
  const prefill = (value: string | null | undefined): string => value ?? "";
  const prefilled =
    addressDefaults !== null &&
    [addressDefaults.full_name, addressDefaults.line1, addressDefaults.region].some(
      (value) => value !== null,
    );

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="ships" value={ships ? "true" : "false"} />

      <FormError result={state} />

      {/*
       * LA FORMA DE PAGO VA PRIMERO: es lo que se decide nada mas llegar del
       * carrito, y en un telefono, con seis campos de direccion delante, las
       * dos opciones quedarian fuera de la pantalla.
       */}
      <PaymentMethodChoice value={method} onChange={choosePayment} />

      {ships && cashDelivery !== null ? (
        <FulfillmentChoice
          value={fulfillment}
          onChange={setFulfillment}
          options={cashDelivery}
          paymentMethod={method}
        />
      ) : null}

      {/* DEC-092: solo paquetes, nada que enviar: se dice y no se pide nada. */}
      {ships ? null : <p className="text-body-sm text-text-muted">{t("noAddressNeeded")}</p>}

      {needsAddress ? (
        <>
          <h2 className="lsw-display mt-s3 text-heading-md text-text">{t("addressHeading")}</h2>

          {prefilled && addressDefaults !== null ? (
            <p className="text-body-sm text-text-muted">
              {addressDefaults.source === "LAST_ORDER"
                ? t("prefilledFromLastOrder")
                : t("prefilledFromAccount")}
            </p>
          ) : null}

          <FormField label={t("fields.fullName")} required error={fieldError("full_name")}>
            <Input
              name="full_name"
              type="text"
              autoComplete="shipping name"
              defaultValue={prefill(addressDefaults?.full_name)}
            />
          </FormField>

          <FormField label={t("fields.line1")} required error={fieldError("line1")}>
            <Input
              name="line1"
              type="text"
              autoComplete="shipping address-line1"
              defaultValue={prefill(addressDefaults?.line1)}
            />
          </FormField>

          <FormField
            label={t("fields.line2")}
            description={t("fields.line2Hint")}
            error={fieldError("line2")}
          >
            <Input
              name="line2"
              type="text"
              autoComplete="shipping address-line2"
              defaultValue={prefill(addressDefaults?.line2)}
            />
          </FormField>

          <div className="grid gap-s5 sm:grid-cols-2">
            <FormField label={t("fields.city")} required error={fieldError("city")}>
              <Input
                name="city"
                type="text"
                autoComplete="shipping address-level2"
                defaultValue={prefill(addressDefaults?.city)}
              />
            </FormField>

            <FormField label={t("fields.region")} required error={fieldError("region")}>
              <Input
                name="region"
                type="text"
                autoComplete="shipping address-level1"
                defaultValue={prefill(addressDefaults?.region)}
              />
            </FormField>
          </div>

          <FormField label={t("fields.postalCode")} required error={fieldError("postal_code")}>
            <Input
              name="postal_code"
              type="text"
              inputMode="text"
              autoComplete="shipping postal-code"
              defaultValue={prefill(addressDefaults?.postal_code)}
            />
          </FormField>

          <p className="text-caption text-text-subtle">{t("shipsToUsOnly")}</p>
        </>
      ) : null}

      {/*
       * `loading` deshabilita el boton mientras la peticion esta en vuelo: el
       * doble clic no llega a salir. No es el control -el backend admite un solo
       * pedido en efectivo por carrito-, es lo que evita que alguien lo pruebe.
       */}
      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {method === "CASH" ? t("payment.cashCta") : t("payCta")}
      </Button>

      <p className="text-caption text-text-subtle">
        {method === "CASH" ? t("payment.cashNote") : t("providerNote")}
      </p>
    </form>
  );
}
