import { Alert, Badge, buttonVariants, Card, CardTitle } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { CheckoutPendingRefresh } from "@/components/checkout-pending-refresh";
import { formatInteger, formatMoney, formatZonedPaymentTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type OrderReceipt } from "@/lib/api";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";

/** Numeros por tramo. Un pedido con miles no se pinta de una vez. */
export const RECEIPT_NUMBERS_PAGE_SIZE = 100;

/**
 * DEC-103: comprobante de pago de un pedido COBRADO.
 *
 * Todo lo que pinta lo dice el backend (`GET /account/orders/{id}/receipt`):
 * que esta pagado, el estado tras una devolucion o un contracargo, y las
 * participaciones con sus numeros. Esta pantalla no calcula ni concede nada, y
 * nunca se monta para un pedido pendiente, fallido o cancelado: para esos la API
 * responde 409 y la pagina pinta la vista de siempre.
 *
 * El encabezado "Payment Successful!" solo sale con `payment_status: PAID`. Un
 * pedido devuelto o en disputa dice lo que le paso, y sus numeros anulados se
 * ven como anulados, no como vigentes.
 */
export function PaymentReceipt({
  receipt,
  locale,
  numbersPath,
}: {
  readonly receipt: OrderReceipt;
  readonly locale: Locale;
  /** Ruta de esta misma pagina, para los enlaces de tramo de numeros. */
  readonly numbersPath: string;
}) {
  const t = useTranslations("orderConfirmation.receipt");
  const order = receipt.order;
  const paid = receipt.payment_status === "PAID";

  return (
    <div className="flex flex-col gap-s6">
      <header>
        {paid ? (
          <>
            <h1 className="lsw-display text-display-sm text-text">{t("successTitle")}</h1>
            <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />
            <p className="mt-s4 text-heading-sm font-bold text-text">{t("successThanks")}</p>
            <p className="mt-s2 text-body text-text-muted">{t("successBody")}</p>
          </>
        ) : (
          <>
            <h1 className="lsw-display text-display-sm text-text">
              {t(`changedTitle.${receipt.payment_status}`)}
            </h1>
            <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />
            <div className="mt-s4">
              <Alert tone="warning">
                <p>{t("changedBody")}</p>
              </Alert>
            </div>
          </>
        )}
      </header>

      <ReceiptActions orderId={order.id} />

      <ReceiptDetails receipt={receipt} locale={locale} />

      <EntryNumbersCard receipt={receipt} locale={locale} numbersPath={numbersPath} />

      <div>
        <Link
          href={`/account/orders/${order.id}`}
          className="text-body-sm font-semibold text-brand underline underline-offset-4"
        >
          {t("viewOrder")}
        </Link>
      </div>
    </div>
  );
}

/**
 * Los tres botones. En movil ocupan el ancho y van uno debajo de otro; desde
 * `sm`, en fila. El PDF se pide a `/receipts/{id}.pdf`, que reenvia la sesion a
 * la API: el navegador nunca habla con la API.
 */
function ReceiptActions({ orderId }: { readonly orderId: string }) {
  const t = useTranslations("orderConfirmation.receipt");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <a
          href={`/receipts/${orderId}.pdf`}
          download
          className={`${buttonVariants({ variant: "accent", fullWidth: true })} sm:w-auto`}
        >
          {t("download")}
        </a>
        <Link
          href="/account/entries"
          className={`${buttonVariants({ variant: "secondary", fullWidth: true })} sm:w-auto`}
        >
          {t("verify")}
        </Link>
        <Link
          href="/"
          className={`${buttonVariants({ variant: "ghost", fullWidth: true })} sm:w-auto`}
        >
          {t("home")}
        </Link>
      </div>
      <p className="mt-s3 text-caption text-text-subtle">{t("downloadHint")}</p>
    </div>
  );
}

function ReceiptDetails({
  receipt,
  locale,
}: {
  readonly receipt: OrderReceipt;
  readonly locale: Locale;
}) {
  const t = useTranslations("orderConfirmation.receipt");
  const order = receipt.order;
  const paidAt = formatZonedPaymentTime(receipt.paid_at, locale, BUSINESS_TIME_ZONE) ?? "";
  const refunded = BigInt(receipt.refunded_total.amount_minor) > 0n;

  const rows: { readonly label: string; readonly value: React.ReactNode }[] = [
    {
      label: t("orderNumber"),
      value: <span className="font-display tabular-nums">{order.order_number}</span>,
    },
    { label: t("paymentDate"), value: paidAt },
    ...(receipt.customer_name === null
      ? []
      : [{ label: t("customerName"), value: receipt.customer_name }]),
    {
      label: t("product"),
      value: (
        <ul className="flex flex-col gap-1">
          {order.items.map((item) => (
            <li key={item.line_id}>
              {item.quantity === 1
                ? pickLocalized(item.product_name, locale)
                : t("lineQuantity", {
                    name: pickLocalized(item.product_name, locale),
                    quantity: formatInteger(item.quantity, locale),
                  })}
            </li>
          ))}
        </ul>
      ),
    },
    {
      label: t("amountPaid"),
      value: <span className="tabular-nums">{formatMoney(order.total, locale)}</span>,
    },
    ...(refunded
      ? [
          {
            label: t("amountRefunded"),
            value: (
              <span className="tabular-nums">{formatMoney(receipt.refunded_total, locale)}</span>
            ),
          },
        ]
      : []),
    {
      label: t("paymentStatus"),
      value: (
        <Badge tone={receipt.payment_status === "PAID" ? "success" : "warning"} size="sm">
          {t(`status.${receipt.payment_status}`)}
        </Badge>
      ),
    },
    {
      label: t("paymentMethod"),
      value: t(order.payment_method === "CASH" ? "method.CASH" : "method.CARD"),
    },
    { label: t("entries"), value: <EntriesValue receipt={receipt} locale={locale} /> },
  ];

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("detailsHeading")}
      </CardTitle>
      <dl className="mt-s4 divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 py-s3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-s4"
          >
            <dt className="text-body-sm text-text-muted">{row.label}</dt>
            <dd className="text-body font-semibold text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function EntriesValue({
  receipt,
  locale,
}: {
  readonly receipt: OrderReceipt;
  readonly locale: Locale;
}) {
  const t = useTranslations("orderConfirmation.receipt");
  const order = receipt.order;
  switch (order.entry_state) {
    case "GRANTED":
    case "PARTIALLY_REVERSED":
    case "REVERSED":
      return (
        <span className="tabular-nums">{formatInteger(order.entries_granted ?? 0, locale)}</span>
      );
    case "PENDING_QUALIFICATION":
      return <>{t("entriesPending")}</>;
    case "NOT_APPLICABLE":
      return <>{t("entriesNone")}</>;
  }
}

function EntryNumbersCard({
  receipt,
  locale,
  numbersPath,
}: {
  readonly receipt: OrderReceipt;
  readonly locale: Locale;
  readonly numbersPath: string;
}) {
  const t = useTranslations("orderConfirmation.receipt");
  const order = receipt.order;
  const numbers = receipt.entry_numbers;

  let body: React.ReactNode;
  if (order.entry_state === "PENDING_QUALIFICATION") {
    // Pagado y sin participaciones TODAVIA: se vuelve a preguntar al backend
    // unas cuantas veces, y despues se deja de preguntar.
    body = (
      <>
        <Alert tone="info" title={t("pendingTitle")}>
          <p>{t("pendingBody")}</p>
        </Alert>
        <CheckoutPendingRefresh />
      </>
    );
  } else if (order.entry_state === "NOT_APPLICABLE") {
    body = <p className="text-body text-text-muted">{t("noneBody")}</p>;
  } else if (numbers === null) {
    body = <p className="text-body text-text-muted">{t("numbersHidden")}</p>;
  } else {
    body = <NumbersList numbers={numbers} locale={locale} numbersPath={numbersPath} />;
  }

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("numbersHeading")}
      </CardTitle>
      <div className="mt-s4">{body}</div>
    </Card>
  );
}

function NumbersList({
  numbers,
  locale,
  numbersPath,
}: {
  readonly numbers: NonNullable<OrderReceipt["entry_numbers"]>;
  readonly locale: Locale;
  readonly numbersPath: string;
}) {
  const t = useTranslations("orderConfirmation.receipt");
  const total = numbers.active_count + numbers.void_count;
  const from = numbers.numbers.length === 0 ? 0 : numbers.offset + 1;
  const to = numbers.offset + numbers.numbers.length;
  const previous =
    numbers.offset > 0 ? Math.max(0, numbers.offset - RECEIPT_NUMBERS_PAGE_SIZE) : null;

  return (
    <div>
      <p className="text-body font-semibold text-text">
        {t("numbersSummary", { active: numbers.active_count })}
        {numbers.void_count > 0 ? (
          <span className="ml-2 font-normal text-text-muted">
            · {t("voidSummary", { count: numbers.void_count })}
          </span>
        ) : null}
      </p>

      {total === 0 ? null : (
        <>
          <ul className="mt-s4 grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
            {numbers.numbers.map((entry) => (
              <li
                key={entry.number}
                className={
                  entry.active
                    ? "rounded-md border border-border bg-surface px-1 py-1.5 text-center font-mono text-body-sm tabular-nums text-text"
                    : "rounded-md border border-dashed border-border px-2 py-1.5 text-center font-mono text-body-sm tabular-nums text-text-subtle"
                }
              >
                {entry.active ? (
                  entry.number
                ) : (
                  <>
                    <s>{entry.number}</s>{" "}
                    <span className="font-sans text-caption">({t("voidLabel")})</span>
                  </>
                )}
              </li>
            ))}
          </ul>

          {total <= numbers.numbers.length ? null : (
            <nav
              aria-label={t("numbersHeading")}
              className="mt-s4 flex flex-wrap items-center justify-between gap-3"
            >
              <p className="text-caption text-text-subtle">
                {t("numbersRange", {
                  from: formatInteger(from, locale),
                  to: formatInteger(to, locale),
                  total: formatInteger(total, locale),
                })}
              </p>
              <div className="flex gap-2">
                {previous === null ? null : (
                  <Link
                    href={`${numbersPath}?numbers=${String(previous)}`}
                    scroll={false}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    {t("previous")}
                  </Link>
                )}
                {numbers.next_offset === null ? null : (
                  <Link
                    href={`${numbersPath}?numbers=${String(numbers.next_offset)}`}
                    scroll={false}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    {t("next")}
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
