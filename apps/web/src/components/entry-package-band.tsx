import { buttonVariants, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatEntryCount, formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type ProductSummary } from "@/lib/api";
import { offerHasBonus, packageOfferOf } from "@/lib/entry-offer";
import { isProductSoldOut } from "@/lib/product-availability";
import { priceFrom } from "@/lib/product-price";

import { fractionText } from "./entry-rate-lines";
import { PackageQuickAdd } from "./package-quick-add";
import type { CardBonus } from "./product-card";

/**
 * Banda de PAQUETES DE PARTICIPACIONES (DEC-065).
 *
 * El cliente pidio sacar los paquetes de la rejilla de mercancia y presentarlos
 * aparte, por niveles, con la composicion de la referencia (2026-10-04): un
 * titular centrado, una tarjeta "de pase" por nivel con su metal, la cifra y el
 * precio debajo, y el boton de compra en la propia tarjeta. En telefono las
 * tarjetas se deslizan en horizontal, como en la referencia; desde tableta son
 * rejilla.
 *
 * LO QUE SE COPIA Y LO QUE NO
 * ---------------------------
 * Se copia el LOOK: metal por nivel, troquel con muescas, banda de bonus, la
 * insignia de "recomendado" sobre un nivel y el boton ancho. NO se copia el
 * vocabulario: la referencia lo llama "entry" con codigo de barras y numero de
 * serie, que es la imagen de un boleto. Aqui la palabra es la que aprobo el
 * abogado -"paquete de participaciones" / "entry package"- y nunca "boleto",
 * "ticket" ni "oportunidad de ganar" (`docs/LEGAL_PENDING.md`, segundo
 * borrador). Donde la referencia pone el codigo de barras, esta pone la cifra.
 *
 * LA CIFRA NO SE CALCULA AQUI
 * ---------------------------
 * Las participaciones de la tarjeta son las que el backend ya evaluo para la
 * variante (`entry_offer`, §13.4). Sin promocion activa ese objeto llega `null`
 * y la tarjeta enseña lo que dice el NOMBRE del paquete -que lo escribe quien
 * administra el catalogo y es lo que las Reglas exigen declarar donde se
 * ofrece-, sin operar con el.
 *
 * EL NIVEL SALE DEL ORDEN, NO DEL NOMBRE
 * --------------------------------------
 * `GET /products?kind=ENTRY_PACKAGE` devuelve los paquetes de menor a mayor
 * precio (DEC-064). El primero es bronce, el segundo plata, el tercero oro y el
 * cuarto diamante; uno quinto repetiria la escala. Leer el metal del nombre
 * ataria el diseño a como se llamen los paquetes en cada idioma.
 */

/** Metal de cada nivel. Todas las clases son literales para que Tailwind las vea. */
interface TierStyle {
  /** Degradado del marco y del relleno del logotipo. */
  readonly metal: string;
  /** Texto y estrellas sobre el panel oscuro. */
  readonly accent: string;
  /** Chip de participaciones, bajo la tarjeta. Texto blanco >= 4.5:1. */
  readonly chip: string;
  /** Halo al pasar el raton. */
  readonly glow: string;
}

const BRONZE: TierStyle = {
  metal: "bg-[linear-gradient(135deg,#4a240f_0%,#a95c2e_36%,#eeb07f_52%,#9a5128_72%,#5b2c12_100%)]",
  accent: "text-[#f3b98a]",
  chip: "bg-[#8a4723]",
  glow: "hover:shadow-[0_22px_44px_-14px_rgba(169,92,46,0.6)]",
};

const TIERS: readonly TierStyle[] = [
  BRONZE,
  // Plata
  {
    metal:
      "bg-[linear-gradient(135deg,#3b3f45_0%,#8f959d_36%,#f3f5f7_52%,#8a9098_72%,#43474d_100%)]",
    accent: "text-[#e3e7ec]",
    chip: "bg-[#5a6068]",
    glow: "hover:shadow-[0_22px_44px_-14px_rgba(120,128,138,0.6)]",
  },
  // Oro
  {
    metal:
      "bg-[linear-gradient(135deg,#6b4a02_0%,#c99a1d_36%,#ffe98f_52%,#c4930f_72%,#6e4c03_100%)]",
    accent: "text-[#ffd75e]",
    chip: "bg-[#7a5a05]",
    glow: "hover:shadow-[0_22px_44px_-14px_rgba(201,154,29,0.65)]",
  },
  // Diamante
  {
    metal:
      "bg-[linear-gradient(135deg,#0a2f45_0%,#1f86b3_36%,#d2f6ff_52%,#2a9ccc_72%,#0b3550_100%)]",
    accent: "text-[#a8ecff]",
    chip: "bg-[#176a90]",
    glow: "hover:shadow-[0_22px_44px_-14px_rgba(31,134,179,0.6)]",
  },
];

/**
 * Nivel que lleva la insignia de "recomendado": el tercero, oro.
 *
 * Es una recomendacion de la tienda, no un dato: por eso dice "recomendado" y
 * no "el mas popular", que seria una afirmacion sobre ventas que nadie ha
 * medido. Con menos de tres paquetes no se marca ninguno.
 */
const RECOMMENDED_INDEX = 2;

function tierOf(index: number): TierStyle {
  // `TIERS` no esta vacio; el `??` solo existe para el compilador.
  return TIERS[index % TIERS.length] ?? BRONZE;
}

/**
 * "Paquete Bronce: 30 participaciones" -> titulo y detalle.
 *
 * Es solo PRESENTACION del texto que escribio el panel: se parte por los dos
 * puntos para poner el nivel arriba del pase y la cifra abajo, como la
 * referencia. Un nombre sin dos puntos va entero arriba y el detalle queda
 * vacio. Nunca se interpreta la cifra.
 */
function splitPackageName(name: string): {
  readonly title: string;
  readonly detail: string | null;
} {
  const colon = name.indexOf(":");
  if (colon <= 0) return { title: name, detail: null };

  const title = name.slice(0, colon).trim();
  const detail = name.slice(colon + 1).trim();
  return { title, detail: detail.length === 0 ? null : detail };
}

/**
 * "30 participaciones" -> `{ figure: "30", label: "participaciones" }`.
 *
 * Tambien PRESENTACION: separa la cifra escrita al principio del detalle para
 * pintarla como la del backend -numero grande, palabra pequena- y que los
 * cuatro talones midan lo mismo. Sin cifra al principio, `null` y el detalle
 * se pinta entero.
 */
function splitFigure(detail: string): { readonly figure: string; readonly label: string } | null {
  const match = /^(\d[\d.,]*)\s+(\S.*)$/u.exec(detail);
  if (match === null) return null;
  const [, figure, label] = match;
  return figure === undefined || label === undefined ? null : { figure, label };
}

export function EntryPackageBand({
  packages,
  locale,
  bonus,
  labelledBy = "entry-packages",
  className,
}: {
  readonly packages: readonly ProductSummary[];
  readonly locale: Locale;
  /**
   * Bonus vigente, solo para poder NOMBRAR el multiplicador que produjo
   * `entries_now`. Sin el, la cifra se pinta igual y el "5X" se calla.
   */
  readonly bonus?: CardBonus | null;
  readonly labelledBy?: string;
  readonly className?: string;
}) {
  const t = useTranslations("entryPackages");

  if (packages.length === 0) return null;

  return (
    <section
      aria-labelledby={labelledBy}
      className={cn("lsw-band-light py-s12 lg:py-s16", className)}
    >
      <div className="lsw-container">
        <header className="mx-auto max-w-narrow text-center">
          <p className="lsw-eyebrow text-light-gold">{t("eyebrow")}</p>
          <h2
            id={labelledBy}
            className="lsw-headline mt-s2 text-display-md text-light-text sm:text-display-lg"
          >
            {t("title")}
          </h2>
          <p className="mt-s3 text-body-md text-light-text-muted">{t("lead")}</p>
        </header>

        <ul
          className={cn(
            "mt-s8 flex list-none snap-x snap-mandatory gap-s4 overflow-x-auto pb-s2",
            "-mx-s4 px-s4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0",
            packages.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
            "lg:gap-s5",
          )}
        >
          {packages.map((product, index) => (
            <PackagePass
              key={product.id}
              product={product}
              index={index}
              recommended={packages.length > RECOMMENDED_INDEX && index === RECOMMENDED_INDEX}
              locale={locale}
              bonus={bonus ?? null}
            />
          ))}
        </ul>

        {packages.length > 1 ? (
          <p
            aria-hidden="true"
            className="mt-s3 text-center text-caption text-light-text-muted sm:hidden"
          >
            {t("scrollHint")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PackagePass({
  product,
  index,
  recommended,
  locale,
  bonus,
}: {
  readonly product: ProductSummary;
  readonly index: number;
  readonly recommended: boolean;
  readonly locale: Locale;
  readonly bonus: CardBonus | null;
}) {
  const t = useTranslations("entryPackages");
  const tBrand = useTranslations("brand");
  const tier = tierOf(index);

  const name = pickLocalized(product.name, locale);
  const { title, detail } = splitPackageName(name);
  const detailFigure = detail === null ? null : splitFigure(detail);
  const price = formatMoney(priceFrom(product), locale);
  const soldOut = isProductSoldOut(product.variants);

  /*
   * La oferta evaluada por el backend, si la hay (§13.4). `entries_now` es la
   * cifra con los bonus que el motor aplica AHORA; difiere de `base_entries`
   * solo si hay un bonus vigente para esta variante.
   */
  const offer = packageOfferOf(product);
  const hasBonus = offer !== null && offerHasBonus(offer);
  const entriesShown = offer === null ? null : hasBonus ? offer.entries_now : offer.base_entries;

  /*
   * El multiplicador se NOMBRA solo si el periodo vigente es el que el motor
   * dice que aplico a esta variante (`multiplier_ids`). Ver `PackageBonusLine`
   * en `ProductCard`: la misma regla, por el mismo motivo.
   */
  const appliedBonus =
    hasBonus && bonus !== null && offer.multiplier_ids.includes(bonus.period.id) ? bonus : null;
  const multiplier =
    appliedBonus === null ? null : fractionText(appliedBonus.period.multiplier, locale);

  /* Una sola variante: se puede anadir desde aqui. Con mas, se elige en la ficha. */
  const onlyVariant = product.variants.length === 1 ? product.variants[0] : undefined;

  return (
    <li className="relative flex w-[78%] max-w-[22rem] shrink-0 snap-center flex-col pt-s5 sm:w-auto sm:max-w-none">
      {recommended ? (
        <span className="lsw-display absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-pill bg-brand px-s5 py-s1 text-label italic text-on-brand shadow-light-md">
          {t("recommended")}
        </span>
      ) : null}

      {/* EL PASE. Decorativo en su conjunto salvo los textos, que repiten el
          nombre y la cifra: el nombre accesible del paquete es el enlace de
          abajo. */}
      <div
        className={cn(
          "group relative isolate overflow-hidden rounded-xl p-[6px] shadow-light-md",
          "transition-[transform,box-shadow] duration-base ease-standard hover:-translate-y-1",
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          tier.metal,
          tier.glow,
          recommended && "ring-2 ring-brand ring-offset-2 ring-offset-light-bg",
        )}
      >
        {/* Panel superior: nivel, logotipo y bonus. */}
        <div className="relative overflow-hidden rounded-lg bg-[#0d0c0a] px-s3 pb-s4 pt-s2">
          <div className="flex items-center justify-between gap-s2 border-b border-white/10 pb-s2">
            <Star className={cn("h-3 w-3 shrink-0", tier.accent)} />
            <span
              className={cn(
                "lsw-display truncate text-center text-overline tracking-[0.22em]",
                tier.accent,
              )}
            >
              {title}
            </span>
            <Star className={cn("h-3 w-3 shrink-0", tier.accent)} />
          </div>

          {/* Logotipo de la marca en el metal del nivel. Sale del diccionario
              como el resto del sitio (DEC-021): las mismas dos piezas que
              `BrandLockup`. */}
          <div aria-hidden="true" className="mt-s3 flex flex-col items-center leading-none">
            <span
              className={cn(
                "lsw-display block bg-clip-text text-[2.6rem] italic leading-[0.9] text-transparent sm:text-[2.9rem]",
                tier.metal,
              )}
            >
              {tBrand("wordmarkLead")}
            </span>
            <span className="lsw-display mt-s1 text-label italic tracking-[0.5em] text-white/85">
              {tBrand("wordmarkTail")}
            </span>
          </div>

          {appliedBonus !== null || hasBonus ? (
            <p className="lsw-display -mx-s3 mt-s3 bg-accent px-s3 py-s1 text-center text-caption italic text-on-accent">
              {multiplier === null ? t("bonusRibbonPlain") : t("bonusRibbon", { multiplier })}
            </p>
          ) : null}
        </div>

        {/* Troquel: linea punteada con dos muescas que muerden el marco. Las
            muescas son del color de la banda, que es lo que las hace hueco. */}
        <div aria-hidden="true" className="relative -mx-[6px] my-[5px] h-[2px]">
          <span className="absolute inset-x-s5 top-0 border-t-2 border-dashed border-black/35" />
          <span className="absolute left-0 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-light-bg" />
          <span className="absolute right-0 top-1/2 h-6 w-6 -translate-y-1/2 translate-x-1/2 rounded-full bg-light-bg" />
        </div>

        {/* Talon: la cifra, donde la referencia pone el codigo de barras. */}
        <div className="flex items-center justify-between gap-s3 rounded-lg bg-[#0d0c0a] px-s4 py-s3">
          <div className="min-w-0">
            {entriesShown !== null ? (
              <>
                <p className="lsw-display text-heading-lg leading-none tabular-nums text-white">
                  {formatEntryCount(entriesShown, locale)}
                </p>
                <p className={cn("lsw-display mt-s1 text-overline tracking-[0.2em]", tier.accent)}>
                  {t("entriesLabel")}
                </p>
              </>
            ) : detailFigure !== null ? (
              <>
                <p className="lsw-display text-heading-lg leading-none tabular-nums text-white">
                  {detailFigure.figure}
                </p>
                <p className={cn("lsw-display mt-s1 text-overline tracking-[0.2em]", tier.accent)}>
                  {detailFigure.label}
                </p>
              </>
            ) : detail !== null ? (
              <p className="lsw-display text-heading-md leading-tight text-white">{detail}</p>
            ) : (
              <p className="lsw-display text-heading-md leading-tight text-white">{title}</p>
            )}
          </div>

          {/* Estrellas de nivel: una por escalon. */}
          <div aria-hidden="true" className="flex shrink-0 gap-[3px]">
            {Array.from({ length: (index % TIERS.length) + 1 }, (_, star) => (
              <Star key={star} className={cn("h-4 w-4", tier.accent)} />
            ))}
          </div>
        </div>

        {/* Brillo que cruza el pase al pasar el raton. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12",
            "bg-gradient-to-r from-transparent via-white/35 to-transparent",
            "translate-x-[-120%] transition-transform duration-700 ease-standard group-hover:translate-x-[420%]",
            "motion-reduce:hidden",
          )}
        />
      </div>

      {/* Bajo el pase, como la referencia: cifra y bonus, nombre, precio, boton. */}
      <div className="mt-s4 flex flex-1 flex-col">
        {entriesShown === null && multiplier === null ? null : (
          <div className="flex flex-wrap gap-s2">
            {entriesShown === null ? null : (
              <span
                className={cn(
                  "lsw-display rounded-sm px-s2 py-[3px] text-caption italic text-white",
                  tier.chip,
                )}
              >
                {t("entriesChip", { entries: formatEntryCount(entriesShown, locale) })}
              </span>
            )}
            {multiplier === null ? null : (
              <span className="lsw-display rounded-sm bg-accent px-s2 py-[3px] text-caption italic text-on-accent">
                {t("bonusChip", { multiplier })}
              </span>
            )}
          </div>
        )}

        <h3 className="mt-s2 text-heading-sm font-bold text-light-text">
          <Link
            href={`/products/${product.slug}`}
            className="hover:text-light-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-gold"
          >
            {name}
            <span className="sr-only">{t("viewLabel", { name })}</span>
          </Link>
        </h3>

        {price === null ? null : (
          <p className="mt-s1 text-body-md tabular-nums text-light-text-muted">{price}</p>
        )}

        <div className="mt-auto pt-s3">
          {onlyVariant === undefined ? (
            <Link
              href={`/products/${product.slug}`}
              className={buttonVariants({ variant: "accent", size: "lg", fullWidth: true })}
            >
              {t("viewLabel", { name: title })}
            </Link>
          ) : (
            <PackageQuickAdd variantId={onlyVariant.id} locale={locale} soldOut={soldOut} />
          )}
        </div>
      </div>
    </li>
  );
}

/** Estrella de cinco puntas del escudo. Decorativa. */
function Star({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={className}>
      <path
        fill="currentColor"
        d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 15l-5.4 3 1.2-6L1.3 7.8l6.1-.7z"
      />
    </svg>
  );
}
