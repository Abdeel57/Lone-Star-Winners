import { useTranslations } from "next-intl";

import { formatPercent } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";

/**
 * Barra de progreso del periodo de una promocion.
 *
 * LO QUE ESTA BARRA ES, Y LO QUE NO
 * ---------------------------------
 * Es el tramo TRANSCURRIDO entre `starts_at` y `ends_at`, dos instantes que
 * declara la promocion. Es la misma informacion que ya dan las dos fechas
 * escritas al lado, vista de un golpe.
 *
 * NO es un recurso de urgencia. No acelera, no cambia de color al acercarse al
 * final, no lleva ningun texto del tipo "ultima semana" y no aparece sobre una
 * promocion que no admite participaciones. La referencia visual pinta la suya en
 * ROJO por ese motivo exacto; aqui va en oro, que es el color con el que este
 * sistema dice "esto es de la marca", no "corre".
 *
 * NO DECIDE NADA. Que la barra llegue al final no cierra la promocion, igual
 * que no lo hace la cuenta atras: el estado lo manda el backend (DEC-011,
 * CLAUDE.md #15). El instante de referencia llega desde el servidor y no se lee
 * el reloj del navegador en ningun momento, ni siquiera para pintar.
 */
export function PromotionProgress({
  startIso,
  endIso,
  nowIso,
  locale,
}: {
  readonly startIso: string;
  readonly endIso: string;
  /** Instante de referencia del render, generado en el servidor. */
  readonly nowIso: string;
  readonly locale: Locale;
}) {
  const t = useTranslations("promotionProgress");
  const fraction = elapsedFraction(startIso, endIso, nowIso);

  // Sin un tramo que representar no se pinta una barra vacia: seria una
  // afirmacion ("no ha transcurrido nada") en vez de una ausencia de dato.
  if (fraction === null) return null;

  const percentOfHundred = Math.round(fraction * 100);

  return (
    <div
      role="progressbar"
      aria-label={t("label")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentOfHundred}
      // El equivalente hablado es una frase completa, no un numero suelto: un
      // "47" sin contexto no dice de que.
      aria-valuetext={t("value", { percent: formatPercent(fraction, locale) })}
      className="h-2 w-full max-w-lg overflow-hidden rounded-sm border border-brand/30 bg-surface-sunken"
    >
      {/* El relleno es decoracion: el valor lo declara el contenedor. */}
      <div
        aria-hidden="true"
        className="lsw-stripes h-full"
        style={{ width: `${String(percentOfHundred)}%` }}
      />
    </div>
  );
}

/**
 * Fraccion transcurrida del periodo, entre 0 y 1.
 *
 * Pura y exportada para poder probarla sin renderizar ni manipular relojes: la
 * aritmetica de tiempo es donde se cuelan los errores de un dia.
 *
 * Devuelve `null` -y no 0- cuando no hay nada honesto que dibujar: fechas
 * invalidas, o un periodo de duracion cero o negativa, que seria un dato
 * defectuoso del backend y no un periodo que acaba de empezar.
 *
 * El resultado se ACOTA a [0, 1]. Un `nowIso` anterior a la apertura o
 * posterior al cierre es perfectamente posible -una promocion programada, una
 * cerrada- y en ninguno de los dos casos tiene sentido una barra vacia al -12%
 * o desbordada al 130%.
 */
export function elapsedFraction(startIso: string, endIso: string, nowIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = new Date(nowIso).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now)) return null;
  if (end <= start) return null;

  const fraction = (now - start) / (end - start);
  return Math.min(1, Math.max(0, fraction));
}
