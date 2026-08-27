import { Badge, Card } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { useEntryReasonLabel, useEntrySourceLabel, useEntryTypeLabel } from "@/i18n/account-labels";
import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { EntryTransaction } from "@/lib/api";

/**
 * Historial del ledger del participante.
 *
 * LO QUE ESTA PANTALLA TIENE QUE HACER POSIBLE
 * --------------------------------------------
 * Que alguien vea que una compra le dio participaciones, que la devolucion se
 * las quito, y que las dos cosas siguen ahi. El ledger es append-only por
 * construccion (DEC-007): una correccion es una FILA NUEVA con delta de signo
 * contrario y `reverses_transaction_id` apuntando a la original, nunca la
 * desaparicion de nada.
 *
 * Por eso aqui no hay ningun filtro que oculte los movimientos negativos, ni
 * una vista "solo activas": esconder las correcciones convertiria el historial
 * en un resumen, y el resumen ya existe en la pantalla anterior.
 *
 * ES UNA LISTA DE TARJETAS Y NO UNA TABLA
 * ---------------------------------------
 * Cada movimiento tiene cinco datos -fecha, tipo, procedencia, motivo,
 * cantidad- y el motivo es una frase, no una palabra. En una tabla, esa columna
 * fuerza el scroll horizontal en cualquier telefono, y en un historial de
 * participaciones el motivo es justamente lo que hay que poder leer.
 *
 * EL SIGNO SE PINTA, NO SE CALCULA. `quantity_delta` llega con su signo desde el
 * backend; aqui se compara con cero para elegir el tono, que es una comparacion
 * y no una operacion sobre la cifra.
 */
export function EntryLedgerList({
  transactions,
  locale,
  timeZone,
}: {
  readonly transactions: readonly EntryTransaction[];
  readonly locale: Locale;
  /** Zona legal declarada por la promocion (DEC-011). */
  readonly timeZone: string;
}) {
  const t = useTranslations("account.ledger");
  const typeLabel = useEntryTypeLabel();
  const sourceLabel = useEntrySourceLabel();
  const reasonLabel = useEntryReasonLabel();

  return (
    <ul className="flex list-none flex-col gap-s3">
      {transactions.map((transaction) => {
        const negative = transaction.quantity_delta < 0;
        const when = formatZonedDateTime(transaction.effective_at, locale, { timeZone });

        return (
          <li key={transaction.id}>
            <Card elevation="raised" padding="md">
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <div className="min-w-0">
                  <p className="lsw-display text-heading-sm text-text">
                    {typeLabel(transaction.type)}
                  </p>

                  {when === null ? null : (
                    <p className="mt-s1 text-caption text-text-subtle">{when}</p>
                  )}
                </div>

                {/*
                 * La cifra con su signo. `formatEntryCount` trunca a entero y
                 * pone el separador de miles del idioma; el signo lo trae el
                 * propio numero, asi que el `+` de los positivos se anade como
                 * TEXTO y no sumando nada.
                 */}
                <p
                  className={`font-display text-heading-md font-bold tabular-nums ${
                    negative ? "text-danger" : "text-brand"
                  }`}
                >
                  {negative ? "" : "+"}
                  {formatEntryCount(transaction.quantity_delta, locale)}
                </p>
              </div>

              <p className="mt-s3 text-body-sm text-text-muted">
                {reasonLabel(transaction.reason_key)}
              </p>

              <div className="mt-s3 flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="sm">
                  {sourceLabel(transaction.source_type)}
                </Badge>

                {transaction.reverses_transaction_id === null ? null : (
                  <Badge tone="warning" size="sm">
                    {t("reversalOf")}
                  </Badge>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
