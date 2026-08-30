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
  const t = await getTranslations({ locale, namespace: "admin.amoeReview" });
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

      {/*
       * FICHA TRANSCRITA: quien la teclee no podra aprobarla.
       *
       * Se dice en la FILA y no solo en el panel de decision porque quien
       * reparte la cola tiene que poder ver de un vistazo cuales no puede
       * cerrar. El aviso es general -no dice quien fue- porque la cola publica
       * el identificador del transcriptor y no el del que mira: el CONTROL es
       * el 409 `SEPARATION_OF_DUTIES` del backend, y esto solo lo anticipa.
       */}
      {submission.transcribed_by_me ? (
        <p className="mt-s3 text-body-sm text-warning-text">{t("transcribedByYou")}</p>
      ) : submission.transcribed_by_admin_user_id === undefined ||
        submission.transcribed_by_admin_user_id === null ? null : (
        <p className="mt-s3 text-body-sm text-text-muted">{t("transcribedNotice")}</p>
      )}

      {/*
       * EL RECORTE POR TOPE, EN LA PROYECCION (§13.3).
       *
       * `entries_if_approved` dice cuanto vale la ficha y
       * `entries_if_approved_after_cap` cuanto entraria de verdad. Las dos se
       * pintan; restarlas seria la aritmetica que R13 prohibe, y ademas con
       * espacio CERO la aprobacion falla con `AMOE_ENTRY_CAP_REACHED` en vez de
       * otorgar nada.
       */}
      {submission.cap_applies !== true ? null : (
        <p className="mt-s2 text-body-sm text-text">
          {submission.entries_if_approved_after_cap === undefined ||
          submission.entries_if_approved_after_cap === null
            ? t("capUnknown")
            : submission.entries_if_approved_after_cap === 0
              ? t("capNoRoom")
              : t("capProjection", {
                  granted: formatEntryCount(submission.entries_if_approved_after_cap, locale),
                })}
        </p>
      )}

      {/*
       * SOBRE CON MAS FICHAS DE LAS ADMITIDAS (§13.10).
       *
       * El envio entra MARCADO y va a revision; no se rechaza solo. Que pasa
       * con la tercera ficha de un sobre de dos es una pregunta abierta para el
       * abogado (docs/LEGAL_PENDING.md), y el sistema no la responde por su
       * cuenta: la decide quien revisa, y por eso la marca se ve aqui.
       */}
      {submission.flagged_envelope === true ? (
        <p className="mt-s2 text-body-sm text-warning-text">{t("envelopeFlagged")}</p>
      ) : null}

      {/*
       * YA APROBADO: lo que ENTRO, y por que no fue mas
       * (HO-041, resolucion fase 1, punto 4). Sin esto, una ficha de 2,000 que
       * otorgo 550 no tiene explicacion en ninguna pantalla.
       */}
      {submission.applied_cap === undefined || submission.applied_cap === null ? null : (
        <p className="mt-s2 text-body-sm text-text">
          {t("appliedCap", {
            granted: formatEntryCount(submission.applied_cap.granted, locale),
            requested: formatEntryCount(submission.applied_cap.requested, locale),
            limit: formatEntryCount(submission.applied_cap.limit, locale),
          })}
        </p>
      )}
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

  /*
   * LA PROPIA TRANSCRIPCION NO SE DECIDE, NI EN UN SENTIDO NI EN EL OTRO
   * (§13.10).
   *
   * Quien teclea una ficha postal no puede aprobarla NI RECHAZARLA: el backend
   * bloquea las dos rutas con 409 `SEPARATION_OF_DUTIES`. Esta pantalla llego a
   * ofrecer el rechazo, con el argumento de que la separacion de funciones
   * protege la concesion de participaciones y no la negativa. Es falso, y lo
   * senalo la revision de seguridad: **rechazar una ficha valida tambien es un
   * dano** -le niega participaciones a alguien que participo bien- y quien la
   * transcribio es exactamente la persona que podria tapar su propio error al
   * teclearla. La separacion cubre la DECISION entera.
   *
   * Retirar el formulario es cortesia -evita que alguien elija motivo, marque
   * la casilla y descubra al final que no podia-, NO el control.
   */
  const ownTranscription = submission.transcribed_by_me;

  const allowed = decision === "approve" ? canApprove : canReject;

  if (ownTranscription) {
    return (
      <Card elevation="raised" padding="lg">
        <EmptyState
          headingLevel="h2"
          title={t("ownTranscriptionTitle")}
          description={t("ownTranscriptionBody")}
          action={
            <Link
              href={adminHref(locale, "/amoe")}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("cancel")}
            </Link>
          }
        />
      </Card>
    );
  }

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
          hiddenFields={{ submission_id: submission.submission_id }}
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

    /*
     * FILA APARTE PARA EL RECORTE (§13.3), y no un asterisco en la de arriba.
     *
     * Con el tope encendido, lo que entra en el ledger no es lo que vale la
     * ficha. Quien aprueba tiene que ver LAS DOS cifras antes de causarlas, y
     * ninguna de las dos la puede producir esta pantalla: el "espacio restante"
     * sale del predicado de saldo del motor (DEC-034), no de una resta.
     *
     * Con espacio CERO la aprobacion no otorga nada: falla con
     * `AMOE_ENTRY_CAP_REACHED` y el envio se queda en revision. Se dice antes,
     * porque enviar a alguien a firmar una accion que ya se sabe que va a
     * fallar es lo que esta tabla existe para evitar.
     */
    if (submission.cap_applies === true) {
      const afterCap = submission.entries_if_approved_after_cap ?? null;

      rows.push({
        label: t("impactCap"),
        before: t("capLimitRow"),
        delta:
          afterCap === null
            ? t("capUnknown")
            : afterCap === 0
              ? t("capNoRoom")
              : formatSignedEntries(afterCap, (value) => formatEntryCount(value, locale)),
        after: null,
      });
    }

    return rows;
  }
}
