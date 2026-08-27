import { useTranslations } from "next-intl";

import { formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";

/**
 * Cabecera del carrito: cuanta mercancia hay y cuando cambio por ultima vez.
 *
 * LOS DOS DATOS LOS PUBLICA EL BACKEND (HO-017)
 * ---------------------------------------------
 * `item_count` y `updated_at` llegan en la MISMA respuesta que las lineas y
 * aqui solo se pintan.
 *
 * `item_count` NO SE CUENTA EN EL CLIENTE, aunque `lines` este delante y la
 * suma parezca trivial. El contrato dice que es la suma de `quantity`, no el
 * numero de lineas, y quien la reimplemente aqui tiene que acertar esa
 * distincion hoy y volver a acertarla el dia que el backend pagine las lineas,
 * cuando la pagina tendria una parte del carrito y la cifra correcta seguiria
 * siendo la del servidor. Es mercancia, no participaciones -no entra en ninguna
 * aritmetica de entries-, pero la razon para no recalcularla es la misma: hay
 * una sola fuente de verdad.
 *
 * `UPDATED_AT` A `NULL` ES AUSENCIA, NO UNA FECHA
 * -----------------------------------------------
 * Vale `null` cuando no existe fila de carrito. Ahi no se pinta la linea: no
 * hay nada que fechar. Lo que NO se hace es pasarlo por `new Date()`, que
 * devolveria el 1 de enero de 1970 -una fecha perfectamente valida para `Date`
 * y que `Number.isNaN` no detecta- y anunciaria que el carrito se actualizo
 * hace medio siglo. La comprobacion vive en `formatZonedDateTime`, que devuelve
 * `null` ante un valor que no es una fecha, y esta rama la respeta.
 *
 * NO SE COMPARA CON LA COTIZACION, Y ES DELIBERADO
 * ------------------------------------------------
 * `updated_at` existe -lo pidio `frontend` en HO-017- para poder detectar una
 * cotizacion caducada comparandolo con `entry_quote.evaluated_at`. Ese aviso
 * NO se pinta, y la razon no ha cambiado desde que se retiro: la cotizacion
 * viaja DENTRO de la misma respuesta de `GET /cart`, calculada por el backend
 * sobre ese mismo carrito, asi que las dos cosas que la pantalla ensena salen
 * de la misma lectura y no hay carrera que avisar. Un aviso que no puede
 * dispararse aparenta una vigilancia que no existe. El dato se publica y quien
 * lo mira saca su propia conclusion.
 *
 * LA ZONA HORARIA SE EXIGE (DEC-011)
 * ----------------------------------
 * Sin `timeZone` obligatorio, `Intl` caeria en la zona de QUIEN RENDERIZA, que
 * en un componente de servidor es la del servidor. La pagina pasa la zona legal
 * de la promocion, la misma contra la que se formatea `evaluated_at`: dos
 * instantes del mismo carrito en dos relojes distintos no se pueden comparar, y
 * compararlos es justo lo que hace quien mira.
 */
export function CartSummaryMeta({
  itemCount,
  updatedAt,
  locale,
  timeZone,
}: {
  /** `item_count` tal como lo publica el contrato. */
  readonly itemCount: number;
  /** `updated_at` ISO-8601 UTC, o `null` si no hay fila de carrito. */
  readonly updatedAt: string | null;
  readonly locale: Locale;
  /** Zona legal de la promocion. Nunca la del navegador ni la del servidor. */
  readonly timeZone: string;
}) {
  const t = useTranslations("cart");

  const updated = updatedAt === null ? null : formatZonedDateTime(updatedAt, locale, { timeZone });

  return (
    <p className="mt-s3 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-text-muted">
      {/* Plural del diccionario, no una `s` pegada al final: en los dos idiomas
          "1 articulo" y "2 articulos" son formas distintas, y resolverlo con
          una condicion en el componente convertiria la gramatica de cada idioma
          en codigo. La cifra la formatea ICU con la etiqueta completa del
          locale (DEC-029). */}
      <span className="tabular-nums">{t("itemCount", { count: itemCount })}</span>

      {updated === null ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span>{t("updatedAt", { when: updated })}</span>
        </>
      )}
    </p>
  );
}
