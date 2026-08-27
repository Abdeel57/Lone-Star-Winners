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
 * LOS DATOS ENVIADOS SE PINTAN COMO TEXTO, CUANDO LLEGAN
 * ------------------------------------------------------
 * `payload` lo escribio un desconocido. Se recorre como pares clave/valor y se
 * renderiza como texto plano; no hay `dangerouslySetInnerHTML` en ninguna parte
 * de esta interfaz y este es justo el sitio donde mas caro saldria.
 *
 * HOY LA COLA NO LO PUBLICA: el documento es tajante -"lleva `participant_id`
 * interno; nunca el payload"- porque un listado de revision no es el sitio donde
 * repartir datos personales. La pantalla lo DICE en vez de ensenar un hueco que
 * parece un envio vacio, que son dos cosas muy distintas delante de quien tiene
 * que decidir. El bloque se conserva para el dia que exista una lectura
 * autorizada de un envio concreto.
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

        {/*
         * TRES ESTADOS, y distinguirlos importa: no publicado -la cola no trae
         * el payload-, publicado y vacio -un envio sin campos-, y publicado con
         * datos. Colapsar los dos primeros haria que una limitacion del listado
         * pareciera un envio en blanco.
         */}
        {submission.payload === undefined ? (
          <p className="mt-s2 text-body-sm text-text-muted">{t("payloadNotPublished")}</p>
        ) : Object.keys(submission.payload).length === 0 ? (
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
   * LAS TRES COLUMNAS, FILA POR FILA, TAL COMO LAS SIRVE LA COLA.
   *
   * El estado tiene las tres: se sabe de donde viene y a donde va. Las
   * participaciones vienen calculadas POR EL MOTOR -`entries_before`,
   * `entries_if_approved` y `entries_after_if_approved`- y aqui solo se
   * formatean. Sumar el delta al saldo seria reimplementar el motor en la
   * interfaz, y la red `no-client-entry-math.test.ts` esta para que eso no pase
   * inadvertido.
   *
   * `entries_before` SIEMPRE trae numero: cero es un saldo conocido, no un
   * hueco. Las otras dos son `null` cuando la version de reglas DEL ENVIO ya no
   * declara AMOE legible; entonces la aprobacion fallaria, y ensenar una cifra
   * que no se va a cumplir es peor que marcar la fila como no publicada.
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
    const beforeText = formatEntryCount(submission.entries_before, locale);

    // Un rechazo no otorga nada: el "despues" es el "antes" tal cual, no una
    // cifra nueva. Se reusa el mismo texto y no se recalcula.
    if (decision === "reject") {
      rows.push({
        label: t("impactEntries"),
        before: beforeText,
        delta: t("entriesNone"),
        after: beforeText,
      });

      return rows;
    }

    if (granted === null) {
      /*
       * La proyeccion no se puede calcular: la version de reglas del envio ya
       * no declara AMOE legible. Se dice -con las dos casillas de la derecha sin
       * publicar- en vez de omitir la fila, que ocultaria que hay un efecto
       * sobre las participaciones cuyo alcance no se conoce.
       */
      rows.push({
        label: t("impactEntries"),
        before: beforeText,
        delta: t("balanceNotPublished"),
        after: null,
      });

      return rows;
    }

    const balanceAfter = submission.entries_after_if_approved;

    rows.push({
      label: t("impactEntries"),
      before: beforeText,
      delta: formatSignedEntries(granted, (value) => formatEntryCount(value, locale)),
      after: balanceAfter === null ? null : formatEntryCount(balanceAfter, locale),
    });

    return rows;
  }
}
