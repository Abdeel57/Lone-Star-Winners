import { Card, CardTitle } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { reasonLabeller } from "@/i18n/admin-labels";
import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { cancelOrderAction } from "@/lib/admin/actions";
import { ORDER_CANCEL_REASONS } from "@/lib/admin/reason-codes";
import type { OrderDetail } from "@/lib/api";

import { SensitiveConfirmForm } from "./sensitive-confirm";

/**
 * Cancelar un pedido que nunca se cobro (DEC-085).
 *
 * Solo se ofrece con el pedido PENDIENTE DE PAGO. El control es la ruta, que
 * lo vuelve a comprobar con el pedido bloqueado y, con tarjeta, cierra antes la
 * sesion de pago: si el cliente ya pago, contesta que no y el formulario lo
 * ensena.
 *
 * Pasa por `SensitiveConfirmForm` -antes/despues, motivo y casilla- aunque no
 * mueva dinero: un pedido cancelado ya no se puede cobrar, y quien lo cancela
 * por error deja a un cliente sin poder pagar en caja.
 */
export async function OrderCancelPanel({
  order,
  locale,
}: {
  readonly order: OrderDetail;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.orderCancel" });
  const statusT = await getTranslations({ locale, namespace: "orderStatus" });
  const reasonLabel = await reasonLabeller(locale);
  const total = formatMoney(order.total, locale) ?? "";
  const isCash = order.payment_method === "CASH";

  return (
    <Card elevation="flat" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("title")}
      </CardTitle>
      <p className="mt-s2 text-body-sm text-text-muted">
        {isCash ? t("introCash") : t("introCard")}
      </p>

      <div className="mt-s4">
        <SensitiveConfirmForm
          locale={locale}
          action={cancelOrderAction}
          hiddenFields={{ order_id: order.id }}
          impact={[
            {
              label: t("impactStatus"),
              before: statusT("PENDING_PAYMENT"),
              delta: t("impactCancel"),
              after: statusT("CANCELLED"),
            },
            { label: t("impactMoney"), before: total, delta: t("impactNoCharge"), after: total },
            {
              label: t("impactEntries"),
              before: t("impactNone"),
              delta: t("impactUnchanged"),
              after: t("impactNone"),
            },
          ]}
          reasons={ORDER_CANCEL_REASONS.map((key) => ({ value: key, label: reasonLabel(key) }))}
          submitLabel={t("submit")}
          confirmLabel={t("confirm", { number: order.order_number })}
          destructive
        />
      </div>
    </Card>
  );
}
