import { MediaFrame } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatInteger, formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { pickLocalized, type OrderLine } from "@/lib/api";

/**
 * Lineas de un pedido.
 *
 * ES UNA LISTA Y NO UNA TABLA, por lo mismo que el historial del ledger: en
 * 360px una tabla de cinco columnas con nombres de producto obliga a hacer
 * scroll horizontal, y el nombre del producto es justo lo que hay que poder
 * leer entero.
 *
 * `line_total` LLEGA CALCULADO. No se multiplica cantidad por precio unitario
 * aqui, ni siquiera cuando parece trivial: el precio de una linea puede llevar
 * un descuento, un redondeo o una promocion aplicados en el backend, y una
 * multiplicacion en el cliente produciria un total que no coincide con el que
 * se cobro (DEC-010, DEC-023).
 */
export function OrderLineList({
  lines,
  locale,
}: {
  readonly lines: readonly OrderLine[];
  readonly locale: Locale;
}) {
  const t = useTranslations("account.order");

  return (
    <ul className="flex list-none flex-col gap-s4">
      {lines.map((line) => {
        const name = pickLocalized(line.product_name, locale);
        const variant = pickLocalized(line.variant_name, locale);
        const unitPrice = formatMoney(line.unit_price, locale);
        const lineTotal = formatMoney(line.line_total, locale);

        return (
          <li
            key={line.line_id}
            className="flex gap-s4 border-b border-border pb-s4 last:border-b-0 last:pb-0"
          >
            {line.image_url === null ? null : (
              <div className="w-20 shrink-0 sm:w-24">
                <MediaFrame ratio="square">
                  {/*
                   * `img` y no `next/image`: el pedido es historico y su imagen
                   * puede apuntar a un producto retirado del catalogo, cuya URL
                   * el optimizador ya no reconoce como permitida. Un pedido de
                   * hace un ano no puede dejar de renderizarse porque el
                   * catalogo haya cambiado.
                   */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={line.image_url} alt="" className="h-full w-full object-cover" />
                </MediaFrame>
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-text">{name}</p>
              <p className="mt-s1 text-body-sm text-text-muted">{variant}</p>
              <p className="mt-s1 font-mono text-caption text-text-subtle">{line.sku}</p>

              <dl className="mt-s3 flex flex-wrap gap-x-s5 gap-y-s2">
                <div className="flex items-baseline gap-2">
                  <dt className="text-caption text-text-subtle">{t("quantity")}</dt>
                  <dd className="text-body-sm tabular-nums text-text">
                    {formatInteger(line.quantity, locale)}
                  </dd>
                </div>

                {unitPrice === null ? null : (
                  <div className="flex items-baseline gap-2">
                    <dt className="text-caption text-text-subtle">{t("unitPrice")}</dt>
                    <dd className="text-body-sm tabular-nums text-text">{unitPrice}</dd>
                  </div>
                )}

                {lineTotal === null ? null : (
                  <div className="flex items-baseline gap-2">
                    <dt className="text-caption text-text-subtle">{t("lineTotal")}</dt>
                    <dd className="text-body-sm font-medium tabular-nums text-text">{lineTotal}</dd>
                  </div>
                )}
              </dl>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
