"use client";

import { Alert, Button } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Publicar o retirar un producto de la tienda.
 *
 * ES UN BOTON Y NO UNA CASILLA DEL FORMULARIO DE EDICION, a proposito.
 * Publicar exige `product.publish`, una capacidad distinta de `product.write`,
 * y el autorizador decide por (metodo, camino) antes de leer nada. Si el estado
 * viajara dentro de la edicion, quien guarda un nombre estaria tambien
 * publicando -o creyendo que publica- con la capacidad equivocada.
 *
 * `published` viaja como "true"/"false" y la accion lo lee comparando con la
 * cadena, no con `Boolean()`: `Boolean("false")` es `true`.
 */
export function ProductPublishForm({
  locale,
  action,
  productId,
  publish,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly productId: string;
  /** `true` = publicar; `false` = retirar de la tienda. */
  readonly publish: boolean;
}) {
  const t = useTranslations("admin.catalog");
  const [state, formAction, pending] = useActionState(action, IDLE);

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="published" value={publish ? "true" : "false"} />

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("publishChanged")}</Alert> : null}

      <Button
        type="submit"
        variant={publish ? "primary" : "secondary"}
        size="md"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {publish ? t("publishCta") : t("unpublishCta")}
      </Button>
    </form>
  );
}
