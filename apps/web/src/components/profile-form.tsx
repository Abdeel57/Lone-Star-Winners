"use client";

import { Alert, Button, FormField, Input, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { LOCALE_TAGS, type Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { updateProfileAction } from "@/lib/account-actions";
import type { ParticipantProfile } from "@/lib/api";

import { FormError, useFieldError } from "./auth-form-shell";

/**
 * Perfil del participante.
 *
 * EL CORREO SE ENSENA Y NO SE EDITA. Cambiar la direccion de una cuenta es un
 * flujo con verificacion propia y pertenece al diseno de identidad (DEC-006);
 * un campo editable aqui daria a entender que basta con guardar, y dejaria una
 * cuenta apuntando a una direccion que nadie ha confirmado.
 *
 * EL IDIOMA ES UNA PREFERENCIA DE TRATO, NO UNA ELECCION LEGAL. Decide en que
 * idioma se escribe a esta persona. NO decide que version de las Reglas
 * Oficiales gobierna: eso lo declara el propio documento con sus banderas
 * (`is_legally_controlling`), y ninguna preferencia de usuario lo cambia.
 *
 * Las opciones salen de `LOCALE_TAGS` y su nombre visible del diccionario, que
 * es donde vive el nombre de cada idioma para que el test de paridad lo cubra
 * como cualquier otro texto (DEC-021).
 */
export function ProfileForm({
  participant,
  locale,
}: {
  readonly participant: ParticipantProfile;
  readonly locale: Locale;
}) {
  const t = useTranslations("account.profile");
  const tField = useTranslations("auth.fields");
  const tLocale = useTranslations("localeName");
  const [state, formAction, pending] = useActionState(updateProfileAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <form action={formAction} className="flex max-w-[32rem] flex-col gap-s5">
      <input type="hidden" name="locale" value={locale} />

      <FormError result={state} />

      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      {/*
       * El correo va en un `input` deshabilitado y no en un parrafo: se lee
       * igual, conserva su etiqueta asociada y queda claro que ESTE es el campo
       * que no se puede tocar, en vez de parecer que se ha olvidado.
       *
       * Un campo deshabilitado no se envia, que es exactamente lo que se
       * quiere: la accion no manda el correo y el backend no lo lee.
       */}
      <FormField label={t("emailLabel")} description={t("emailNote")}>
        <Input name="email_display" type="email" defaultValue={participant.email} disabled />
      </FormField>

      <FormField
        label={tField("displayName")}
        description={tField("displayNameHint")}
        error={fieldError("display_name")}
      >
        <Input
          name="display_name"
          type="text"
          autoComplete="name"
          defaultValue={participant.display_name ?? ""}
        />
      </FormField>

      <FormField
        label={t("languageLabel")}
        description={t("languageHint")}
        error={fieldError("language_preference")}
      >
        <Select
          name="language_preference"
          defaultValue={participant.language_preference ?? LOCALE_TAGS[0]}
        >
          {LOCALE_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag === "en-US" ? tLocale("en") : tLocale("es")}
            </option>
          ))}
        </Select>
      </FormField>

      <Button type="submit" variant="accent" size="lg" loading={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
