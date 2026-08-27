import { Badge, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { adminHref } from "@/i18n/admin-routing";
import { amoeStatusLabeller, formatSignedEntries, reasonLabeller } from "@/i18n/admin-labels";
import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { approveAmoeAction, rejectAmoeAction } from "@/lib/admin/actions";
import { AMOE_APPROVE_REASONS, AMOE_REJECT_REASONS } from "@/lib/admin/reason-codes";
import type { AdminAmoeSubmission } from "@/lib/api";

import { SensitiveConfirmForm, type SensitiveImpactRow } from "./sensitive-confirm";

/**
 * Revision de un envio AMOE.
 *
 * ES LA PANTALLA MAS SENSIBLE DEL PANEL despues del sorteo, porque aprueba una
 * participacion QUE NO PASO POR NINGUNA COMPRA. Si la via gratuita no funciona
 * -o funciona mal, o se aprueba a ojo- la promocion deja de tener metodo
 * gratuito real, que es la condicion que separa un sweepstakes de una loteria
 * privada. Por eso aqui no hay ningun boton de un solo clic.
 *
 * LOS DATOS ENVIADOS SE PINTAN COMO TEXTO
 * ---------------------------------------
 * `payload` lo escribio un desconocido. Se recorre como pares clave/valor y se
 * renderiza como texto plano; no hay `dangerouslySetInnerHTML` en ninguna parte
 * de esta interfaz y este es justo el sitio donde mas caro saldria.
 *
 * LAS CLAVES DEL `payload` NO SE TRADUCEN, y es deliberado: son los nombres de
 * campo que declaro `required_fields`, los decide el abogado del cliente y
 * cambian con la modalidad. Traducirlas exigiria una clave de copy por cada
 * campo posible de una lista que no esta cerrada, y una clave sin traducir en
 * pantalla seria peor que el nombre tecnico, que al menos coincide con el que
 * ve el participante en el formulario.
 */

/** Una fila de la cola. */
export async function AmoeSubmissionRow({
  submission,
  locale,
  selected,
}: {
  readonly submission: AdminAmoeSubmission;
  readonly locale: Locale;
  readonly selected: boolean;
}) {
  const statusLabel = await amoeStatusLabeller(locale);

  return (
    <Card
      elevation={selected ? "raised" : "flat"}
      padding="md"
      {...(selected ? { className: "border-brand/50" } : {})}
    >
      <div className="flex flex-wrap items-start justify-between gap-s4">
        <div className="min-w-0">
          <p className="truncate text-body-md text-text">{submission.participant_email}</p>
          <p className="mt-s1 text-caption text-text-subtle">
            {formatZonedDateTime(submission.submitted_at, locale, { timeZone: "UTC" }) ?? ""}
          </p>
        </div>

        <Badge tone={submission.status === "APPROVED" ? "success" : "neutral"} size="sm">
          {statusLabel(submission.status)}
        </Badge>
      </div>
    </Card>
  );
}

/**
 * Panel de decision de un envio.
 *
 * Dos formularios distintos -aprobar y rechazar- y NO uno con un selector. Son
 * dos capacidades distintas (`amoe.review.approve`, `amoe.review.reject`), dos
 * listas de motivos distintas y dos consecuencias distintas; un solo formulario
 * con un desplegable de "decision" invita a cambiar la decision con el motivo ya
 * escrito para la otra.
 */
export async function AmoeDecisionPanel({
  submission,
  locale,
  decision,
  canApprove,
  canReject,
}: {
  readonly submission: AdminAmoeSubmission;
  readonly locale: Locale;
  readonly decision: "approve" | "reject";
  readonly canApprove: boolean;
  readonly canReject: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "admin.amoeReview" });
  const reasonLabel = await reasonLabeller(locale);
  const statusLabel = await amoeStatusLabeller(locale);

  const allowed = decision === "approve" ? canApprove : canReject;

  if (!allowed) {
    return (
      <Card elevation="raised" padding="lg">
        <EmptyState
          headingLevel="h2"
          title={t("noDecisionCapabilityTitle")}
          description={t("noDecisionCapabilityBody")}
        />
      </Card>
    );
  }

  const impact = buildImpact();

  const reasonKeys: readonly string[] =
    decision === "approve" ? AMOE_APPROVE_REASONS : AMOE_REJECT_REASONS;

  const reasons = reasonKeys.map((key) => ({ value: key, label: reasonLabel(key) }));

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {decision === "approve" ? t("approveTitle") : t("rejectTitle")}
      </CardTitle>

      <p className="mt-s2 text-body-sm text-text-muted">{submission.participant_email}</p>

      <div className="mt-s5">
        <h3 className="text-label font-medium text-text">{t("payloadHeading")}</h3>

        {Object.keys(submission.payload).length === 0 ? (
          <p className="mt-s2 text-body-sm text-text-muted">{t("payloadEmpty")}</p>
        ) : (
          <dl className="mt-s3 grid grid-cols-1 gap-s2 sm:grid-cols-2">
            {Object.entries(submission.payload).map(([field, value]) => (
              <div key={field} className="min-w-0">
                <dt className="text-caption uppercase tracking-wide text-text-subtle">{field}</dt>
                <dd className="break-words text-body-sm text-text">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="mt-s6">
        <SensitiveConfirmForm
          locale={locale}
          action={decision === "approve" ? approveAmoeAction : rejectAmoeAction}
          hiddenFields={{ submission_id: submission.id }}
          impact={impact}
          reasons={reasons}
          submitLabel={decision === "approve" ? t("approveSubmit") : t("rejectSubmit")}
          confirmLabel={decision === "approve" ? t("approveConfirm") : t("rejectConfirm")}
          destructive={decision === "reject"}
        />
      </div>

      <div className="mt-s5">
        <Link
          href={adminHref(locale, "/amoe")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("cancel")}
        </Link>
      </div>
    </Card>
  );

  /*
   * LAS TRES COLUMNAS, FILA POR FILA.
   *
   * El estado tiene las tres: se sabe de donde viene y a donde va. Las
   * participaciones tienen "antes" y "cambio" siempre, y "despues" SOLO si el
   * backend lo publica (`entries_after_if_approved`, peticion abierta). No se
   * calcula: sumar el delta al saldo seria reimplementar el motor en la
   * interfaz, y la red `no-client-entry-math.test.ts` esta para que eso no pase
   * inadvertido.
   */
  function buildImpact(): readonly SensitiveImpactRow[] {
    const rows: SensitiveImpactRow[] = [
      {
        label: t("impactStatus"),
        before: statusLabel(submission.status),
        delta: decision === "approve" ? t("deltaApprove") : t("deltaReject"),
        after: decision === "approve" ? statusLabel("APPROVED") : statusLabel("REJECTED"),
      },
    ];

    const granted = submission.entries_if_approved;
    if (granted === null) return rows;

    const balanceBefore = submission.entries_before;
    const balanceAfter = submission.entries_after_if_approved;

    const beforeText =
      balanceBefore === undefined || balanceBefore === null
        ? t("balanceNotPublished")
        : formatEntryCount(balanceBefore, locale);

    // Un rechazo no otorga nada: el "despues" es el "antes" tal cual, no una
    // cifra nueva. Se reusa el mismo texto y no se recalcula.
    const afterText =
      decision === "reject"
        ? balanceBefore === undefined || balanceBefore === null
          ? null
          : formatEntryCount(balanceBefore, locale)
        : balanceAfter === undefined || balanceAfter === null
          ? null
          : formatEntryCount(balanceAfter, locale);

    rows.push({
      label: t("impactEntries"),
      before: beforeText,
      delta:
        decision === "approve"
          ? formatSignedEntries(granted, (value) => formatEntryCount(value, locale))
          : t("entriesNone"),
      after: afterText,
    });

    return rows;
  }
}
