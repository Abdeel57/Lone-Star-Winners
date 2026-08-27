"use client";

import { Alert, Button, Checkbox, FormField, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import { reasonRequiresNote } from "@/lib/admin/reason-codes";

/**
 * Confirmacion de una mutacion sensible del panel.
 *
 * LAS TRES COSAS QUE SIEMPRE ENSENA, Y POR QUE
 * --------------------------------------------
 * 1. **Antes, cambio y despues**, fila por fila. Aprobar, rechazar o ajustar
 *    cambia el universo de participaciones de una promocion. Un boton que solo
 *    dice "aprobar" obliga a quien lo pulsa a reconstruir de memoria que va a
 *    pasar, y ese es exactamente el momento en el que se aprueba lo que no era.
 * 2. **Un motivo obligatorio**, como CLAVE estable y no como prosa. Seis meses
 *    despues, la unica respuesta a "por que existe esta participacion" es la
 *    que quedo registrada. Para el ajuste manual el contrato es tajante: la
 *    base de datos rechaza el cambio sin motivo.
 * 3. **Una confirmacion explicita.** Una casilla que hay que marcar. Es
 *    friccion deliberada: estas acciones no se deshacen con un `undo`, se
 *    corrigen con otra fila del ledger y otra entrada de auditoria.
 *
 * NINGUNA CIFRA SE CALCULA AQUI
 * -----------------------------
 * `before`, `delta` y `after` llegan YA FORMATEADOS desde el servidor, que a su
 * vez los recibe del backend. Este componente no suma, no resta y no compone
 * el resultado: si lo hiciera, existiria una segunda implementacion del motor
 * de participaciones viviendo en el navegador (DEC-023, requisito R13).
 *
 * `after: null` significa QUE EL BACKEND NO LO PUBLICA, y se dice. La
 * alternativa -calcularlo- es la que esta prohibida; la otra -no ensenar la
 * fila- ocultaria que hay un efecto cuyo alcance no se conoce.
 */

export interface SensitiveImpactRow {
  /** Que mide esta fila, ya traducido. */
  readonly label: string;
  /** Valor actual, YA FORMATEADO por el servidor. */
  readonly before: string;
  /** Cambio propuesto, ya formateado y con su signo si lo lleva. */
  readonly delta: string;
  /** Resultado, ya formateado. `null` si el backend no lo publica. */
  readonly after: string | null;
}

export interface SensitiveReasonOption {
  readonly value: string;
  /** Etiqueta ya traducida: las claves de motivo son datos, no copy. */
  readonly label: string;
}

export function SensitiveConfirmForm({
  locale,
  action,
  hiddenFields,
  impact,
  reasons,
  submitLabel,
  confirmLabel,
  warnings,
  destructive,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Identificadores que la accion necesita. Se revalidan en el servidor. */
  readonly hiddenFields: Readonly<Record<string, string>>;
  readonly impact: readonly SensitiveImpactRow[];
  readonly reasons: readonly SensitiveReasonOption[];
  readonly submitLabel: string;
  /** Texto de la casilla de confirmacion, ya traducido. */
  readonly confirmLabel: string;
  /** Advertencias del backend, ya traducidas. */
  readonly warnings?: readonly string[];
  /** Si la accion resta participaciones o rechaza algo. Cambia el tono, no la regla. */
  readonly destructive?: boolean;
}) {
  const t = useTranslations("admin.confirm");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const captionId = useId();

  /*
   * ESTADO DE CLIENTE, Y SOLO PARA DOS COSAS: si la casilla esta marcada y que
   * motivo se ha elegido. Ninguna de las dos decide nada -el servidor
   * revalida-; sirven para no dejar pulsar un boton que va a fallar y para
   * pedir la nota cuando el motivo por si solo no explica nada.
   *
   * Sin JavaScript el formulario sigue enviandose: la casilla es `required` en
   * el marcado y la nota la exige la accion.
   */
  const [confirmed, setConfirmed] = useState(false);
  const [reasonKey, setReasonKey] = useState<string>(reasons[0]?.value ?? "");
  const noteRequired = reasonRequiresNote(reasonKey);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <FormError result={state} />

      {state.status === "ok" ? <Alert tone="success">{t("done")}</Alert> : null}

      {warnings === undefined || warnings.length === 0 ? null : (
        <Alert tone="warning" title={t("warningsTitle")}>
          <ul className="list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/*
       * La tabla de impacto va en banda CLARA: es lo que hay que leer con
       * atencion justo antes de pulsar, y texto oscuro sobre claro se lee mejor
       * que el contrario en una jornada larga (DEC-039).
       */}
      <div className="lsw-panel-light overflow-x-auto p-4">
        <table className="w-full border-collapse text-body-sm" aria-describedby={captionId}>
          <caption id={captionId} className="mb-s3 text-left text-label font-medium">
            {t("impactCaption")}
          </caption>
          <thead>
            <tr className="border-b border-light-border text-caption uppercase tracking-wide">
              <th scope="col" className="py-2 pr-4 text-left font-medium">
                {t("columnWhat")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t("columnBefore")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t("columnDelta")}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {t("columnAfter")}
              </th>
            </tr>
          </thead>
          <tbody>
            {impact.map((row) => (
              <tr key={row.label} className="border-b border-light-border/60 last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {row.label}
                </th>
                <td className="py-2 pr-4 text-right tabular-nums">{row.before}</td>
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">{row.delta}</td>
                {/*
                  `??` y no un ternario: `after` es `string | null`, asi que las
                  dos formas son equivalentes y esta se lee mejor. Es una
                  eleccion de presentacion, NO una guarda de sesion ni de saldo;
                  las de esa clase se escriben en positivo y a mano (HO-027).
                */}
                <td className="py-2 text-right tabular-nums">
                  {row.after ?? (
                    <span className="text-light-text-muted">{t("afterNotPublished")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FormField
        label={t("reasonLabel")}
        description={t("reasonHint")}
        required
        error={fieldError("reason_key")}
      >
        <Select
          name="reason_key"
          value={reasonKey}
          onChange={(event) => setReasonKey(event.currentTarget.value)}
        >
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={noteRequired ? t("noteLabelRequired") : t("noteLabel")}
        description={t("noteHint")}
        required={noteRequired}
        error={fieldError("reason_note")}
      >
        <Textarea name="reason_note" rows={3} {...(noteRequired ? { required: true } : {})} />
      </FormField>

      <Checkbox
        name="confirmed"
        required
        checked={confirmed}
        onChange={(event) => setConfirmed(event.currentTarget.checked)}
        label={confirmLabel}
      />

      {/*
       * `danger` para lo que resta o rechaza, `accent` para lo que otorga. El
       * color no es la unica senal -el texto del boton dice exactamente que
       * hace- pero un rechazo y una aprobacion con el mismo aspecto es un clic
       * equivocado esperando a ocurrir.
       */}
      <Button
        type="submit"
        variant={destructive === true ? "danger" : "accent"}
        size="lg"
        loading={pending}
        disabled={!confirmed}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
