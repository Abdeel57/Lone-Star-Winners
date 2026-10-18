"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import type { ConsentRequirement } from "@/lib/api";
import {
  completeSignupAction,
  sendSignInCodeAction,
  verifySignInCodeAction,
} from "@/lib/auth-actions";

import { FormError, LocaleField, useFieldError } from "./auth-form-shell";
import { ConsentAgreement, ResidenceStateField } from "./eligibility-fields";
import { TurnstileWidget } from "./turnstile-widget";

/**
 * Entrar o crear la cuenta con un codigo, sin contrasena (DEC-089).
 *
 * UNA PANTALLA PARA LAS DOS COSAS
 * -------------------------------
 * Nadie tiene que decidir si ya tiene cuenta: escribe su correo o su celular,
 * recibe un codigo y lo teclea. Si la cuenta existia, entra. Si no, el mismo
 * flujo le pide nombre y estado y la crea. Que la cuenta exista solo se sabe
 * despues de acertar el codigo, asi que la pantalla no revela a nadie si un
 * correo esta registrado.
 *
 * TRES PASOS, EL TERCERO SOLO LA PRIMERA VEZ
 * ------------------------------------------
 * 1. Correo o celular, con la comprobacion anti-bots: cada envio cuesta.
 * 2. El codigo. `one-time-code` deja que el telefono lo rellene desde el SMS.
 * 3. Nombre, estado y UNA casilla para los documentos (DEC-067). La fecha de
 *    nacimiento no se pregunta aqui: la pide el checkout si la puerta de edad
 *    esta encendida.
 *
 * El contacto vive en el estado del cliente para sobrevivir al cambio de paso,
 * como el celular de DEC-060; no es un secreto. La prueba de que se acerto el
 * codigo NO esta aqui: es una cookie `httpOnly` que solo leen las acciones.
 */
export function SignInFlow({
  locale,
  consents,
  returnPath,
}: {
  readonly locale: Locale;
  readonly consents: readonly ConsentRequirement[];
  readonly returnPath: string | null;
}) {
  const [contact, setContact] = useState("");
  const [step, setStep] = useState<"contact" | "code" | "profile">("contact");

  // Estables a proposito: los pasos los usan en efectos, y una funcion nueva en
  // cada render volveria a ejecutarlos -y a reiniciar el anti-bots- con cada
  // tecla.
  const restart = useCallback(() => {
    setStep("contact");
  }, []);
  const toCode = useCallback(() => {
    setStep("code");
  }, []);
  const toProfile = useCallback(() => {
    setStep("profile");
  }, []);

  if (step === "contact") {
    return (
      <ContactStep locale={locale} contact={contact} onContactChange={setContact} onSent={toCode} />
    );
  }

  if (step === "code") {
    return (
      <CodeStep
        locale={locale}
        contact={contact}
        returnPath={returnPath}
        onProfileRequired={toProfile}
        onChangeContact={restart}
      />
    );
  }

  return (
    <ProfileStep locale={locale} consents={consents} returnPath={returnPath} onRestart={restart} />
  );
}

function ReturnPathField({ returnPath }: { readonly returnPath: string | null }) {
  return returnPath === null ? null : <input type="hidden" name="next" value={returnPath} />;
}

/** Paso 1: correo o celular en un solo campo. */
function ContactStep({
  locale,
  contact,
  onContactChange,
  onSent,
}: {
  readonly locale: Locale;
  readonly contact: string;
  readonly onContactChange: (next: string) => void;
  readonly onSent: () => void;
}) {
  const t = useTranslations("auth.code");
  const tFields = useTranslations("auth.fields");
  const [state, formAction, pending] = useActionState(sendSignInCodeAction, IDLE);
  const [resetSignal, setResetSignal] = useState(0);
  const fieldError = useFieldError(state);

  useEffect(() => {
    if (state.status === "idle") return;
    // El token anti-bots sirve una sola vez: se renueva tras cada envio.
    setResetSignal((current) => current + 1);
    if (state.status === "ok") onSent();
  }, [state, onSent]);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />

      <FormError result={state} />

      <FormField
        label={tFields("identifier")}
        description={t("contactHint")}
        required
        requiredHint={tFields("requiredHint")}
        error={fieldError("contact")}
      >
        {/*
         * `type="text"` y no `email`: el navegador rechazaria un celular. Y
         * `autoComplete="email"`: la mayoria entra con su correo y el telefono
         * lo ofrece guardado; quien usa el celular lo teclea igual.
         */}
        <Input
          name="contact"
          type="text"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={contact}
          onChange={(event) => {
            onContactChange(event.target.value);
          }}
        />
      </FormField>

      <p className="text-body-sm text-text-muted">{t("smsDisclosure")}</p>

      <TurnstileWidget locale={locale} resetSignal={resetSignal} />

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("send")}
      </Button>
    </form>
  );
}

/** Paso 2: el codigo, y la forma de pedir otro o cambiar de contacto. */
function CodeStep({
  locale,
  contact,
  returnPath,
  onProfileRequired,
  onChangeContact,
}: {
  readonly locale: Locale;
  readonly contact: string;
  readonly returnPath: string | null;
  readonly onProfileRequired: () => void;
  readonly onChangeContact: () => void;
}) {
  const t = useTranslations("auth.code");
  const tFields = useTranslations("auth.fields");
  const [verifyState, verifyAction, verifying] = useActionState(verifySignInCodeAction, IDLE);
  const [resendState, resendAction, resending] = useActionState(sendSignInCodeAction, IDLE);
  const [resetSignal, setResetSignal] = useState(0);
  const fieldError = useFieldError(verifyState);

  // La arroba decide por donde salio, igual que en la API.
  const byEmail = contact.includes("@");

  useEffect(() => {
    // Un `ok` aqui solo puede ser "falta el alta": si la cuenta existia, la
    // accion ya ha redirigido.
    if (verifyState.status === "ok") onProfileRequired();
  }, [verifyState, onProfileRequired]);

  useEffect(() => {
    if (resendState.status === "idle") return;
    setResetSignal((current) => current + 1);
  }, [resendState]);

  return (
    <div className="flex flex-col gap-s5">
      <Alert tone="success" title={byEmail ? t("sentEmailTitle") : t("sentSmsTitle")}>
        {byEmail ? t("sentEmailBody", { contact }) : t("sentSmsBody", { contact })}
      </Alert>

      <form action={verifyAction} className="flex flex-col gap-s5">
        <LocaleField locale={locale} />
        <input type="hidden" name="contact" value={contact} />
        <ReturnPathField returnPath={returnPath} />

        <FormError result={verifyState} />

        <FormField
          label={t("codeLabel")}
          description={t("codeHint")}
          required
          requiredHint={tFields("requiredHint")}
          error={fieldError("code")}
        >
          {/* Sin `maxLength` ni `pattern`: la longitud la decide el backend. */}
          <Input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" />
        </FormField>

        <Button type="submit" variant="accent" size="lg" fullWidth loading={verifying}>
          {t("verify")}
        </Button>
      </form>

      <form action={resendAction} className="flex flex-col gap-s3">
        <LocaleField locale={locale} />
        <input type="hidden" name="contact" value={contact} />

        {resendState.status === "ok" ? (
          <p role="status" className="text-body-sm text-text-muted">
            {t("resent")}
          </p>
        ) : null}
        <FormError result={resendState} />

        <TurnstileWidget locale={locale} resetSignal={resetSignal} />

        <Button type="submit" variant="secondary" fullWidth loading={resending}>
          {t("resend")}
        </Button>
      </form>

      <Button type="button" variant="ghost" fullWidth onClick={onChangeContact}>
        {t("changeContact")}
      </Button>
    </div>
  );
}

/** Paso 3, solo para un contacto sin cuenta: nombre, estado y documentos. */
function ProfileStep({
  locale,
  consents,
  returnPath,
  onRestart,
}: {
  readonly locale: Locale;
  readonly consents: readonly ConsentRequirement[];
  readonly returnPath: string | null;
  readonly onRestart: () => void;
}) {
  const t = useTranslations("auth.code");
  const tFields = useTranslations("auth.fields");
  const [state, formAction, pending] = useActionState(completeSignupAction, IDLE);
  const fieldError = useFieldError(state);

  return (
    <div className="flex flex-col gap-s5">
      <div>
        <h2 className="text-heading-sm font-semibold text-text">{t("profileTitle")}</h2>
        <p className="mt-s2 text-body-sm text-text-muted">{t("profileIntro")}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-s5">
        <LocaleField locale={locale} />
        <ReturnPathField returnPath={returnPath} />

        <FormError result={state} />

        <FormField
          label={tFields("displayName")}
          description={t("nameHint")}
          required
          requiredHint={tFields("requiredHint")}
          error={fieldError("display_name")}
        >
          <Input name="display_name" type="text" autoComplete="name" required />
        </FormField>

        <ResidenceStateField result={state} />

        <ConsentAgreement result={state} consents={consents} />

        <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
          {t("create")}
        </Button>
      </form>

      {/* Si el permiso de alta caduco, el unico camino es empezar de nuevo. */}
      <Button type="button" variant="ghost" fullWidth onClick={onRestart}>
        {t("changeContact")}
      </Button>
    </div>
  );
}
