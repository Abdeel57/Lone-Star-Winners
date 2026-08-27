"use client";

import { Alert, Badge, Button, Card } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField } from "@/components/auth-form-shell";
import { useAmoeRejectionReason, useAmoeSubmissionStatusLabel } from "@/i18n/amoe-labels";
import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { cancelAmoeAction } from "@/lib/amoe-actions";
import type { AmoeSubmission } from "@/lib/api";

/**
 * Envios AMOE del participante.
 *
 * UN ENVIO RETIRADO SIGUE EN LA LISTA. Retirar no borra: el envio pasa a
 * `CANCELLED` y se sigue viendo. Los principios #6 y #7 valen igual para la
 * procedencia de una participacion que para el ledger que la contiene, y un
 * envio que desapareciera dejaria un saldo sin explicacion.
 *
 * LA INTERFAZ NO DECIDE SI SE PUEDE RETIRAR. `cancellable` viaja como dato
 * desde el backend, porque depende de la ventana, de la modalidad y de las
 * Official Rules. Deducirlo del estado -"si esta pendiente, se puede retirar"-
 * seria inventarse una regla de participacion.
 *
 * NINGUNA CIFRA SE CALCULA AQUI. `entries_granted` se pinta tal como llega, y
 * `null` NO es cero: "todavia no se sabe" y "ninguna" son dos afirmaciones
 * distintas delante de alguien que participo sin comprar.
 */
export function AmoeSubmissionList({
  submissions,
  locale,
}: {
  readonly submissions: readonly AmoeSubmission[];
  readonly locale: Locale;
}) {
  return (
    <ul className="flex list-none flex-col gap-s4">
      {submissions.map((submission) => (
        <li key={submission.id}>
          <AmoeSubmissionCard submission={submission} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

function AmoeSubmissionCard({
  submission,
  locale,
}: {
  readonly submission: AmoeSubmission;
  readonly locale: Locale;
}) {
  const t = useTranslations("amoe.account");
  const statusLabel = useAmoeSubmissionStatusLabel();
  const rejectionReason = useAmoeRejectionReason();

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-start justify-between gap-s4">
        <div className="min-w-0">
          <p className="text-body-md text-text">
            {t("submittedAt", {
              instant:
                formatZonedDateTime(submission.submitted_at, locale, { timeZone: "UTC" }) ?? "",
            })}
          </p>

          {submission.decided_at === null ? null : (
            <p className="mt-s1 text-caption text-text-subtle">
              {t("decidedAt", {
                instant:
                  formatZonedDateTime(submission.decided_at, locale, { timeZone: "UTC" }) ?? "",
              })}
            </p>
          )}
        </div>

        <Badge tone={toneFor(submission.status)} size="sm">
          {statusLabel(submission.status)}
        </Badge>
      </div>

      {submission.entries_granted === null ? null : (
        <p className="mt-s3 text-body-sm text-text-muted">
          {t("entriesGranted", { count: formatEntryCount(submission.entries_granted, locale) })}
        </p>
      )}

      {submission.reason_key === null ? null : (
        <p className="mt-s3 text-body-sm text-text-muted">
          {rejectionReason(submission.reason_key)}
        </p>
      )}

      {submission.cancellable ? <CancelForm submissionId={submission.id} locale={locale} /> : null}
    </Card>
  );
}

/**
 * Retirada de un envio.
 *
 * Es un `<form>` con Server Action y no un enlace: retirar CAMBIA estado en el
 * servidor, y un `GET` que muta se dispara con un prefetch del navegador.
 */
function CancelForm({
  submissionId,
  locale,
}: {
  readonly submissionId: string;
  readonly locale: Locale;
}) {
  const t = useTranslations("amoe.account");
  const [state, formAction, pending] = useActionState(cancelAmoeAction, IDLE);

  return (
    <form action={formAction} className="mt-s4 flex flex-col gap-s3">
      <LocaleField locale={locale} />
      <input type="hidden" name="submission_id" value={submissionId} />

      <FormError result={state} />

      {state.status === "ok" ? <Alert tone="success">{t("cancelled")}</Alert> : null}

      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        {t("cancelCta")}
      </Button>
    </form>
  );
}

function toneFor(status: AmoeSubmission["status"]): "success" | "danger" | "neutral" | "warning" {
  switch (status) {
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "danger";
    case "CANCELLED":
      return "neutral";
    case "SUBMITTED":
    case "PENDING_REVIEW":
      return "warning";
  }
}
