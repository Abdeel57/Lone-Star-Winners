import { Countdown } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";

/**
 * Cuenta atras de una promocion.
 *
 * Es la capa que convierte datos del contrato en algo que la primitiva pueda
 * pintar: etiquetas traducidas, y el plazo ABSOLUTO ya formateado en la zona
 * horaria legal que declara la promocion (DEC-011), nunca en la del navegador.
 *
 * `nowIso` llega desde arriba y no se genera aqui. Es lo que hace que el primer
 * render del servidor y el del cliente coincidan; si el componente mirase el
 * reloj por su cuenta, React lanzaria un error de hidratacion en cuanto pasara
 * un segundo entre una cosa y la otra.
 *
 * La cuenta atras NO decide nada. El estado de la promocion lo manda el
 * backend, y este componente solo aparece cuando la maquina de estados dice que
 * procede (ver `src/lib/promotion-state.ts`).
 */
export function PromotionCountdown({
  targetIso,
  nowIso,
  locale,
  timeZone,
  variant,
  size = "inline",
}: {
  readonly targetIso: string;
  readonly nowIso: string;
  readonly locale: Locale;
  readonly timeZone: string;
  /** Si la cuenta atras apunta a la apertura o al cierre. */
  readonly variant: "opens" | "closes";
  /**
   * `scoreboard` es el tratamiento del hero (DEC-038): cuatro casillas grandes
   * con digitos de marcador. `inline` es el discreto, para el detalle de
   * promocion, donde la cuenta atras acompana pero no manda.
   */
  readonly size?: "inline" | "scoreboard";
}) {
  const t = useTranslations("countdown");
  const tA11y = useTranslations("a11y");

  const absolute = formatZonedDateTime(targetIso, locale, {
    timeZone,
    showTimeZoneName: true,
  });

  // Sin fecha legible no hay nada honesto que anunciar a un lector de pantalla,
  // asi que tampoco se pinta la cuenta atras. Es preferible a un contador cuyo
  // unico equivalente accesible seria "Invalid Date".
  if (absolute === null) return null;

  const scoreboard = size === "scoreboard";

  return (
    <div className="flex flex-col gap-s3">
      <p
        className={
          scoreboard
            ? "font-display text-overline uppercase tracking-wide text-brand"
            : "text-label font-medium text-text-muted"
        }
      >
        {variant === "opens" ? t("opensIn") : t("closesIn")}
      </p>

      <Countdown
        targetIso={targetIso}
        nowIso={nowIso}
        unitLabels={{
          days: t("days"),
          hours: t("hours"),
          minutes: t("minutes"),
          seconds: t("seconds"),
        }}
        deadlineLabel={`${tA11y("promotionCountdown")}: ${absolute}`}
        completedLabel={t("elapsed")}
        size={size}
      />

      {/* Se conserva palabra por palabra: la cuenta atras es una comodidad y el
          estado que manda es el que reporta el servidor. Que ahora sea
          espectacular no la convierte en fuente de verdad. */}
      <p className="text-caption text-text-subtle">{t("clockNote")}</p>
    </div>
  );
}
