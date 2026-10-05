import { Alert, Badge, Card, CardTitle, cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { reasonLabeller } from "@/i18n/admin-labels";
import { formatEntryCount, formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { confirmCashPaymentAction, generateCashEntriesAction } from "@/lib/admin/actions";
import { CASH_CONFIRM_REASONS, CASH_RETRY_REASONS } from "@/lib/admin/reason-codes";
import type { AdminCashPayment, CashPaymentStage } from "@/lib/api";

import { SensitiveConfirmForm, type SensitiveImpactRow } from "./sensitive-confirm";

/**
 * Cobro en efectivo de un pedido, en su ficha del panel (DEC-078).
 *
 * EL RECORRIDO SE PINTA ENTERO, CON LA ETAPA ACTUAL MARCADA
 * --------------------------------------------------------
 * Pendiente de pago en efectivo -> Pagado -> Participaciones generadas. Quien
 * atiende la caja tiene que ver de un vistazo en que punto esta el pedido y
 * que falta, no deducirlo de dos insignias.
 *
 * LOS BOTONES LOS DECIDE EL BACKEND
 * ---------------------------------
 * `can_confirm` y `can_generate_entries` llegan calculados. Esta pantalla ademas
 * mira si el actor tiene `order.cash.confirm`, pero solo para no ofrecer un
 * boton que le va a rechazar: el control es la ruta, que vuelve a comprobarlo
 * todo -capacidad, motivo y estado del pedido, bloqueado- al recibir el envio.
 *
 * CONFIRMAR NO ES UN CLIC
 * -----------------------
 * Pasa por `SensitiveConfirmForm`: antes/despues, motivo y una casilla que dice
 * literalmente que se recibio el importe. Confirmar un cobro genera
 * participaciones, y deshacerlo no es un `undo`.
 */
export async function CashPaymentPanel({
  cash,
  locale,
  actorCanConfirm,
}: {
  readonly cash: AdminCashPayment;
  readonly locale: Locale;
  /** Cortesia de interfaz; el control es la ruta del backend. */
  readonly actorCanConfirm: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "admin.cashPayment" });
  const reasonLabel = await reasonLabeller(locale);
  const total = formatMoney(cash.amount, locale) ?? "";

  const stages: readonly CashPaymentStage[] = ["PENDING_CASH_PAYMENT", "PAID", "ENTRIES_GENERATED"];
  const currentIndex = stages.indexOf(cash.stage);

  return (
    <Card elevation="raised" padding="lg" className="border-brand/40">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <CardTitle as="h2" size="sm">
          {t("title")}
        </CardTitle>
        <Badge tone={cash.stage === "ENTRIES_GENERATED" ? "success" : "info"} size="sm">
          {t(`stages.${cash.stage}`)}
        </Badge>
      </div>

      {cash.stage === "CANCELLED" ? (
        <p className="mt-s4 text-body-sm text-text-muted">{t("cancelledBody")}</p>
      ) : (
        <ol className="mt-s5 grid list-none gap-s2 sm:grid-cols-3" aria-label={t("stagesLabel")}>
          {stages.map((stage, index) => {
            const done = index < currentIndex;
            const current = index === currentIndex;
            return (
              <li
                key={stage}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-s2 rounded-md border px-s3 py-s2 text-body-sm",
                  current
                    ? "border-brand bg-brand/10 font-semibold text-text"
                    : done
                      ? "border-success/40 text-text"
                      : "border-border text-text-muted",
                )}
              >
                <span aria-hidden="true" className="tabular-nums">
                  {done ? "✓" : String(index + 1)}
                </span>
                {t(`stages.${stage}`)}
              </li>
            );
          })}
        </ol>
      )}

      <dl className="mt-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">
            {t("orderNumber")}
          </dt>
          <dd className="font-mono text-body-md text-text">{cash.order_number}</dd>
        </div>
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">{t("amount")}</dt>
          <dd className="font-display text-heading-sm font-bold tabular-nums text-text">{total}</dd>
        </div>
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">{t("customer")}</dt>
          <dd className="text-body-sm text-text">
            {cash.customer_email === "" ? t("anonymized") : cash.customer_email}
          </dd>
        </div>
      </dl>

      {cash.confirmation === null ? null : (
        <div className="mt-s5 border-t border-border pt-s4">
          <h3 className="text-label font-medium text-text">{t("confirmationHeading")}</h3>
          <dl className="mt-s3 grid grid-cols-1 gap-s3 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-text-subtle">{t("confirmedBy")}</dt>
              <dd className="text-body-sm text-text">
                {cash.confirmation.confirmed_by_name ??
                  cash.confirmation.confirmed_by_admin_user_id}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-subtle">{t("confirmedAt")}</dt>
              <dd className="text-body-sm text-text">
                {formatZonedDateTime(cash.confirmation.confirmed_at, locale, { timeZone: "UTC" }) ??
                  ""}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-subtle">{t("reason")}</dt>
              <dd className="text-body-sm text-text">
                {reasonLabel(cash.confirmation.reason_code)}
              </dd>
            </div>
            {cash.confirmation.notes === null ? null : (
              <div>
                <dt className="text-caption text-text-subtle">{t("notes")}</dt>
                <dd className="break-words text-body-sm text-text">{cash.confirmation.notes}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="mt-s5">{entriesStatus()}</div>

      {cash.can_confirm ? (
        <div className="mt-s6 border-t border-border pt-s5">
          {actorCanConfirm ? (
            <>
              <h3 className="text-label font-medium text-text">{t("confirmHeading")}</h3>
              <p className="mt-s1 text-body-sm text-text-muted">{t("confirmIntro")}</p>
              <div className="mt-s4">
                <SensitiveConfirmForm
                  locale={locale}
                  action={confirmCashPaymentAction}
                  hiddenFields={{ order_id: cash.order_id }}
                  impact={confirmImpact()}
                  reasons={CASH_CONFIRM_REASONS.map((key) => ({
                    value: key,
                    label: reasonLabel(key),
                  }))}
                  submitLabel={t("confirmSubmit")}
                  confirmLabel={t("confirmCheckbox", { total, number: cash.order_number })}
                />
              </div>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{t("noCapability")}</p>
          )}
        </div>
      ) : null}

      {cash.can_generate_entries ? (
        <div className="mt-s6 border-t border-border pt-s5">
          {actorCanConfirm ? (
            <>
              <h3 className="text-label font-medium text-text">{t("retryHeading")}</h3>
              <p className="mt-s1 text-body-sm text-text-muted">{t("retryIntro")}</p>
              <div className="mt-s4">
                <SensitiveConfirmForm
                  locale={locale}
                  action={generateCashEntriesAction}
                  hiddenFields={{ order_id: cash.order_id }}
                  impact={[
                    {
                      label: t("impactEntries"),
                      before: t("entries.PENDING"),
                      delta: t("impactRetry"),
                      after: t("impactEntriesAfter"),
                    },
                  ]}
                  reasons={CASH_RETRY_REASONS.map((key) => ({
                    value: key,
                    label: reasonLabel(key),
                  }))}
                  submitLabel={t("retrySubmit")}
                  confirmLabel={t("retryCheckbox")}
                />
              </div>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{t("noCapability")}</p>
          )}
        </div>
      ) : null}
    </Card>
  );

  /*
   * Lo que va a pasar, fila por fila. Ninguna cifra de participaciones se
   * calcula aqui (R13): el "despues" de esa fila dice que la pone el backend
   * al generar. "Sin publicar", lo que muestra el formulario con `null`, a
   * quien esta en caja le sonaba a que no se iban a dar.
   */
  function confirmImpact(): readonly SensitiveImpactRow[] {
    return [
      {
        label: t("impactPayment"),
        before: t("stages.PENDING_CASH_PAYMENT"),
        delta: t("impactConfirm"),
        after: t("stages.PAID"),
      },
      { label: t("impactAmount"), before: total, delta: t("impactCash"), after: total },
      {
        label: t("impactEntries"),
        before: t("entries.AWAITING_PAYMENT"),
        delta: t("impactSameRules"),
        after: t("impactEntriesAfter"),
      },
    ];
  }

  /** Que paso con las participaciones, con su explicacion. */
  function entriesStatus() {
    const { entries } = cash;
    const tone =
      entries.status === "GENERATED"
        ? "success"
        : entries.status === "PENDING"
          ? "warning"
          : "info";

    return (
      <Alert tone={tone} title={`${t("entriesHeading")}: ${t(`entries.${entries.status}`)}`}>
        <p>
          {entries.status === "NOT_APPLICABLE" && entries.not_applicable_reason !== null
            ? t(`notApplicable.${entries.not_applicable_reason}`)
            : t(`entriesBody.${entries.status}`)}
        </p>
        {entries.entries_granted === null ? null : (
          <p className="mt-s2 font-display text-heading-sm font-bold tabular-nums">
            {formatEntryCount(entries.entries_granted, locale)}
          </p>
        )}
      </Alert>
    );
  }
}
