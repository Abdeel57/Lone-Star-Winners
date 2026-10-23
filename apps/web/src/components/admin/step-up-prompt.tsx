"use client";

import { Alert } from "@lsw/ui";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmCodeLink } from "./confirm-code-link";

/**
 * Lo que ve quien opera cuando una accion contesta `STEP_UP_REQUIRED`.
 *
 * NO ES UN ERROR, ES EL SIGUIENTE PASO. Antes se pintaba como un fallo en rojo
 * -"no hemos podido cargar esta seccion", con referencia de soporte- que
 * mandaba a buscar un boton pequeno en la cabecera. Quien anulaba un pedido
 * leia una averia cuando lo unico que faltaba era escribir el codigo de su
 * aplicacion de autenticacion otra vez.
 *
 * Aqui se dice en una linea de donde sale el codigo, y el boton para ir a
 * escribirlo esta en el mismo aviso. `anchor` hace que la vuelta aterrice en la
 * seccion desde la que se pidio, no en lo alto de la pantalla.
 *
 * Tono `warning` y no `danger`: interrumpe (hay algo que hacer antes de seguir)
 * sin decir que algo se ha roto. Sin referencia de peticion: no hay nada que
 * investigar.
 */
export function StepUpPrompt({ anchor }: { readonly anchor?: string }) {
  const t = useTranslations("states.stepUp");
  const locale = useLocale();

  return (
    <Alert tone="warning" title={t("title")}>
      <p>{t("body")}</p>
      <div className="mt-s3">
        <ConfirmCodeLink
          locale={locale}
          label={t("cta")}
          variant="accent"
          size="md"
          {...(anchor === undefined ? {} : { anchor })}
        />
      </div>
    </Alert>
  );
}
