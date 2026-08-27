import { Button, Card, CardTitle, FormField, Input } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { adminHref } from "@/i18n/admin-routing";
import type { Locale } from "@/i18n/locales";

/**
 * Primer paso de un ajuste manual: quien, en que promocion y cuanto.
 *
 * ES UN `<form method="get">` Y ESO ES LO IMPORTANTE
 * -------------------------------------------------
 * Este paso NO muta nada: lleva los tres datos a la URL para que el servidor
 * pueda pedir al backend la previsualizacion -antes, cambio, despues- y
 * ensenarla antes de que nadie confirme. Un `POST` aqui sugeriria que el ajuste
 * ya se ha propuesto, y ademas impediria compartir el enlace de una
 * previsualizacion con quien tiene que aprobarla.
 *
 * La mutacion es el SEGUNDO paso, y va por Server Action.
 *
 * NO HAY BUSCADOR DE PARTICIPANTE, y es una carencia consciente y anotada: el
 * contrato no publica busqueda en `/admin/participants`, asi que el
 * identificador se pega desde la pantalla de participantes. Inventar aqui un
 * endpoint de busqueda seria crear una API alternativa para no coordinarse, que
 * es lo que prohibe `CLAUDE.md` seccion 4.
 *
 * SIN VALIDACION DE NEGOCIO. El campo del delta acepta un entero con signo -que
 * es la forma del dato, DEC-010- y nada mas. Ni tope, ni minimo, ni "no puede
 * dejar el saldo negativo": eso lo decide el motor, y una regla escrita aqui
 * rechazaria ajustes que el backend acepta.
 */
export async function AdjustmentDraftForm({
  locale,
  defaultPromotionId,
}: {
  readonly locale: Locale;
  readonly defaultPromotionId: string | null;
}) {
  const t = await getTranslations({ locale, namespace: "admin.adjustments" });

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("newTitle")}
      </CardTitle>

      <p className="mt-s2 text-body-sm text-text-muted">{t("newBody")}</p>

      <form
        method="get"
        action={adminHref(locale, "/adjustments")}
        className="mt-s5 flex flex-col gap-s4"
      >
        <FormField label={t("participantIdLabel")} description={t("participantIdHint")} required>
          <Input name="participant_id" autoComplete="off" spellCheck={false} required />
        </FormField>

        <FormField label={t("promotionIdLabel")} required>
          <Input
            name="promotion_id"
            autoComplete="off"
            spellCheck={false}
            required
            {...(defaultPromotionId === null ? {} : { defaultValue: defaultPromotionId })}
          />
        </FormField>

        <FormField label={t("deltaLabel")} description={t("deltaHint")} required>
          {/*
           * `inputMode="numeric"` y no `type="number"`: el control numerico del
           * navegador incrementa con la rueda del raton, y una rueda sobre un
           * campo con foco cambiando el numero de participaciones de alguien es
           * exactamente el accidente que esta pantalla existe para evitar.
           *
           * `pattern` acepta signo y digitos, que es la FORMA del dato
           * (DEC-010), no una regla de negocio.
           */}
          <Input
            name="quantity_delta"
            inputMode="numeric"
            pattern="-?[0-9]+"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </FormField>

        <Button type="submit" variant="secondary" size="md">
          {t("previewSubmit")}
        </Button>
      </form>
    </Card>
  );
}
