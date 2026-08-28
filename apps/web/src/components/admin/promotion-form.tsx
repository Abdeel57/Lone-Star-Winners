"use client";

import { Alert, Button, FormField, Input, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import { OFFERED_TIME_ZONES } from "@/lib/admin/catalog-input";

/**
 * Alta y edicion de una promocion.
 *
 * LA ZONA HORARIA LEGAL SE ELIGE UNA VEZ Y NO SE EDITA (DEC-011). Al crear es
 * un desplegable SIN valor por defecto -hay que elegirla-; al editar se muestra
 * como dato. Todos los plazos se cuentan en esa zona, y cambiarla despues
 * moveria retroactivamente el momento en que la promocion abrio o cerro.
 *
 * LAS FECHAS SON HORA DE PARED EN ESA ZONA, no en la del navegador. El campo
 * `datetime-local` no lleva zona a proposito; la accion resuelve el instante
 * UTC contra la zona legal en el servidor. Debajo del campo se dice en que
 * zona se esta escribiendo, porque un "00:00" sin zona es una trampa.
 *
 * Direccion y nombre interno: la direccion no se edita (esta en enlaces); el
 * nombre interno si.
 */
export function PromotionForm({
  locale,
  action,
  promotion,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** `undefined` al crear. Al editar, los valores actuales. */
  readonly promotion?: {
    readonly id: string;
    readonly slug: string;
    readonly internalName: string;
    readonly legalTimezone: string;
    readonly publicName: { readonly "es-US": string; readonly "en-US": string };
    /** Ya convertidos a hora de pared de la zona legal, o `null`. */
    readonly startsAtWall: string | null;
    readonly endsAtWall: string | null;
  };
}) {
  const t = useTranslations("admin.promotions");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const editing = promotion !== undefined;

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {editing ? <input type="hidden" name="promotion_id" value={promotion.id} /> : null}

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        {editing ? null : (
          <FormField
            label={t("fieldSlug")}
            description={t("fieldSlugHint")}
            required
            error={fieldError("slug")}
          >
            <Input
              name="slug"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </FormField>
        )}

        <FormField
          label={t("fieldInternalName")}
          description={t("fieldInternalNameHint")}
          required
          error={fieldError("internal_name")}
        >
          <Input
            name="internal_name"
            autoComplete="off"
            required
            {...(editing ? { defaultValue: promotion.internalName } : {})}
          />
        </FormField>
      </div>

      <p className="text-caption text-text-subtle">{t("bothLanguages")}</p>

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <FormField label={t("fieldPublicNameEs")} required error={fieldError("public_name_es")}>
          <Input
            name="public_name_es"
            lang="es"
            required
            {...(editing ? { defaultValue: promotion.publicName["es-US"] } : {})}
          />
        </FormField>

        <FormField label={t("fieldPublicNameEn")} required error={fieldError("public_name_en")}>
          <Input
            name="public_name_en"
            lang="en"
            required
            {...(editing ? { defaultValue: promotion.publicName["en-US"] } : {})}
          />
        </FormField>
      </div>

      {editing ? (
        <input type="hidden" name="legal_timezone" value={promotion.legalTimezone} />
      ) : (
        <FormField
          label={t("fieldTimezone")}
          description={t("fieldTimezoneHint")}
          required
          error={fieldError("legal_timezone")}
        >
          {/*
           * Sin `defaultValue`: la primera opcion esta vacia y `required` impide
           * enviar sin elegir. Un valor por defecto -aunque fuera el correcto-
           * convertiria una decision legal en un descuido (DEC-011).
           */}
          <Select name="legal_timezone" required defaultValue="">
            <option value="" disabled>
              {t("timezonePlaceholder")}
            </option>
            {OFFERED_TIME_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <FormField
          label={t("fieldStartsAt")}
          description={
            editing ? t("windowHint", { timezone: promotion.legalTimezone }) : t("windowHintCreate")
          }
          error={fieldError("starts_at")}
        >
          <Input
            name="starts_at"
            type="datetime-local"
            {...(editing && promotion.startsAtWall !== null
              ? { defaultValue: promotion.startsAtWall }
              : {})}
          />
        </FormField>

        <FormField
          label={t("fieldEndsAt")}
          description={
            editing ? t("windowHint", { timezone: promotion.legalTimezone }) : t("windowHintCreate")
          }
          error={fieldError("ends_at")}
        >
          <Input
            name="ends_at"
            type="datetime-local"
            {...(editing && promotion.endsAtWall !== null
              ? { defaultValue: promotion.endsAtWall }
              : {})}
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
        {editing ? t("saveSubmit") : t("createSubmit")}
      </Button>
    </form>
  );
}
