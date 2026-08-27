import { Alert, Card } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatEntryCount } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { EntryBatch } from "@/lib/api";

/**
 * Rangos de numeros de participacion.
 *
 * POR QUE RANGOS Y NO UNA FILA POR PARTICIPACION
 * ----------------------------------------------
 * Un solo pedido de este producto puede generar once mil participaciones.
 * Pintarlas de una en una produce una pagina de once mil filas que ningun
 * navegador de telefono termina de renderizar, y que ademas no dice nada: nadie
 * lee once mil numeros. El rango -primero y ultimo- contiene la misma
 * informacion y cabe en una linea.
 *
 * TODA ESTA PANTALLA VIVE DETRAS DE `visible_entry_numbers_enabled`
 * ----------------------------------------------------------------
 * El flag esta apagado por defecto y con el apagado el backend responde 404: los
 * rangos se asignan igual -para que sean reconstruibles hacia atras- pero no se
 * muestran. Quien llame a este componente tiene que haber comprobado el flag
 * antes; aqui no se vuelve a comprobar, porque un componente que decide si una
 * funcion legalmente material esta encendida es un segundo sitio donde ese flag
 * puede estar mal leido.
 *
 * EL AVISO DEL FINAL NO ES DECORACION. El contrato lo dice con todas las letras
 * y aqui se repite en la pantalla: la secuencia de numeros NO es el algoritmo
 * del sorteo. Que existan numeros no autoriza a sortear sobre ellos (DEC-017,
 * principio #11), y un participante que ve numeros asignados asume lo contrario
 * si nadie se lo dice.
 */
export function EntryBatchList({
  batches,
  locale,
}: {
  readonly batches: readonly EntryBatch[];
  readonly locale: Locale;
}) {
  const t = useTranslations("account.entries");

  if (batches.length === 0) {
    return <Alert tone="info">{t("batchesEmpty")}</Alert>;
  }

  return (
    <div>
      <p className="text-body-sm text-text-muted">{t("batchesIntro")}</p>

      <ul className="mt-s4 flex list-none flex-col gap-s3">
        {batches.map((batch) => (
          <li key={batch.batch_id}>
            <Card elevation="raised" padding="md">
              <p className="font-display text-heading-sm font-bold tabular-nums text-brand">
                {t("batchQuantity", { entries: formatEntryCount(batch.quantity, locale) })}
              </p>

              {/*
               * Los numeros son CADENAS y se pintan tal cual (DEC-010). No se
               * formatean con separador de miles: `LSW26-000450001` no es una
               * cifra, es un identificador, y agruparlo lo destruiria.
               *
               * `break-words` porque en 360px los dos identificadores completos
               * no caben en una linea, y sin el la pagina crece a lo ancho.
               */}
              <p className="mt-s2 break-words font-mono text-body-sm tabular-nums text-text-muted">
                {t("batchRange", { first: batch.first_number, last: batch.last_number })}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-s4 text-caption text-text-subtle">{t("batchesNote")}</p>
    </div>
  );
}
