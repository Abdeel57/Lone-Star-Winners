"use client";

import { Button } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";

import type { Locale } from "@/i18n/locales";
import { useRouter } from "@/i18n/navigation";
import { IDLE } from "@/lib/action-result";
import type { ConsentRequirement } from "@/lib/api";
import { declareEligibilityAction } from "@/lib/eligibility-actions";

import { FormError, LocaleField } from "./auth-form-shell";
import { ConsentFieldset, EligibilityFields } from "./eligibility-fields";

/**
 * Declaracion de una cuenta anterior a DEC-067, en el checkout.
 *
 * Solo se pinta cuando la promocion comprueba edad o estado y la cuenta no ha
 * declarado: sin la declaracion el backend no otorga participaciones, y cobrar
 * sin avisar seria dejar a alguien esperando unas participaciones que no van a
 * llegar. Al guardarla se recarga la pagina y aparece el formulario de pago.
 */
export function EligibilityDeclarationForm({
  locale,
  consents,
}: {
  readonly locale: Locale;
  readonly consents: readonly ConsentRequirement[];
}) {
  const t = useTranslations("eligibility");
  const router = useRouter();
  const [state, formAction, pending] = useActionState(declareEligibilityAction, IDLE);

  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <p className="text-body text-text-muted">{t("body")}</p>

      <FormError result={state} />

      <EligibilityFields result={state} />
      <ConsentFieldset result={state} consents={consents} />

      <Button type="submit" variant="accent" size="lg" fullWidth loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
