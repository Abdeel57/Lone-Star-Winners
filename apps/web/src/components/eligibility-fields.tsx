"use client";

import { Checkbox, FormField, Input, Select } from "@lsw/ui";
import { useLocale, useTranslations } from "next-intl";

import { useConsentText } from "@/i18n/account-labels";
import { Link } from "@/i18n/navigation";
import { LEGAL_ROUTES } from "@/legal/links";
import { US_RESIDENCE_CODES } from "@/legal/us-states";
import type { ActionResult } from "@/lib/action-result";
import type { ConsentRequirement } from "@/lib/api";

import { useFieldError } from "./auth-form-shell";

/**
 * Fecha de nacimiento y estado de residencia (DEC-067).
 *
 * Se PREGUNTAN aqui y no se juzgan aqui: si con esa edad y ese estado se
 * participa lo dicen las Official Rules de cada edicion, y lo evalua el backend
 * al otorgar. Este componente no sabe que estados estan excluidos ni que edad
 * hace falta, y no debe saberlo.
 */
export function EligibilityFields({ result }: { readonly result: ActionResult }) {
  const t = useTranslations("auth.fields");
  const tStates = useTranslations("usStates");
  const locale = useLocale();
  const fieldError = useFieldError(result);

  const states = US_RESIDENCE_CODES.map((code) => ({ code, name: tStates(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );

  return (
    <>
      <FormField
        label={t("dateOfBirth")}
        description={t("dateOfBirthHint")}
        required
        requiredHint={t("requiredHint")}
        error={fieldError("date_of_birth")}
      >
        <Input name="date_of_birth" type="date" autoComplete="bday" required />
      </FormField>

      <FormField
        label={t("residenceState")}
        required
        requiredHint={t("requiredHint")}
        error={fieldError("residence_state")}
      >
        <Select name="residence_state" required defaultValue="" autoComplete="address-level1">
          <option value="" disabled>
            {t("residenceStatePlaceholder")}
          </option>
          {states.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </Select>
      </FormField>
    </>
  );
}

/**
 * Las casillas de los documentos que publica `GET /config` (`required_consents`)
 * y los enlaces para leerlos ANTES de marcarlos.
 *
 * Tres campos por consentimiento, y los tres hacen falta:
 *
 * - `consent` lleva clave y version, y es lo que la accion recorre. Va como
 *   campo oculto porque tiene que llegar tanto si se marca la casilla como si
 *   no: sin el, un consentimiento obligatorio SIN marcar seria indistinguible de
 *   uno que no existe, y el formulario se enviaria.
 * - `consent_required:<clave>` dice si es obligatorio, para que la accion no
 *   tenga que saberlo de antemano.
 * - `consent_accepted:<clave>` es la casilla.
 */
export function ConsentFieldset({
  result,
  consents,
}: {
  readonly result: ActionResult;
  readonly consents: readonly ConsentRequirement[];
}) {
  const t = useTranslations("auth");
  const tLegal = useTranslations("legal.links");
  const consentText = useConsentText();
  const fieldError = useFieldError(result);

  if (consents.length === 0) return null;

  const documents = [
    { href: "/official-rules", label: t("consent.officialRulesLink") },
    { href: LEGAL_ROUTES.terms, label: tLegal("terms") },
    { href: LEGAL_ROUTES.privacy, label: tLegal("privacy") },
    { href: LEGAL_ROUTES.californiaNotice, label: tLegal("californiaNotice") },
  ];

  return (
    <fieldset className="flex flex-col gap-s3 border-0 p-0">
      <legend className="text-label font-medium text-text">{t("consent.heading")}</legend>

      <p className="text-body-sm text-text-muted">
        {t("consent.readDocuments")}{" "}
        {documents.map((document, index) => (
          <span key={document.href}>
            {index === 0 ? null : " · "}
            <Link
              href={document.href}
              target="_blank"
              className="text-brand underline underline-offset-4 hover:text-text"
            >
              {document.label}
            </Link>
          </span>
        ))}
      </p>

      {consents.map((consent) => (
        <div key={consent.key}>
          <input type="hidden" name="consent" value={`${consent.key}:${consent.version}`} />
          <input
            type="hidden"
            name={`consent_required:${consent.key}`}
            value={String(consent.required)}
          />

          <Checkbox
            name={`consent_accepted:${consent.key}`}
            label={consentText(consent.text_key)}
            description={t("consent.versionLabel", { version: consent.version })}
            {...(consent.required && fieldError("consent") !== undefined
              ? { error: fieldError("consent") }
              : {})}
          />
        </div>
      ))}
    </fieldset>
  );
}
