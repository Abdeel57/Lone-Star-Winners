import { buttonVariants, cn } from "@lsw/ui";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";

import { Link } from "@/i18n/navigation";

/**
 * PROXIMAMENTE: la gorra LSW Cap (DEC-076).
 *
 * Cierra la portada con un adelanto de producto que TODAVIA NO SE VENDE. Por
 * eso no hay precio, ni boton de compra, ni enlace a una ficha: las tarjetas no
 * son enlaces. Lo unico que se afirma es que llega y en que colores; el precio
 * y la fecha se dicen "por anunciar" en vez de inventarlos.
 *
 * COMO SE ENSENA
 * --------------
 * Negro con un foco rojo, un "COMING SOON" gigante en contorno que deriva al
 * fondo, y las siete gorras como fotos de catalogo que SE ENCIENDEN una tras
 * otra al llegar a ellas: empiezan como siluetas a oscuras y se iluminan, con
 * un destello al hacerlo (`data-reveal="lights"` en `globals.css`, lo dispara
 * `ScrollReveal`). En telefono van en carrusel, y las que estan a la derecha se
 * encienden al deslizarlas. Con `prefers-reduced-motion` o sin JavaScript se
 * ven encendidas desde el principio.
 *
 * Las fotos son las del cliente tal cual -con su rotulo "LSW CAP · Color"-,
 * convertidas a WebP en `public/coming-soon/`. El nombre del color se repite
 * debajo en el idioma de la pagina, porque el de la foto esta en ingles.
 */

/** Colores en el orden del cliente. `file` solo cuando el nombre no coincide. */
const CAPS = [
  { key: "black", swatch: "#121212" },
  { key: "navy", swatch: "#1f2940" },
  { key: "white", swatch: "#f3f2ee" },
  { key: "khaki", swatch: "#cbb595" },
  { key: "olive", swatch: "#4d5a35" },
  { key: "darkGrey", file: "dark-grey", swatch: "#4b4e54" },
  { key: "wine", swatch: "#6e1f2c" },
] as const;

/** Tamanos de la foto: la destacada ocupa dos columnas de cinco en escritorio. */
const SIZES_FEATURED = "(min-width: 1024px) 40vw, 72vw";
const SIZES = "(min-width: 1024px) 20vw, 72vw";

export function ComingSoonBand() {
  const t = useTranslations("home.comingSoon");

  return (
    <section
      aria-labelledby="coming-soon"
      className="lsw-coming-soon relative isolate overflow-hidden border-t border-white/10 py-s16 lg:py-s20"
    >
      {/* "COMING SOON" en contorno, gigante, derivando al fondo. Decorativo:
          el titulo de la seccion es el `h2`. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-s6 -z-10 overflow-hidden"
      >
        <div className="lsw-drift flex w-max">
          {[0, 1].map((copy) => (
            <span
              key={copy}
              className="lsw-headline lsw-outline-text whitespace-nowrap pr-s8 text-[clamp(5rem,22vw,15rem)]"
            >
              {t("backdrop")} ◆ {t("backdrop")} ◆{" "}
            </span>
          ))}
        </div>
      </div>

      <div className="lsw-container">
        <header data-reveal className="mx-auto max-w-narrow text-center">
          <p className="inline-flex items-center gap-s2 font-headline text-label font-black uppercase italic tracking-[0.2em] text-accent-text">
            {/* Punto "en directo": late despacio, no parpadea. */}
            <span aria-hidden="true" className="h-2 w-2 animate-lsw-pulse rounded-full bg-accent" />
            {t("eyebrow")}
          </p>
          <h2
            id="coming-soon"
            className="lsw-headline lsw-chrome mt-s3 text-[clamp(3.25rem,14vw,7.5rem)]"
          >
            {t("title")}
          </h2>
          <p className="mt-s4 text-body-lg text-text-muted">{t("lead")}</p>

          {/* Los siete colores en muestra, apareciendo uno a uno. Decorativos:
              cada tarjeta ya dice su color. */}
          <ul aria-hidden="true" className="mt-s5 flex list-none justify-center gap-s2">
            {CAPS.map((cap, index) => (
              <li
                key={cap.key}
                data-reveal
                className="h-5 w-5 rounded-full shadow-[0_2px_8px_rgb(0_0_0/0.6)] ring-2 ring-white/20"
                style={
                  {
                    backgroundColor: cap.swatch,
                    "--reveal-delay": `${String(index * 90)}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </ul>
        </header>

        <ul
          className={cn(
            "mt-s10 flex list-none snap-x snap-mandatory gap-s4 overflow-x-auto pb-s2",
            "-mx-s4 px-s4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            // Escritorio: la negra destacada en 2x2 y las otras seis alrededor.
            "lg:mx-0 lg:grid lg:snap-none lg:grid-cols-5 lg:grid-rows-2 lg:overflow-visible lg:px-0 lg:pb-0",
          )}
        >
          {CAPS.map((cap, index) => {
            const featured = index === 0;
            const color = t(`colors.${cap.key}`);
            const file = "file" in cap ? cap.file : cap.key;
            return (
              <li
                key={cap.key}
                data-reveal="lights"
                style={{ "--reveal-delay": `${String(index * 160)}ms` } as CSSProperties}
                className={cn(
                  "group relative flex w-[72%] max-w-[20rem] shrink-0 snap-center flex-col overflow-hidden rounded-xl bg-white",
                  "shadow-[0_24px_48px_-24px_rgb(0_0_0/0.9)] ring-1 ring-white/10",
                  "transition-transform duration-base ease-standard hover:-translate-y-1 motion-reduce:hover:translate-y-0",
                  "lg:w-auto lg:max-w-none",
                  featured && "lg:col-span-2 lg:row-span-2",
                )}
              >
                <div
                  className={cn(
                    "lsw-lights-target relative aspect-square overflow-hidden",
                    featured && "lg:aspect-auto lg:flex-1",
                  )}
                >
                  <Image
                    src={`/coming-soon/lsw-cap-${file}.webp`}
                    alt={t("imageAlt", { color })}
                    fill
                    sizes={featured ? SIZES_FEATURED : SIZES}
                    className="object-cover transition-transform duration-700 ease-standard group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                </div>

                {/* "PRONTO", en rojo: brilla tambien sobre la silueta apagada. */}
                <span className="absolute left-s3 top-s3 rounded-sm bg-accent px-s2 py-[3px] font-headline text-caption font-black uppercase italic tracking-[0.08em] text-on-accent shadow-[0_6px_16px_-6px_rgb(0_0_0/0.7)]">
                  {t("badge")}
                </span>

                <div className="flex items-center gap-s2 bg-[#0d0c0a] px-s3 py-s2">
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/30"
                    style={{ backgroundColor: cap.swatch }}
                  />
                  <span className="truncate font-headline text-label font-extrabold uppercase italic tracking-[0.06em] text-text">
                    {color}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <p aria-hidden="true" className="mt-s3 text-center text-caption text-text-muted lg:hidden">
          {t("hint")}
        </p>

        <div data-reveal className="mt-s8 flex flex-col items-center gap-s3 text-center">
          <p className="text-body-sm text-text-subtle">{t("note")}</p>
          <Link href="/shop" className={buttonVariants({ variant: "subtle", size: "lg" })}>
            {t("cta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
