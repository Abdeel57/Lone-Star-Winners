"use client";

import { Alert, Button, Checkbox, FormField, Input, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Estrategias de conflicto entre periodos, tal como las nombra el dominio.
 *
 * Son IDENTIFICADORES y se pintan sin traducir: es lo que se escribe en
 * `multipliers.conflict_strategy` de la version de reglas, y una etiqueta
 * traducida los haria inencontrables ahi. Cual aplica lo decide el abogado
 * (`docs/LEGAL_PENDING.md`, pregunta 10); el panel solo ofrece las que el motor
 * sabe interpretar.
 */
const CONFLICT_STRATEGIES = ["HIGHEST_WINS", "STACK", "EXCLUSIVE", "PRIORITY_ORDER"] as const;

/**
 * Atajo "periodo bonus" (§13.8, DEC-054 punto 2).
 *
 * ES UNA VERSION DE REGLAS NUEVA, Y LA PANTALLA LO DICE
 * ----------------------------------------------------
 * El gesto que pidio el cliente -"5X durante las proximas 12 horas"- no crea un
 * objeto suelto: clona la version de reglas ACTIVA, le anade el periodo y activa
 * la nueva. Es lo que DEC-012 obliga a que sea, y por eso exige exactamente lo
 * mismo que activar una version: motivo, confirmacion y segundo factor reciente.
 * El formulario lo explica arriba, porque quien viene a "poner un 5X" no espera
 * estar publicando una version de las Reglas Oficiales.
 *
 * EL MULTIPLICADOR ES UNA FRACCION, NO UN DECIMAL (DEC-010)
 * ---------------------------------------------------------
 * Los tres atajos -2X, 5X, 10X- son los que nombro el cliente, y no son un
 * limite del sistema: el campo libre admite numerador y denominador, de modo que
 * un 3/2 se puede expresar exacto. Lo que NO existe es una casilla decimal:
 * "1.5" redondeado es una cifra distinta de la que aplica el motor.
 *
 * EL TECHO LEGAL NO ESTA AQUI. `bonus_rules.max_multiplier` lo declara la
 * version de reglas y lo comprueba la API, que responde 422. Escribir el limite
 * en este formulario seria fijar en el frontend una regla legal (CLAUDE.md #14).
 *
 * LOS PRESETS COMPONEN LA VENTANA EN EL SERVIDOR
 * ----------------------------------------------
 * "Ahora + 12h" se resuelve en la Server Action y no en el navegador: la
 * duracion no puede depender del reloj de quien pulsa (DEC-011). Con "fechas
 * concretas" se piden dos instantes absolutos en UTC, y el formulario lo dice:
 * un periodo de doce horas que cruza un cambio de horario no tiene una respuesta
 * obvia, y no es el frontend quien debe elegirla.
 *
 * LAS ADVERTENCIAS DE LA RESPUESTA SE ENSENAN
 * -------------------------------------------
 * Con `entry_multipliers_enabled` apagado, la API crea el periodo y avisa de que
 * NO aplica. Ese aviso se pinta junto al exito, no se traga: un bonus creado que
 * no se aplica es exactamente lo que hay que saber al momento.
 */
export function BonusPeriodForm({
  locale,
  action,
  promotionId,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  /** Motivos ofrecidos, ya traducidos. */
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.bonus");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const [confirmed, setConfirmed] = useState(false);
  const [preset, setPreset] = useState("12h");

  const custom = preset === "custom";

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />

      <p className="text-body-sm text-text-muted">{t("body")}</p>

      <FormError result={state} />

      {/* El 409 del motor -o el 422 de `bonus_rules`- llega con el texto del
          backend en `detail`. Se ensena tal cual: el unico que sabe con certeza
          que regla se incumplio es quien la comprobo. */}
      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger" title={t("engineSaid")}>
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? (
        <Alert tone={state.detail === null ? "success" : "warning"}>
          {state.detail === null ? (
            t("created")
          ) : (
            <>
              <p>{t("createdWithWarnings")}</p>
              <p className="mt-s2 font-mono text-body-sm">{state.detail}</p>
            </>
          )}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <FormField
          label={t("multiplierNumeratorLabel")}
          description={t("multiplierHint")}
          required
          error={fieldError("multiplier_numerator")}
        >
          <Input
            name="multiplier_numerator"
            inputMode="numeric"
            pattern="[0-9]*"
            defaultValue="5"
            autoComplete="off"
            required
          />
        </FormField>

        <FormField
          label={t("multiplierDenominatorLabel")}
          description={t("multiplierDenominatorHint")}
          error={fieldError("multiplier_denominator")}
        >
          <Input
            name="multiplier_denominator"
            inputMode="numeric"
            pattern="[0-9]*"
            defaultValue="1"
            autoComplete="off"
          />
        </FormField>

        <FormField label={t("scopeLabel")} error={fieldError("product_kind_scope")}>
          <Select name="product_kind_scope" defaultValue="ENTRY_PACKAGE">
            <option value="ENTRY_PACKAGE">{t("scopePackages")}</option>
            <option value="MERCHANDISE">{t("scopeMerchandise")}</option>
            <option value="ALL">{t("scopeAll")}</option>
          </Select>
        </FormField>
      </div>

      <FormField
        label={t("durationLabel")}
        description={t("durationHint")}
        error={fieldError("duration_preset")}
      >
        <Select
          name="duration_preset"
          value={preset}
          onChange={(event) => {
            setPreset(event.target.value);
          }}
        >
          <option value="6h">{t("duration6h")}</option>
          <option value="12h">{t("duration12h")}</option>
          <option value="24h">{t("duration24h")}</option>
          <option value="48h">{t("duration48h")}</option>
          <option value="custom">{t("durationCustom")}</option>
        </Select>
      </FormField>

      {/* Los dos campos de fecha solo aparecen con "fechas concretas". Con un
          preset serian dos huecos que no se usan y que invitan a rellenarlos. */}
      {!custom ? null : (
        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <FormField
            label={t("startsAtLabel")}
            description={t("instantHint")}
            required
            error={fieldError("starts_at")}
          >
            <Input name="starts_at" autoComplete="off" spellCheck={false} required />
          </FormField>

          <FormField
            label={t("endsAtLabel")}
            description={t("instantHint")}
            required
            error={fieldError("ends_at")}
          >
            <Input name="ends_at" autoComplete="off" spellCheck={false} required />
          </FormField>
        </div>
      )}

      {/*
       * ESTRATEGIA DE CONFLICTO, VACIA POR DEFECTO.
       *
       * Solo hace falta cuando la version activa no declara `multipliers`, y en
       * ese caso la API la exige: el motor FALLA en vez de desempatar por su
       * cuenta, y eso se corrige en la configuracion legal, no en el cliente.
       * El campo se ofrece vacio para no imponer una estrategia por descuido.
       */}
      <FormField
        label={t("conflictStrategyLabel")}
        description={t("conflictStrategyHint")}
        error={fieldError("conflict_strategy")}
      >
        <Select name="conflict_strategy" defaultValue="">
          <option value="">{t("conflictStrategyUnset")}</option>
          {/* Los cuatro valores se pintan EN CRUDO: son identificadores del
              dominio (`multipliers.conflict_strategy`) y traducirlos los haria
              inencontrables en la configuracion, que es donde se escriben. Se
              recorren desde la constante para que no vivan como texto suelto
              dentro del JSX. */}
          {CONFLICT_STRATEGIES.map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy}
            </option>
          ))}
        </Select>
      </FormField>

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
        required
        checked={confirmed}
        onChange={(event) => setConfirmed(event.currentTarget.checked)}
        label={t("confirm")}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        // Escrito en positivo: "no ha confirmado". No es el control -el backend
        // exige motivo y step-up- sino la friccion deliberada de una accion que
        // publica una version de las Reglas Oficiales.
        disabled={!confirmed}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("submit")}
      </Button>
    </form>
  );
}
