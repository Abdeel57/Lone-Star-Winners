import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { formatEntryCount } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { EntryOffer } from "@/lib/api";
import { normalizeEntryOffer } from "@/lib/entry-offer";
import { type PromotionPresentation } from "@/lib/promotion-state";

import { BonusBadge, BonusPeriodRow, RateTiles } from "./entry-rate-lines";

/**
 * Oferta de participaciones de la promocion (§13.5, DEC-052).
 *
 * TRES COSAS QUE ESTE COMPONENTE NO HACE
 * --------------------------------------
 * 1. **No multiplica.** No calcula "2 por dolar por 5X igual a 10". Muestra las
 *    tasas y el periodo bonus como datos distintos, porque la cifra que vale es
 *    la que produce el backend para un carrito, un pedido o una variante
 *    concreta (DEC-023, requisito R13 de `security`). Una multiplicacion hecha
 *    aqui seria una cifra de participaciones calculada en el navegador.
 * 2. **No fija ninguna tasa ni ningun tope.** Las dos tasas -1 por $1 en
 *    mercancia, 2 por $1 en paquetes- y el tope de 10,000 por persona llegan del
 *    contrato. Aqui no hay ni un numero (CLAUDE.md #3 y #14).
 * 3. **No promete nada.** El texto dice que las cantidades las calculan los
 *    sistemas y las rigen las Reglas Oficiales.
 *
 * QUE CAMBIA CON DEC-052
 * ----------------------
 * La forma anterior describia UNA tasa y UN multiplicador. El segundo borrador
 * de las Official Rules necesita dos tasas por tipo de producto y una lista de
 * periodos bonus anunciables, asi que este panel pasa a pintar:
 *
 *   - las TASAS declaradas, una linea por tipo con tasa;
 *   - el TOPE POR PARTICIPANTE, y solo si `entry_caps_enabled` esta encendido.
 *     No es un universo total y no se pinta como emitidas ni como restantes:
 *     `entry_pool` se retiro del contrato con DEC-052 punto 6;
 *   - el periodo bonus VIGENTE, si lo hay;
 *   - los periodos ANUNCIADOS y aun no empezados, que es lo que las Reglas
 *     exigen publicar por adelantado.
 *
 * EL BONUS TIENE TRES CERROJOS
 * ----------------------------
 * El flag `entry_multipliers_enabled` -que gobierna que la funcion exista-, que
 * el backend declare un periodo vigente, y que la promocion admita
 * participaciones ahora mismo. El tercero es el que se olvida: anunciar "5X"
 * sobre una promocion cerrada no es una decoracion caducada, es una afirmacion
 * falsa.
 *
 * SIN REGLAS PUBLICADAS NO SE PUBLICA LA OFERTA (DEC-044)
 * -------------------------------------------------------
 * Las tasas -"2 participaciones por cada $1 de paquete"- son una afirmacion
 * sobre COMO FUNCIONA la promocion, de la misma clase que las que DEC-044
 * retiro del hero y de la banda de anuncio. Y son las mas concretas de todas: un
 * numero que el participante puede aplicar a su carrito. Ese numero no lo fija
 * este panel, lo fija la version de reglas (DEC-012); mientras no exista
 * documento que lo gobierne, no hay nada que publicar.
 *
 * El panel NO desaparece: conserva su titulo y dice exactamente que falta.
 * Enmudecerlo dejaria un hueco sin explicacion justo donde el visitante viene a
 * buscar la cifra.
 */
export function EntryOfferPanel({
  offer,
  presentation,
  multipliersEnabled,
  rulesPublished,
  locale,
  timeZone,
  nowIso,
}: {
  readonly offer: EntryOffer | null;
  readonly presentation: PromotionPresentation;
  /** Valor de `entry_multipliers_enabled`, leido en servidor (DEC-013). */
  readonly multipliersEnabled: boolean;
  /**
   * Si la promocion tiene version de Reglas Oficiales publicada (DEC-044).
   *
   * OBLIGATORIA A PROPOSITO, sin valor por defecto: un `true` implicito haria
   * que quien anadiera un tercer sitio de uso publicara las tasas por olvido, y
   * el olvido caeria del lado inseguro.
   */
  readonly rulesPublished: boolean;
  readonly locale: Locale;
  readonly timeZone: string;
  /**
   * Instante de referencia del render, generado en SERVIDOR.
   *
   * Sirve solo para separar los periodos bonus vigentes de los anunciados. El
   * reloj del navegador no decide nada aqui (DEC-011): cual es el vigente lo
   * resuelve el motor y llega en `active_bonus`.
   */
  readonly nowIso: string;
}) {
  const t = useTranslations("entryOffer");

  const normalized = normalizeEntryOffer(offer, nowIso);

  // Sin oferta declarada no hay nada que publicar NI que retener: el panel no
  // se renderiza, con reglas o sin ellas.
  if (normalized === null) return null;

  if (!rulesPublished) {
    return (
      <section className={PANEL}>
        <PanelHeading>{t("heading")}</PanelHeading>

        {/*
         * En tono de dato y no de alarma: el aviso fuerte -`home.rulesNotPublished`
         * en `Alert tone="warning"`- ya esta en el hero de la portada y en la
         * banda de avisos del detalle. Repetir aqui la misma alerta seria decir
         * dos veces lo mismo en la misma pantalla; lo que este panel aporta es
         * por que ESTA seccion se ha quedado sin cifra.
         *
         * Tampoco se pinta `governedNote`: dice que "las cifras que se muestran
         * aqui son informativas", y aqui ya no se muestra ninguna.
         */}
        <p className="mt-s4 text-body-md text-text-muted">{t("rulesPending")}</p>
      </section>
    );
  }

  /*
   * Los tres cerrojos del bonus. `multipliersEnabled` llega como prop -leido en
   * servidor en la misma peticion que el render- y ademas la propia oferta
   * publica el flag: si cualquiera de los dos dice que no, no se anuncia. Que
   * la comprobacion sea doble no es redundancia perezosa: el flag del sitio y
   * el que aplico el motor a esta promocion pueden discrepar durante el instante
   * en que alguien lo apaga, y en esa ventana lo correcto es callar.
   */
  const bonusAllowed =
    multipliersEnabled && normalized.multipliersEnabled && presentation.acceptsEntries;

  const activeBonus = bonusAllowed ? normalized.activeBonus : null;
  const upcomingBonuses = bonusAllowed ? normalized.upcomingBonuses : [];

  return (
    <section className={PANEL}>
      <PanelHeading>{t("heading")}</PanelHeading>

      {/* DEC-071: las tasas como tarjetas con la cifra grande. */}
      {normalized.rates.length === 0 ? (
        <p className="mt-s4 text-body-md text-text-muted">{t("ratesUnavailable")}</p>
      ) : (
        <RateTiles rates={normalized.rates} locale={locale} className="mt-s5" />
      )}

      {/* EL TOPE ES POR PERSONA. No es un universo, no lleva "emitidas" y no se
          resta: `entry_pool` se retiro del contrato con DEC-052 punto 6. */}
      {normalized.perParticipantMax === null ? null : (
        <p className="mt-s4 text-center font-headline text-body-md font-bold italic text-brand">
          {t("perParticipantMax", {
            entries: formatEntryCount(normalized.perParticipantMax, locale),
          })}
        </p>
      )}

      {normalized.perOrderMax === null ? null : (
        <p className="mt-s2 text-body-sm text-text-muted">
          {t("perOrderMax", { entries: formatEntryCount(normalized.perOrderMax, locale) })}
        </p>
      )}

      {activeBonus === null ? null : (
        <div className="mt-s4">
          <BonusBadge period={activeBonus} locale={locale} />
        </div>
      )}

      {upcomingBonuses.length === 0 ? null : (
        <section aria-labelledby="entry-offer-upcoming-bonus" className="mt-s5">
          <h3 id="entry-offer-upcoming-bonus" className="text-label font-medium text-text-muted">
            {t("bonusUpcomingHeading")}
          </h3>

          <ul className="mt-s3 flex list-none flex-col gap-s3">
            {upcomingBonuses.map((period) => (
              <BonusPeriodRow key={period.id} period={period} locale={locale} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <p className="mt-s4 text-center text-caption text-text-subtle">{t("governedNote")}</p>
    </section>
  );
}

/**
 * El marco del panel (DEC-071): superficie elevada con un brillo de oro arriba,
 * en vez de la tarjeta plana de antes, que en la portada se leia como un aviso
 * mas y no como la oferta.
 */
const PANEL =
  "relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-surface-raised to-surface p-s5 shadow-[0_18px_40px_-24px_rgb(0_0_0/0.9)] sm:p-s6";

function PanelHeading({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="lsw-headline text-heading-lg text-text sm:text-display-sm">{children}</h2>
      <div aria-hidden="true" className="lsw-gold-rule mt-s3 w-[5rem]" />
    </div>
  );
}
