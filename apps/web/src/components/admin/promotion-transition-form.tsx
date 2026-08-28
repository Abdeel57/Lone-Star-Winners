"use client";

import { Alert, Button, Checkbox, FormField, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

export type PromotionTransition = "schedule" | "activate" | "close";

/**
 * Cambio de estado de una promocion: programar, activar o cerrar.
 *
 * LO QUE SE DICE ANTES DEL BOTON, NO DESPUES DEL 409
 * --------------------------------------------------
 * Los cerrojos los impone la base de datos y se los devuelve al panel como un
 * 409 con su mensaje. Pero hay dos que la pantalla ya conoce ANTES de que nadie
 * pulse -falta el periodo, falta la version de reglas- y esperar al 409 para
 * decirlos seria hacer que alguien elija motivo, escriba una nota, marque la
 * casilla y descubra al final que no podia. Se dicen arriba, en tono de aviso,
 * y el boton se deshabilita. NO es el control: el control sigue siendo el
 * motor, y la accion se enviaria igual si alguien quitara el `disabled`.
 *
 * EL MENSAJE DEL MOTOR SE ENSENA TAL CUAL
 * ---------------------------------------
 * Cuando el 409 llega de todos modos, `state.detail` trae el texto de
 * PostgreSQL explicando cual de los cerrojos salto. Se pinta sin traducir y sin
 * resumir: el unico que sabe con certeza que fallo es el que lo comprobo, y una
 * explicacion reescrita aqui quedaria obsoleta el dia que cambie el trigger.
 *
 * PROGRAMAR NO PIDE MOTIVO; ACTIVAR Y CERRAR SI
 * ---------------------------------------------
 * Programar es reversible y no reparte participaciones. Activar abre el
 * universo y cerrar lo cierra: las dos exigen motivo -que lee el autorizador
 * antes del handler- y segundo factor reciente. El motivo es una CLAVE estable,
 * no prosa, para que la traza se pueda agregar y filtrar; la nota libre existe
 * ademas, para el detalle que la clave no lleva.
 */
export function PromotionTransitionForm({
  locale,
  action,
  promotionId,
  transition,
  blockedReason,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  readonly transition: PromotionTransition;
  /**
   * Motivo, ya traducido, por el que esta transicion no puede enviarse todavia.
   * `undefined` cuando la pantalla no conoce ningun impedimento; el motor puede
   * conocer otros.
   */
  readonly blockedReason?: string;
  /** Motivos ofrecidos, ya traducidos. Vacio para `schedule`. */
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.promotions");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const [confirmed, setConfirmed] = useState(false);

  const requiresReason = transition !== "schedule";
  const blocked = blockedReason !== undefined;

  const cta =
    transition === "schedule"
      ? t("scheduleCta")
      : transition === "activate"
        ? t("activateCta")
        : t("closeCta");

  const body =
    transition === "schedule"
      ? t("scheduleBody")
      : transition === "activate"
        ? t("activateBody")
        : t("closeBody");

  const confirmLabel =
    transition === "schedule"
      ? t("confirmSchedule")
      : transition === "activate"
        ? t("confirmActivate")
        : t("confirmClose");

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />

      <p className="text-body-sm text-text-muted">{body}</p>

      {/* El impedimento conocido va ARRIBA, antes de pedir nada. */}
      {blocked ? <Alert tone="warning">{blockedReason}</Alert> : null}

      <FormError result={state} />

      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger" title={t("engineSaid")}>
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? <Alert tone="success">{t("stateChanged")}</Alert> : null}

      {requiresReason ? (
        <>
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
            <Textarea name="reason_text" rows={2} />
          </FormField>
        </>
      ) : null}

      <Checkbox
        name="confirmed"
        required
        checked={confirmed}
        onChange={(event) => setConfirmed(event.currentTarget.checked)}
        label={confirmLabel}
      />

      <Button
        type="submit"
        variant={transition === "close" ? "danger" : "primary"}
        size="lg"
        loading={pending}
        // Se escribe en positivo y a mano (HO-027): "hay impedimento" o "no ha
        // confirmado". Ninguno de los dos es el control.
        disabled={blocked || !confirmed}
        className="w-full sm:w-auto sm:self-start"
      >
        {cta}
      </Button>
    </form>
  );
}
