"use client";

import { Alert, Button, FormField, Input, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { useAmoeFieldLabel } from "@/i18n/amoe-labels";
import { IDLE } from "@/lib/action-result";
import { submitAmoeAction } from "@/lib/amoe-actions";
import type { NormalizedAmoeField } from "@/lib/amoe-config";

/**
 * Formulario de participacion gratuita.
 *
 * NO DECIDE NI UN CAMPO. Pinta EXACTAMENTE los que llegan en `required_fields`,
 * en el orden en que llegan, y ni uno mas. Que datos se piden para participar
 * sin comprar es materia de las Official Rules (CLAUDE.md #1 y #2): un campo de
 * mas seria recogida de datos personales que nadie autorizo.
 *
 * LAS ETIQUETAS SON CLAVES DE COPY DEL FRONTEND (DEC-022), igual que en los
 * consentimientos del alta, y llegan SIN NAMESPACE (`fullName`, `postalCode`).
 * El valor por defecto de `label_key` en el backend es la propia clave del
 * payload, asi que una promocion sin descriptor de presentacion manda claves
 * que la interfaz no conoce: en ese caso el campo se pinta con una etiqueta
 * generica -nunca con la clave en crudo- y SE SIGUE ENVIANDO, porque perder el
 * campo seria peor que etiquetarlo mal.
 *
 * SIN VALIDACION PROPIA. `maxLength` se traslada solo si el backend declara uno
 * utilizable, y no hay `pattern`, ni longitud minima, ni comprobacion de formato
 * mas alla de la que el navegador hace por el tipo de campo. Una restriccion del
 * cliente que no coincida exactamente con la del backend rechaza envios validos,
 * y en la unica via que no exige comprar nada eso es especialmente caro.
 *
 * EL ENVIO NO SE PUEDE REPETIR POR ACCIDENTE: mientras la accion esta en curso
 * el boton queda deshabilitado. No es el control -el backend responde
 * `AMOE_DUPLICATE_SUBMISSION`- pero evita el doble clic, que es de donde salen
 * casi todos los duplicados.
 */
export function AmoeForm({
  locale,
  promotionSlug,
  promotionId,
  fields,
}: {
  readonly locale: Locale;
  readonly promotionSlug: string;
  readonly promotionId: string;
  readonly fields: readonly NormalizedAmoeField[];
}) {
  const t = useTranslations("amoe.form");
  const fieldLabel = useAmoeFieldLabel();
  const [state, formAction, pending] = useActionState(submitAmoeAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_slug" value={promotionSlug} />
      <input type="hidden" name="promotion_id" value={promotionId} />

      <FormError result={state} />

      {state.status === "ok" ? <Alert tone="success">{t("submitted")}</Alert> : null}

      {fields.map((field) => (
        <FormField
          key={field.key}
          label={fieldLabel(field.labelKey)}
          required={field.required}
          error={fieldError(field.key)}
        >
          {field.type === "TEXTAREA" ? (
            <Textarea
              name={field.key}
              rows={4}
              {...(field.maxLength === null ? {} : { maxLength: field.maxLength })}
            />
          ) : (
            <Input
              name={field.key}
              type={inputTypeFor(field.type)}
              {...(field.type === "EMAIL" ? { inputMode: "email" as const } : {})}
              {...(field.type === "TEL" ? { inputMode: "tel" as const } : {})}
              {...(field.type === "CODE" ? { autoCapitalize: "characters" as const } : {})}
              autoComplete="off"
              spellCheck={false}
              {...(field.maxLength === null ? {} : { maxLength: field.maxLength })}
            />
          )}
        </FormField>
      ))}

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("submit")}
      </Button>

      <p className="text-caption text-text-subtle">{t("rulesNote")}</p>
    </form>
  );
}

/**
 * Tipo de `input` para cada clase de campo.
 *
 * `DATE` usa el selector nativo y `EMAIL`/`TEL` cambian el teclado del telefono.
 * `CODE` es `text` a proposito: `type="number"` incrementaria con la rueda del
 * raton y admitiria notacion cientifica, y un codigo no es una cifra.
 */
function inputTypeFor(type: NormalizedAmoeField["type"]): string {
  switch (type) {
    case "EMAIL":
      return "email";
    case "TEL":
      return "tel";
    case "DATE":
      return "date";
    case "TEXT":
    case "CODE":
    case "TEXTAREA":
      return "text";
  }
}
