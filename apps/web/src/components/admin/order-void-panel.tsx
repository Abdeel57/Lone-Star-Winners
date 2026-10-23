import { Alert, Card, CardTitle } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { reasonLabeller } from "@/i18n/admin-labels";
import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { voidOrderAction } from "@/lib/admin/actions";
import { DAILY_CUT_TIME_ZONE } from "@/lib/admin/daily-cut";
import { ORDER_VOID_REASONS } from "@/lib/admin/reason-codes";
import type { AdminOrderVoid, OrderDetail } from "@/lib/api";

import { SensitiveConfirmForm } from "./sensitive-confirm";

/** `id` de la seccion de anulacion; es a donde vuelve "Confirmar codigo". */
const VOID_SECTION_ID = "void-order";

/**
 * Anular un pedido YA COBRADO (DEC-091).
 *
 * Es la otra mitad de `OrderCancelPanel`: aquel limpia lo que nunca se cobro,
 * este corrige lo que se cobro de mas -un duplicado, un error-. Se ofrece con el
 * pedido cobrado; el control es la ruta, que lo vuelve a comprobar todo con el
 * pedido bloqueado, exige motivo (sin step-up desde DEC-093) y, con tarjeta,
 * devuelve en la pasarela antes de anular.
 *
 * Pasa por `SensitiveConfirmForm` -antes/despues, motivo y casilla- porque
 * retira participaciones y, con tarjeta, devuelve dinero: no se deshace.
 */
export async function OrderVoidPanel({
  order,
  locale,
}: {
  readonly order: OrderDetail;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.orderVoid" });
  const statusT = await getTranslations({ locale, namespace: "orderStatus" });
  const reasonLabel = await reasonLabeller(locale);
  const total = formatMoney(order.total, locale) ?? "";
  const nothing = formatMoney({ amount_minor: "0", currency: order.total.currency }, locale) ?? "";
  const isCash = order.payment_method === "CASH";

  return (
    /*
     * `id` estable: si la ruta pidiera el codigo (step-up, retirado para esta
     * capacidad en DEC-093), la vuelta desde "Confirmar codigo" aterriza aqui,
     * en la anulacion, y no en lo alto de la ficha.
     */
    <Card id={VOID_SECTION_ID} elevation="flat" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("title")}
      </CardTitle>
      <p className="mt-s2 text-body-sm text-text-muted">
        {isCash ? t("introCash") : t("introCard")}
      </p>

      <div className="mt-s4">
        <SensitiveConfirmForm
          locale={locale}
          action={voidOrderAction}
          hiddenFields={{ order_id: order.id }}
          stepUpAnchor={VOID_SECTION_ID}
          impact={[
            {
              label: t("impactStatus"),
              before: statusT(order.status),
              delta: t("impactVoid"),
              after: statusT("VOIDED"),
            },
            {
              label: t("impactMoney"),
              before: total,
              delta: isCash ? t("impactCashOut") : t("impactCardRefund"),
              after: nothing,
            },
            {
              label: t("impactEntries"),
              before:
                order.entries_granted === null
                  ? t("impactEntriesUnknown")
                  : t("impactEntriesBefore", { count: order.entries_granted }),
              delta: t("impactRemoved"),
              after: t("impactNone"),
            },
          ]}
          reasons={ORDER_VOID_REASONS.map((key) => ({ value: key, label: reasonLabel(key) }))}
          submitLabel={t("submit")}
          confirmLabel={t("confirm", { number: order.order_number })}
          destructive
        />
      </div>
    </Card>
  );
}

/**
 * DEC-091: quien anulo el pedido, cuando y por que. Lo pinta la ficha del panel
 * con la fila de `GET /admin/orders/:id/void`; el participante solo ve el estado.
 */
export async function OrderVoidedNotice({
  record,
  locale,
}: {
  readonly record: AdminOrderVoid;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.orderVoid" });
  const reasonLabel = await reasonLabeller(locale);
  const refunded = record.refund_amount.amount_minor !== "0";

  return (
    <Alert tone="warning" title={t("voidedTitle")}>
      <p>
        {t("voidedBody", {
          when:
            formatZonedDateTime(record.voided_at, locale, {
              timeZone: DAILY_CUT_TIME_ZONE,
              showTimeZoneName: true,
            }) ?? "",
          who: record.voided_by_name ?? t("unknownStaff"),
          reason: reasonLabel(record.reason_code),
        })}
      </p>
      <p className="mt-s2">
        {record.payment_method === "CASH"
          ? t("voidedCash")
          : refunded
            ? t("voidedRefund", { amount: formatMoney(record.refund_amount, locale) ?? "" })
            : null}
      </p>
      {record.notes === null ? null : (
        <p className="mt-s2 break-words">{t("voidedNotes", { notes: record.notes })}</p>
      )}
    </Alert>
  );
}
