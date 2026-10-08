"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import type { FulfillmentMethod, OrderFulfillment } from "@/lib/api";

/**
 * Marcar la mercancia como enviada, o devolverla a pendiente (DEC-085).
 *
 * Transportista y guia son TEXTO que teclea la tienda: no hay integracion con
 * paqueteria, y la pantalla no finge que la hay. Si se recoge en el punto de
 * venta no se piden: lo que se entrega en mano no viaja.
 *
 * Sin motivo ni casilla: es logistica y se puede deshacer con el boton de al
 * lado. Lo que si queda es quien lo marco, en la auditoria.
 */
export function OrderFulfillmentForm({
  locale,
  action,
  orderId,
  fulfillment,
  fulfillmentMethod,
  deliveredAtText,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly orderId: string;
  readonly fulfillment: OrderFulfillment;
  readonly fulfillmentMethod: FulfillmentMethod;
  /** `delivered_at` ya formateado en el servidor. */
  readonly deliveredAtText: string | null;
}) {
  const t = useTranslations("admin.orderFulfillment");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const delivered = fulfillment.state === "FULFILLED";
  const pickup = fulfillmentMethod === "PICKUP";

  return (
    <div className="flex flex-col gap-s4">
      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      {delivered ? (
        <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-3">
          <div>
            <dt className="text-caption uppercase tracking-wide text-text-subtle">
              {pickup ? t("handedOverAt") : t("shippedAt")}
            </dt>
            <dd className="text-body-sm text-text">{deliveredAtText ?? ""}</dd>
          </div>
          {pickup ? null : (
            <>
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("carrier")}
                </dt>
                <dd className="text-body-sm text-text">{fulfillment.carrier ?? t("notGiven")}</dd>
              </div>
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("trackingNumber")}
                </dt>
                <dd className="break-all font-mono text-body-sm text-text">
                  {fulfillment.tracking_number ?? t("notGiven")}
                </dd>
              </div>
            </>
          )}
        </dl>
      ) : null}

      <form action={formAction} className="flex flex-col gap-s4">
        <LocaleField locale={locale} />
        <input type="hidden" name="order_id" value={orderId} />
        <input type="hidden" name="delivered" value="true" />

        {pickup ? null : (
          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <FormField
              label={t("carrier")}
              description={t("carrierHint")}
              error={fieldError("carrier")}
            >
              <Input name="carrier" maxLength={60} defaultValue={fulfillment.carrier ?? ""} />
            </FormField>
            <FormField label={t("trackingNumber")} error={fieldError("tracking_number")}>
              <Input
                name="tracking_number"
                maxLength={100}
                defaultValue={fulfillment.tracking_number ?? ""}
              />
            </FormField>
          </div>
        )}

        <Button
          type="submit"
          variant="secondary"
          size="md"
          loading={pending}
          className="w-full sm:w-auto sm:self-start"
        >
          {delivered ? t("updateSubmit") : pickup ? t("markHandedOver") : t("markShipped")}
        </Button>
      </form>

      {delivered ? (
        <form action={formAction}>
          <LocaleField locale={locale} />
          <input type="hidden" name="order_id" value={orderId} />
          <input type="hidden" name="delivered" value="false" />
          <Button type="submit" variant="ghost" size="sm" loading={pending}>
            {t("markPending")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
