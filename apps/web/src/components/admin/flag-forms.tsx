"use client";

import { Alert, Button, Checkbox, FormField, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import { AMOE_MODES, type AmoeMode } from "@/lib/api";

/**
 * Los tres gestos de la pantalla de ajustes (§13.9, HO-041 resolucion fase 1).
 *
 * POR QUE TRES Y NO UNO
 * ---------------------
 * No todos los ajustes valen lo mismo. Un flag NO material -por ejemplo,
 * enseñar o no los numeros de participacion- lo cambia una persona con motivo.
 * Un flag LEGALMENTE MATERIAL -si existe via gratuita, si los topes se aplican,
 * si los multiplicadores cuentan- cambia lo que la plataforma afirma sobre las
 * condiciones de participacion, y DEC-032 pide segunda aprobacion: se SOLICITA,
 * y otra persona decide. Son dos gestos con dos rutas y dos capacidades, y el
 * tercero es esa decision.
 *
 * Fundirlos en un solo formulario habria hecho que el peso de la accion
 * dependiera del flag elegido en un desplegable, que es exactamente lo que la
 * separacion de rutas evita.
 *
 * NINGUNO DE LOS TRES ES EL CONTROL. El autorizador exige la capacidad y el
 * step-up; la `CHECK` de la tabla impide aprobar lo propio. La interfaz
 * deshabilita, advierte y pinta el 409 o el 403 tal cual.
 */

/**
 * Interruptor de un flag NO material.
 *
 * `enabled` viaja como el valor CONTRARIO al actual, resuelto en el servidor
 * que renderiza: el boton dice lo que va a hacer -"Encender" o "Apagar"- en vez
 * de ser una casilla cuyo estado hay que interpretar. Un interruptor que
 * cambia al pulsarlo y ademas necesita motivo produce el gesto ambiguo de
 * "cambiar y luego confirmar".
 */
export function FlagToggleForm({
  locale,
  action,
  flagKey,
  enabled,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly flagKey: string;
  readonly enabled: boolean;
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.flags");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s3">
      <LocaleField locale={locale} />
      <input type="hidden" name="flag_key" value={flagKey} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />

      <FormError result={state} />

      {/* El 409 `FLAG_LEGALLY_MATERIAL` llega con `details.use` apuntando a la
          ruta correcta. Se ensena tal cual: no es "no tienes permiso" -eso
          seria falso- sino "este ajuste no se cambia por aqui". */}
      {state.status === "error" && state.detail !== null ? (
        <Alert tone="warning">
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? <Alert tone="success">{t("changed")}</Alert> : null}

      <FormField label={t("reasonLabel")} required error={fieldError("reason_code")}>
        <Select name="reason_code" required defaultValue={reasons[0]?.value ?? ""}>
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("reasonTextLabel")} error={fieldError("reason_text")}>
        <Textarea name="reason_text" rows={2} />
      </FormField>

      <Button
        type="submit"
        variant={enabled ? "danger" : "primary"}
        size="sm"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {enabled ? t("turnOff") : t("turnOn")}
      </Button>
    </form>
  );
}

/**
 * Solicitud de cambio de un ajuste LEGALMENTE MATERIAL.
 *
 * Sirve para las dos cosas que van por control dual: un flag material y la
 * modalidad AMOE. Lo que cambia entre las dos es UN campo -un booleano
 * implicito o un enum- y por eso es un solo componente con una rama, en vez de
 * dos formularios que compartirian todo lo demas.
 *
 * LA RESPUESTA DICE SI QUEDO PENDIENTE O SE APLICO, y la pantalla lo repite. Con
 * `dual_approval_for_sensitive_actions_enabled` apagado el cambio surte efecto
 * al momento; suponer que siempre queda pendiente diria que no ha pasado nada
 * cuando si ha pasado.
 */
export function SettingChangeRequestForm({
  locale,
  action,
  settingKind,
  settingKey,
  enabled,
  currentMode,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly settingKind: "FEATURE_FLAG" | "AMOE_MODE";
  readonly settingKey: string;
  /** Estado actual del flag. Solo para `FEATURE_FLAG`. */
  readonly enabled?: boolean;
  /** Modalidad vigente. Solo para `AMOE_MODE`. */
  readonly currentMode?: AmoeMode | null;
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.flags");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const [confirmed, setConfirmed] = useState(false);

  const isFlag = settingKind === "FEATURE_FLAG";

  return (
    <form action={formAction} className="flex flex-col gap-s3">
      <LocaleField locale={locale} />
      <input type="hidden" name="setting_kind" value={settingKind} />
      <input type="hidden" name="setting_key" value={settingKey} />
      {isFlag ? (
        <input type="hidden" name="enabled" value={enabled === true ? "false" : "true"} />
      ) : null}

      {/* LA ADVERTENCIA VA ANTES DEL GESTO, no despues del 403. Quien opera
          tiene que saber que esto exige otra capacidad y segundo factor
          reciente ANTES de escribir el motivo. */}
      <Alert tone="info">{t("materialNotice")}</Alert>

      <FormError result={state} />

      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger">
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? (
        <Alert tone={state.detail === "APPLIED" ? "success" : "info"}>
          {state.detail === "APPLIED" ? t("requestApplied") : t("requestCreated")}
        </Alert>
      ) : null}

      {isFlag ? null : (
        <FormField
          label={t("amoeModeLabel")}
          description={t("amoeModeHint")}
          error={fieldError("amoe_mode")}
        >
          <Select name="amoe_mode" defaultValue={currentMode ?? ""}>
            <option value="">{t("amoeModeNone")}</option>
            {AMOE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </Select>
        </FormField>
      )}

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

      <Checkbox
        name="confirmed"
        checked={confirmed}
        onChange={(event) => setConfirmed(event.currentTarget.checked)}
        label={isFlag ? t("confirmFlagRequest", { key: settingKey }) : t("confirmModeRequest")}
      />

      <Button
        type="submit"
        variant="primary"
        size="sm"
        loading={pending}
        disabled={!confirmed}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("requestChange")}
      </Button>
    </form>
  );
}

/**
 * Decision sobre una solicitud pendiente.
 *
 * QUIEN LA PIDIO NO PUEDE DECIDIRLA: con `requested_by_me` los botones no se
 * ofrecen y se explica por que. Es cortesia -evita mandar a alguien a firmar
 * una decision que ya se sabe que va a rebotar-; el CONTROL son el servicio y
 * una `CHECK` de la tabla, que responden 409
 * `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` y que la pantalla pinta tal cual.
 *
 * DOS BOTONES Y UN SOLO FORMULARIO. El motivo es el mismo campo para aprobar y
 * para rechazar -"por que se decide asi"- y duplicarlo produciria dos motivos
 * escritos para la misma decision.
 */
export function SettingChangeDecisionForm({
  locale,
  action,
  requestId,
  requestedByMe,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly requestId: string;
  /**
   * Si la solicitud la hizo quien mira (§13.9, HO-041).
   *
   * Llega SIEMPRE: la API lo publica por fila. Dejo de ser nulable cuando
   * backend lo cerro, y con el la rama de "no se sabe de quien es", que
   * ofrecia los dos botones a ciegas.
   */
  readonly requestedByMe: boolean;
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.flags");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  const blocked = requestedByMe;

  return (
    <form action={formAction} className="mt-s4 flex flex-col gap-s3 border-t border-border pt-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="request_id" value={requestId} />

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("decisionSaved")}</Alert> : null}

      {blocked ? <Alert tone="info">{t("selfApprovalBlocked")}</Alert> : null}

      <FormField label={t("reasonLabel")} required error={fieldError("reason_code")}>
        <Select name="reason_code" required defaultValue={reasons[0]?.value ?? ""}>
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("reasonTextLabel")} error={fieldError("reason_text")}>
        <Textarea name="reason_text" rows={2} />
      </FormField>

      <div className="flex flex-wrap gap-s3">
        {/* `name="decision"` en el propio boton: el navegador manda el valor del
            boton que se pulso, asi que un solo formulario cubre las dos
            decisiones sin estado de cliente. */}
        <Button
          type="submit"
          name="decision"
          value="approve"
          variant="primary"
          size="sm"
          loading={pending}
          disabled={blocked}
        >
          {t("approve")}
        </Button>

        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="danger"
          size="sm"
          loading={pending}
          disabled={blocked}
        >
          {t("reject")}
        </Button>
      </div>
    </form>
  );
}
