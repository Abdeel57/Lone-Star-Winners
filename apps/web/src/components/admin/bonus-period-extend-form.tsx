"use client";

import { Alert, Button, Checkbox, FormField, Input, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Alargar un periodo bonus ya publicado (DEC-084).
 *
 * El fin se escribe en HORA DE PARED de la zona legal de la promocion, con el
 * selector de fecha y hora del navegador: quien lo usa piensa "el 15 a las
 * 11:59 de la noche", no en un instante UTC. La conversion la hace la accion en
 * el servidor, igual que con las fechas de la promocion.
 *
 * Como crear un bonus, publica una version de reglas nueva y lo dice antes de
 * dejar enviarlo. Solo alarga: la API rechaza un fin anterior al actual o
 * posterior al cierre de la promocion, y su respuesta se ensena tal cual.
 */
export function BonusPeriodExtendForm({
  locale,
  action,
  promotionId,
  periodId,
  timeZone,
  currentEndWall,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  readonly periodId: string;
  /** Zona legal de la promocion (DEC-011). */
  readonly timeZone: string;
  /** Fin actual en hora de pared de esa zona, `YYYY-MM-DDTHH:mm`. */
  readonly currentEndWall: string;
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.bonus");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />
      <input type="hidden" name="period_id" value={periodId} />
      <input type="hidden" name="time_zone" value={timeZone} />

      <FormError result={state} />

      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger" title={t("engineSaid")}>
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? (
        <Alert tone={state.detail === null ? "success" : "warning"}>
          {state.detail === null ? (
            t("extended")
          ) : (
            <>
              <p>{t("createdWithWarnings")}</p>
              <p className="mt-s2 font-mono text-body-sm">{state.detail}</p>
            </>
          )}
        </Alert>
      ) : null}

      <FormField
        label={t("extendEndsAtLabel", { zone: timeZone })}
        description={t("extendHint")}
        required
        error={fieldError("ends_at")}
      >
        <Input
          name="ends_at"
          type="datetime-local"
          defaultValue={currentEndWall}
          min={currentEndWall}
          required
        />
      </FormField>

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <FormField label={t("reasonLabel")} required error={fieldError("reason_code")}>
          <Select name="reason_code" required defaultValue={reasons[0]?.value ?? ""}>
            {reasons.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label={t("reasonTextLabel")}
          description={t("reasonTextHint")}
          error={fieldError("reason_text")}
        >
          <Textarea name="reason_text" rows={1} />
        </FormField>
      </div>

      <Checkbox
        name="confirmed"
        required
        checked={confirmed}
        onChange={(event) => setConfirmed(event.currentTarget.checked)}
        label={t("confirm")}
      />

      <Button
        type="submit"
        variant="secondary"
        size="md"
        loading={pending}
        disabled={!confirmed}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("extendSubmit")}
      </Button>
    </form>
  );
}
