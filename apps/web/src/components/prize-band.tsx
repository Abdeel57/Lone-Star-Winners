import { buttonVariants, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type PromotionDetail } from "@/lib/api";

/**
 * Banda del premio: el unico bloque CLARO de la portada.
 *
 * POR QUE EXISTE
 * --------------
 * La referencia visual reserva una banda de color pleno para su reclamo mas
 * fuerte, y ese contraste -una sola superficie clara en una pagina entera de
 * negros- es la mitad de por que su portada no se lee como una lista de
 * secciones. Su banda vende una membresia con un multiplicador de
 * participaciones, que aqui esta prohibido por partida doble (CLAUDE.md
 * seccion 1 y DEC-023).
 *
 * Lo que si es cierto, y es lo mas fuerte que este producto tiene que decir, es
 * QUE SE SORTEA. Asi que la banda dorada es del premio: su nombre, su valor
 * declarado al mayor tamano del sistema, su descripcion, y el enlace al detalle
 * de la promocion.
 *
 * TODO LO QUE PINTA VIENE DEL CONTRATO
 * ------------------------------------
 * Nombre, descripcion y valor declarado son campos de `PromotionDetail`, y los
 * dos primeros son contenido dinamico localizado (DEC-030): llegan en los dos
 * idiomas y se eligen con `pickLocalized`, sin traducirlos. Si la promocion no
 * declara premio -que es el estado REAL del backend hoy, porque no existe
 * modelo de premio-, la banda entera NO se renderiza. Una banda dorada a
 * pantalla completa con el hueco del premio vacio seria el peor sitio del sitio
 * para tener un hueco.
 *
 * CONTRASTE
 * ---------
 * Texto casi negro (`text-inverse`) sobre oro: 9,4:1 sobre el oro base y mas
 * sobre los tramos claros del degradado, muy por encima del minimo AA. El
 * patron topografico va aqui en tinta NEGRA, no dorada: sobre oro, un patron
 * dorado no se ve.
 */
export function PrizeBand({
  promotion,
  locale,
}: {
  readonly promotion: PromotionDetail;
  readonly locale: Locale;
}) {
  const t = useTranslations("home");
  const tPromotion = useTranslations("promotion");

  const prize = promotion.prize ?? null;
  if (prize === null) return null;

  /*
   * El valor declarado puede vivir en dos sitios del contrato: en el premio
   * (`prize.declared_value`) y en el resumen de la promocion (`prize_value`).
   * Manda el del premio, que es el especifico; el del resumen es el respaldo.
   * `formatMoney` devuelve `null` si el importe no respeta DEC-010, y en ese
   * caso no se pinta la cifra: el resto de la banda sigue siendo verdad.
   */
  const declared = prize.declared_value ?? promotion.prize_value;
  const value = declared === null ? null : formatMoney(declared, locale);

  return (
    <section aria-labelledby="prize-band" className="lsw-prize-band relative isolate">
      <div className="lsw-container py-s16 lg:py-s20">
        <div className="grid gap-s8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-s12">
          <div>
            <p className={cn("lsw-eyebrow", "text-text-inverse/70")}>{t("prizeBand.eyebrow")}</p>

            <h2
              id="prize-band"
              className="lsw-display mt-s3 text-display-md text-text-inverse sm:text-display-lg"
            >
              {pickLocalized(prize.name, locale)}
            </h2>

            <p className="mt-s5 max-w-narrow text-body-lg text-text-inverse/85">
              {pickLocalized(prize.description, locale)}
            </p>

            <div className="mt-s8">
              <Link
                href={`/promotions/${promotion.slug}`}
                className={cn(
                  buttonVariants({ variant: "primary", size: "lg" }),
                  // El boton primario del sistema es oro sobre negro. Sobre la
                  // banda dorada eso desapareceria, asi que aqui se invierte:
                  // negro pleno sobre oro. Es la unica superficie del sitio
                  // donde hace falta, y por eso la inversion vive aqui y no en
                  // una variante nueva de `@lsw/ui`.
                  "border-text-inverse bg-text-inverse text-brand-active",
                  "hover:bg-bg hover:text-brand-hover focus-visible:ring-offset-brand",
                )}
              >
                {t("viewPromotion")}
              </Link>
            </div>
          </div>

          {value === null ? null : (
            <div className="border-t border-text-inverse/25 pt-s6 lg:justify-self-end lg:border-l lg:border-t-0 lg:pl-s10 lg:pt-0">
              <p className="lsw-eyebrow text-text-inverse/70">{tPromotion("prizeValueLabel")}</p>
              <p className="lsw-display mt-s2 text-display-lg tabular-nums text-text-inverse sm:text-display-xl">
                {value}
              </p>
              <p className="mt-s5 max-w-narrow text-body-sm text-text-inverse/80">
                {t("prizeBand.note")}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
