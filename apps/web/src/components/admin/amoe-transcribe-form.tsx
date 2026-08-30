"use client";

import { Alert, Button, FormField, Input, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import { useAmoeFieldLabel } from "@/i18n/amoe-labels";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import type { NormalizedAmoeField } from "@/lib/amoe-config";

/**
 * Transcripcion de una ficha postal (§13.10, DEC-054 punto 4).
 *
 * POR QUE EXISTE ESTE FORMULARIO
 * ------------------------------
 * La via gratuita del segundo borrador es POSTAL: llegan fichas manuscritas en
 * sobres. Sin una forma de meterlas en el sistema, el metodo gratuito no
 * existe en la practica, y sin metodo gratuito real la promocion deja de ser
 * un sweepstakes. Es la pieza que convierte una regla escrita en algo operable.
 *
 * LOS CAMPOS SON LOS QUE DECLARA LA CONFIGURACION, NI UNO MAS
 * -----------------------------------------------------------
 * Se pintan EXACTAMENTE los de `required_fields` de la modalidad vigente, en el
 * orden que llegan. Uno de mas es recogida de datos personales que nadie
 * autorizo (CLAUDE.md #2); uno de menos, un envio que el backend rechaza. Las
 * etiquetas salen del diccionario del frontend por `label_key` (DEC-022), y una
 * clave desconocida cae a un texto generico -nunca a la clave en crudo-.
 *
 * QUIEN TRANSCRIBE NO PODRA APROBAR
 * ---------------------------------
 * Y el formulario lo dice ANTES de teclear treinta caracteres de direccion
 * postal. El control es el 409 `SEPARATION_OF_DUTIES` del backend; esto es el
 * aviso, que evita que alguien transcriba la cola entera y despues descubra que
 * no puede cerrar ninguna.
 *
 * EL SOBRE CON MAS FICHAS DE LAS PERMITIDAS NO SE RECHAZA AQUI
 * ------------------------------------------------------------
 * Se anota y el envio entra MARCADO para revision. Que pasa con la tercera
 * ficha de un sobre de dos es una pregunta abierta para el abogado
 * (`docs/LEGAL_PENDING.md`), y el sistema no la responde por su cuenta.
 */
export function AmoeTranscribeForm({
  locale,
  action,
  promotionId,
  fields,
  maxCardsPerEnvelope,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  /** Campos declarados por la configuracion AMOE vigente. */
  readonly fields: readonly NormalizedAmoeField[];
  /** `mail_in.max_cards_per_envelope`, si la configuracion lo declara. */
  readonly maxCardsPerEnvelope: number | null;
}) {
  const t = useTranslations("admin.amoeTranscribe");
  const fieldLabel = useAmoeFieldLabel();
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />
      {/* Las claves viajan en un campo oculto: la accion compone el `payload`
          con ESTAS y solo estas. Escribirlas en el servidor seria fijar en el
          frontend que se pide para participar gratis. */}
      <input type="hidden" name="payload_keys" value={fields.map((field) => field.key).join(",")} />

      <p className="text-body-sm text-text-muted">{t("body")}</p>

      <Alert tone="info">{t("separationNotice")}</Alert>

      <FormError result={state} />

      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger">
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? <Alert tone="success">{t("created")}</Alert> : null}

      <FormField
        label={t("participantEmailLabel")}
        description={t("participantEmailHint")}
        required
        error={fieldError("participant_email")}
      >
        <Input name="participant_email" type="email" autoComplete="off" required />
      </FormField>

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        {fields.map((field) => (
          <FormField
            key={field.key}
            label={fieldLabel(field.labelKey)}
            required={field.required}
            error={fieldError(`field_${field.key}`)}
            className={field.type === "TEXTAREA" ? "sm:col-span-2" : ""}
          >
            {field.type === "TEXTAREA" ? (
              <Textarea
                name={`field_${field.key}`}
                rows={3}
                required={field.required}
                {...(field.maxLength === null ? {} : { maxLength: field.maxLength })}
              />
            ) : (
              <Input
                name={`field_${field.key}`}
                type={inputTypeFor(field.type)}
                autoComplete="off"
                required={field.required}
                {...(field.maxLength === null ? {} : { maxLength: field.maxLength })}
              />
            )}
          </FormField>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <FormField
          label={t("envelopeLabel")}
          description={t("envelopeHint")}
          error={fieldError("envelope_reference")}
        >
          <Input name="envelope_reference" autoComplete="off" spellCheck={false} />
        </FormField>

        <FormField
          label={t("cardsLabel")}
          description={
            maxCardsPerEnvelope === null
              ? t("cardsHint")
              : t("cardsHintWithLimit", { max: maxCardsPerEnvelope })
          }
          error={fieldError("cards_in_envelope")}
        >
          <Input
            name="cards_in_envelope"
            inputMode="numeric"
            pattern="[0-9]*"
            defaultValue="1"
            autoComplete="off"
          />
        </FormField>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("submit")}
      </Button>
    </form>
  );
}

/**
 * El control HTML que corresponde a cada tipo del contrato.
 *
 * GOBIERNA QUE TECLADO ABRE UN TELEFONO, no ninguna validacion legal: no hay
 * aqui longitudes minimas, formatos de codigo postal ni edades. El backend
 * revalida y es quien decide.
 */
function inputTypeFor(type: NormalizedAmoeField["type"]): string {
  switch (type) {
    case "EMAIL":
      return "email";
    case "TEL":
      return "tel";
    case "DATE":
      return "date";
    default:
      return "text";
  }
}
