"use client";

import { Alert, Button, Checkbox, FormField, Input, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Los tres gestos sobre una version de reglas (§13.7, DEC-054 punto 1).
 *
 * CREAR, DOCUMENTAR Y ACTIVAR, y los tres son deliberadamente distintos:
 *
 * - **Crear** un borrador es barato y reversible: nace `DRAFT`, no cambia nada
 *   y se puede borrar del mapa sin consecuencias. No pide motivo.
 * - **Documentar** escribe el texto legal en un idioma. Solo sobre `DRAFT`.
 * - **Activar** es el gesto que cambia LO QUE VALE UNA COMPRA: archiva la
 *   version anterior y pone esta en su sitio. Motivo, confirmacion y segundo
 *   factor reciente, igual que activar la promocion.
 *
 * Que sean tres formularios y no uno con pestañas es lo que impide que el gesto
 * caro viaje de polizon con uno barato.
 */

/**
 * Alta de un borrador, vacio o clonando otra version.
 *
 * CLONAR ES EL CAMINO NORMAL. Casi ningun cambio legal parte de cero: se toma
 * la version vigente, se cambia una clave y se publica. Un borrador vacio llega
 * con TODAS las claves requeridas en `"TBD"` -lo compone la API- y es el estado
 * honesto para una promocion que empieza.
 */
export function CreateRulesVersionForm({
  locale,
  action,
  promotionId,
  clonable,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  /** Versiones que se pueden clonar, ya etiquetadas. */
  readonly clonable: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.rules");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />

      <p className="text-body-sm text-text-muted">{t("createBody")}</p>

      <FormError result={state} />

      {clonable.length === 0 ? null : (
        <FormField
          label={t("cloneFromLabel")}
          description={t("cloneFromHint")}
          error={fieldError("clone_from_rules_version_id")}
        >
          <Select name="clone_from_rules_version_id" defaultValue="">
            <option value="">{t("cloneFromNone")}</option>
            {clonable.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <FormField
        label={t("attorneyReferenceLabel")}
        description={t("attorneyReferenceHint")}
        error={fieldError("attorney_approval_reference")}
      >
        <Input name="attorney_approval_reference" autoComplete="off" />
      </FormField>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("createCta")}
      </Button>
    </form>
  );
}

/**
 * Documento de las Reglas Oficiales en UN idioma.
 *
 * EL CUERPO SE GUARDA COMO TEXTO PLANO y asi se renderiza en el escaparate: no
 * hay `dangerouslySetInnerHTML` en ninguna parte de esta interfaz, ni aqui ni
 * alli. Los parrafos se separan por lineas en blanco.
 *
 * LAS DOS BANDERAS SON INDEPENDIENTES Y NO SE DEDUCEN LA UNA DE LA OTRA. Puede
 * haber una version con las dos lenguas controlantes, y hoy la real es la
 * contraria: NINGUNA lo es, porque `controlling_language` sigue en `TBD`.
 * Decidirlo desde el formulario seria elegir que idioma manda, que es materia
 * del abogado (CLAUDE.md #2).
 */
export function RulesDocumentForm({
  locale,
  action,
  promotionId,
  rulesVersionId,
  documentLocale,
  title,
  body,
  isLegallyControlling,
  isInformationalTranslation,
  editable,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  readonly rulesVersionId: string;
  /** Etiqueta BCP-47 del documento (`en-US`, `es-US`), no segmento de ruta. */
  readonly documentLocale: string;
  readonly title: string;
  readonly body: string;
  readonly isLegallyControlling: boolean;
  readonly isInformationalTranslation: boolean;
  readonly editable: boolean;
}) {
  const t = useTranslations("admin.rules");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />
      <input type="hidden" name="rules_version_id" value={rulesVersionId} />
      <input type="hidden" name="document_locale" value={documentLocale} />

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("documentSaved")}</Alert> : null}

      <FormField label={t("documentTitleLabel")} required error={fieldError("title")}>
        <Input name="title" defaultValue={title} disabled={!editable} required />
      </FormField>

      <FormField
        label={t("documentBodyLabel")}
        description={t("documentBodyHint")}
        required
        error={fieldError("body")}
      >
        <Textarea name="body" rows={12} defaultValue={body} disabled={!editable} required />
      </FormField>

      <Checkbox
        name="is_legally_controlling"
        defaultChecked={isLegallyControlling}
        disabled={!editable}
        label={t("isLegallyControlling")}
      />

      <Checkbox
        name="is_informational_translation"
        defaultChecked={isInformationalTranslation}
        disabled={!editable}
        label={t("isInformationalTranslation")}
      />

      {!editable ? null : (
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={pending}
          className="w-full sm:w-auto sm:self-start"
        >
          {t("saveDocumentCta")}
        </Button>
      )}
    </form>
  );
}

/**
 * Activacion de una version. Motivo, confirmacion y step-up.
 *
 * LO QUE SE DICE ANTES DEL BOTON, NO DESPUES DEL 409
 * --------------------------------------------------
 * Las claves legales sin resolver y los problemas de validacion se listan
 * ARRIBA, con su identificador tecnico, y el boton se deshabilita. Esperar al
 * 409 para decirlo seria hacer que alguien elija motivo, escriba una nota,
 * marque la casilla y descubra al final que no podia.
 *
 * NO ES EL CONTROL. El cerrojo es el trigger de PostgreSQL de DEC-012, que
 * ademas conoce condiciones que esta pantalla no ve; cuando responde, su
 * mensaje se ensena tal cual porque es el unico que sabe cual salto.
 */
export function ActivateRulesVersionForm({
  locale,
  action,
  promotionId,
  rulesVersionId,
  blockedReason,
  reasons,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  readonly rulesVersionId: string;
  /** Motivo, ya traducido, por el que la pantalla sabe que fallaria. */
  readonly blockedReason?: string;
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = useTranslations("admin.rules");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const [confirmed, setConfirmed] = useState(false);

  const blocked = blockedReason !== undefined;

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />
      <input type="hidden" name="rules_version_id" value={rulesVersionId} />

      <p className="text-body-sm text-text-muted">{t("activateBody")}</p>

      {blocked ? <Alert tone="warning">{blockedReason}</Alert> : null}

      <FormError result={state} />

      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger" title={t("engineSaid")}>
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {state.status === "ok" ? <Alert tone="success">{t("activated")}</Alert> : null}

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
        label={t("confirmActivate")}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        // En positivo: "hay impedimento conocido" o "no ha confirmado". Ninguno
        // de los dos es el control.
        disabled={blocked || !confirmed}
        className="w-full sm:w-auto sm:self-start"
      >
        {t("activateCta")}
      </Button>
    </form>
  );
}
