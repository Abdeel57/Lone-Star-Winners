"use client";

import { Alert, Button, Checkbox } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import type { ConsentRequirement, MarketingConsent } from "@/lib/api";
import { setMarketingConsentAction } from "@/lib/marketing-consent-actions";

import { FormError, LocaleField } from "./auth-form-shell";

/**
 * Permiso OPCIONAL de correo promocional (DEC-098).
 *
 * LO QUE ESTA PANTALLA NUNCA HACE
 * -------------------------------
 * - Marcar la casilla por defecto: el permiso tiene que ser un acto de la
 *   persona.
 * - Mezclarla con los documentos obligatorios: aceptar las Reglas, los
 *   Terminos o la Privacidad no es aceptar publicidad, y no hace falta para
 *   comprar ni para participar.
 * - Ofrecerla por su cuenta: solo aparece si `GET /config` la publica, y el
 *   backend no la publica sin el texto aprobado por el abogado.
 *
 * El valor de la casilla es la VERSION del texto que se pinto; con ella la API
 * guarda que texto exacto acepto.
 */

/** La oferta de correo promocional entre las casillas opcionales, si la hay. */
export function marketingOffer(optional: readonly ConsentRequirement[]): ConsentRequirement | null {
  return optional.find((consent) => consent.key === "MARKETING_EMAIL") ?? null;
}

/** Casilla del alta. Solo para un alta con CORREO: con celular no hay a donde escribir. */
export function MarketingOptInField({ offer }: { readonly offer: ConsentRequirement }) {
  const t = useTranslations("marketingConsent");

  return (
    <Checkbox
      name="marketing_email"
      value={offer.version}
      defaultChecked={false}
      label={t("checkbox")}
      description={t("checkboxHint")}
    />
  );
}

/**
 * Tarjeta del perfil: el estado y la accion que corresponde.
 *
 * Con el permiso dado, solo "dejar de recibirlos", que funciona siempre. Sin
 * el, el texto vigente y "Aceptar", solo si la casilla se ofrece. `date` llega
 * ya formateada desde el servidor, en la hora del negocio.
 */
export function MarketingConsentCard({
  locale,
  consent,
  date,
}: {
  readonly locale: Locale;
  readonly consent: MarketingConsent;
  readonly date: string | null;
}) {
  const t = useTranslations("marketingConsent");
  const [state, formAction, pending] = useActionState(setMarketingConsentAction, IDLE);

  const status =
    consent.status === "GRANTED" && date !== null
      ? t("statusGranted", { date })
      : consent.status === "WITHDRAWN" && date !== null
        ? t("statusWithdrawn", { date })
        : t("statusNone");

  return (
    <div className="flex flex-col gap-s4">
      <p className="text-body-sm text-text-muted">{status}</p>

      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}
      <FormError result={state} />

      {consent.status === "GRANTED" ? (
        <form action={formAction}>
          <LocaleField locale={locale} />
          <input type="hidden" name="granted" value="false" />
          <Button type="submit" variant="secondary" loading={pending}>
            {t("withdraw")}
          </Button>
        </form>
      ) : consent.offer === null ? null : (
        <form action={formAction} className="flex flex-col gap-s4">
          <LocaleField locale={locale} />
          <input type="hidden" name="granted" value="true" />
          <input type="hidden" name="text_version" value={consent.offer.text_version} />
          <div>
            <p className="text-body-sm text-text">{t("checkbox")}</p>
            <p className="mt-s2 text-body-sm text-text-muted">{t("checkboxHint")}</p>
          </div>
          <Button type="submit" variant="primary" loading={pending}>
            {t("accept")}
          </Button>
        </form>
      )}
    </div>
  );
}
