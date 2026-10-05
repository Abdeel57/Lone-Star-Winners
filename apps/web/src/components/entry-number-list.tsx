import { Alert, buttonVariants, Card } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatEntryCount, formatZonedDate } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import type { EntryNumberSource, EntryNumbersPage } from "@/lib/api";

const SOURCE_KEY = {
  PURCHASE: "batchSourcePurchase",
  AMOE: "batchSourceAmoe",
  ADMIN: "batchSourceAdmin",
  SYSTEM: "batchSourceSystem",
} as const satisfies Record<EntryNumberSource, string>;

/**
 * Numeros de participacion (DEC-080).
 *
 * UN NUMERO POR PARTICIPACION, AGRUPADOS POR LO QUE LOS DIO
 * --------------------------------------------------------
 * Cada compra, tarjeta por correo o ajuste es una tarjeta con sus numeros. Los
 * numeros llegan revueltos del backend -la permutacion con clave de la
 * promocion- y aqui se pintan TAL CUAL, en el orden en que llegan: ordenarlos
 * no ganaria nada y haria pensar que hay una secuencia.
 *
 * La API pagina por numeros (500 por pagina): un lote de 2,000 de una tarjeta
 * por correo se parte entre paginas, y la tarjeta muestra los de esta pagina.
 * El total del lote va en la cabecera para que el corte no se lea como "solo
 * tengo estos".
 *
 * LOS ANULADOS SE ENSENAN, TACHADOS
 * --------------------------------
 * Un numero que desaparece sin explicacion es justo lo que hace desconfiar.
 * Se tacha y, para lectores de pantalla, se anuncia "anulado".
 *
 * TODA ESTA PANTALLA VIVE DETRAS DE `visible_entry_numbers_enabled`
 * ----------------------------------------------------------------
 * Quien llame a este componente tiene que haber comprobado el flag antes; aqui
 * no se vuelve a comprobar, porque un componente que decide si una funcion
 * legalmente material esta encendida es un segundo sitio donde ese flag puede
 * estar mal leido.
 *
 * EL AVISO DEL FINAL NO ES DECORACION: los numeros no son el sorteo. El
 * ganador lo elige el administrador independiente entre las participaciones
 * vigentes (Reglas, seccion 7), y un participante que ve numeros asume lo
 * contrario si nadie se lo dice.
 */
export function EntryNumberList({
  page,
  locale,
  timeZone,
  moreHref,
  firstHref,
}: {
  readonly page: EntryNumbersPage;
  readonly locale: Locale;
  /** Zona legal de la promocion (DEC-011). */
  readonly timeZone: string;
  /** Enlace a la pagina siguiente; `null` si no hay mas. */
  readonly moreHref: string | null;
  /** Enlace a la primera pagina; `null` si ya se esta en ella. */
  readonly firstHref: string | null;
}) {
  const t = useTranslations("account.entries");

  if (page.items.length === 0) {
    return <Alert tone="info">{t("numbersEmpty")}</Alert>;
  }

  return (
    <div>
      <p className="text-body-sm text-text-muted">{t("numbersIntro")}</p>

      <p className="mt-s2 text-body-sm font-semibold text-text">
        {t("numbersActive", { count: page.active_numbers })}
        {page.void_numbers > 0 ? (
          <>
            <span aria-hidden="true" className="font-normal text-text-subtle">
              {" · "}
            </span>
            <span className="font-normal text-text-muted">
              {t("numbersVoid", { count: page.void_numbers })}
            </span>
          </>
        ) : null}
      </p>

      <ul className="mt-s4 flex list-none flex-col gap-s3">
        {page.items.map((batch) => {
          const date = formatZonedDate(batch.awarded_at, locale, {
            timeZone,
            dateStyle: "medium",
          });
          const source = t(SOURCE_KEY[batch.source_type]);

          return (
            <li key={batch.batch_id}>
              <Card elevation="raised" padding="md">
                <div className="flex flex-wrap items-baseline justify-between gap-x-s3 gap-y-s1">
                  <p className="text-body-sm font-semibold text-text">
                    {date === null ? source : t("batchDate", { source, date })}
                  </p>
                  <p className="font-display text-heading-sm font-bold tabular-nums text-brand">
                    {t("batchQuantity", { count: batch.quantity })}
                  </p>
                </div>

                {/*
                 * Los numeros son CADENAS y se pintan tal cual (DEC-010): sin
                 * separador de miles, con sus ceros a la izquierda. Ocho cifras
                 * en monoespaciada caben de dos en dos en 360px.
                 */}
                <ul className="mt-s3 grid list-none grid-cols-2 gap-s2 sm:grid-cols-4 lg:grid-cols-5">
                  {batch.numbers.map((entry) => (
                    <li
                      key={entry.number}
                      className={
                        entry.active
                          ? "rounded-sm border border-border bg-surface px-s2 py-s1 text-center font-mono text-body-sm tabular-nums text-text"
                          : "rounded-sm border border-dashed border-border px-s2 py-s1 text-center font-mono text-body-sm tabular-nums text-text-subtle line-through"
                      }
                    >
                      <span>{entry.number}</span>
                      {entry.active ? null : (
                        <span className="sr-only">{` ${t("numberVoid")}`}</span>
                      )}
                    </li>
                  ))}
                </ul>

                {batch.numbers.length < batch.quantity ? (
                  <p className="mt-s2 text-caption text-text-subtle">
                    {t("batchPartial", {
                      shown: formatEntryCount(batch.numbers.length, locale),
                      total: formatEntryCount(batch.quantity, locale),
                    })}
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      {moreHref === null && firstHref === null ? null : (
        <div className="mt-s4 flex flex-wrap gap-s3">
          {moreHref === null ? null : (
            <Link href={moreHref} className={buttonVariants({ variant: "secondary" })}>
              {t("numbersMore")}
            </Link>
          )}
          {firstHref === null ? null : (
            <Link href={firstHref} className={buttonVariants({ variant: "ghost" })}>
              {t("numbersFirstPage")}
            </Link>
          )}
        </div>
      )}

      <p className="mt-s4 text-caption text-text-subtle">{t("numbersNote")}</p>
    </div>
  );
}
