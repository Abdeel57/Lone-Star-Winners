import { cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { BrandLockup } from "./brand-lockup";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav, type NavDestination } from "./mobile-nav";

/**
 * Cabecera del sitio.
 *
 * Solo se enlaza lo que EXISTE. `Winners` y la cuenta del participante llegan
 * en hitos posteriores y por eso no aparecen: un enlace a una pantalla que no
 * existe es peor que no tener el enlace, y en un sitio donde una de las rutas
 * son las Reglas Oficiales, un 404 en la barra de navegacion es un problema de
 * confianza, no una molestia.
 *
 * El carrito NO lleva contador de articulos. Para pintarlo habria que pedir el
 * carrito en CADA pagina del sitio -incluida la portada, que no lo necesita- y
 * eso convertiria una lectura de sesion en parte del render de todas las
 * pantallas publicas. El contador se anadira cuando exista una lectura barata
 * que no obligue a ello.
 *
 * Las Reglas Oficiales estan en la navegacion principal a proposito. La ruta
 * `/official-rules` resuelve sola la promocion vigente, de modo que el enlace
 * funciona sin que la cabecera tenga que saber que promocion hay abierta.
 *
 * ---------------------------------------------------------------------------
 * COMPOSICION (segunda pasada de DEC-038)
 * ---------------------------------------------------------------------------
 * Tres columnas y el LOGOTIPO EN EL CENTRO, como la referencia: navegacion a la
 * izquierda -hamburguesa por debajo de `xl`-, marca centrada, acciones a la
 * derecha. La rejilla es `1fr auto 1fr`, de modo que la marca queda centrada
 * respecto del contenedor y no respecto del hueco que le dejen los lados; si
 * dependiera del reparto natural, el logotipo se desplazaria cada vez que un
 * enlace cambiara de longitud al cambiar de idioma.
 *
 * EL PUNTO DE RUPTURA ES `xl`, Y ESTA MEDIDO
 * ------------------------------------------
 * La tira de escritorio en espanol -"Tienda / Promociones / Reglas Oficiales /
 * Preguntas frecuentes"- ronda los 550px. Con la marca centrada (~230px) y las
 * dos acciones de la derecha (~260px) no cabe en los 960px utiles de una
 * pantalla de 1024, y la cabecera se partiria en dos filas justo en las
 * tabletas. Hasta 1280px manda el panel lateral, que es la misma navegacion
 * completa y no una version recortada. Los tres `xl:` de este archivo y el de
 * `mobile-nav.tsx` tienen que moverse juntos.
 *
 * UN DESTINO EN ORO
 * -----------------
 * `Promociones` es el equivalente de la entrada destacada de la referencia. Se
 * destaca esa y no la tienda porque es la pantalla que explica el marco -que
 * hay abierto, en que fase esta, donde estan las reglas-, y porque destacar la
 * tienda empujaria a comprar, que es exactamente la jerarquia que este producto
 * no debe tener.
 *
 * La cabecera sigue siendo fija, sobre negro semitransparente con desenfoque:
 * al hacer scroll, el contenido pasa POR DEBAJO de la marca en vez de empujarla
 * fuera.
 */
export async function SiteHeader() {
  const t = await getTranslations();

  /*
   * La lista de destinos se declara UNA vez y la consumen las dos
   * colocaciones: la tira de escritorio y el panel de telefono. Antes de que el
   * logotipo pasara al centro, ambas eran el mismo `<nav>` movido con `order`;
   * ahora son dos, y esta lista es lo que impide que discrepen.
   */
  const destinations: readonly NavDestination[] = [
    { href: "/shop", label: t("nav.shop"), highlighted: false },
    { href: "/promotions", label: t("nav.promotions"), highlighted: true },
    { href: "/official-rules", label: t("nav.officialRules"), highlighted: false },
    { href: "/faq", label: t("nav.faq"), highlighted: false },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-sticky border-b border-border",
        "bg-bg/90 supports-[backdrop-filter]:bg-bg/70 supports-[backdrop-filter]:backdrop-blur-md",
      )}
    >
      {/* Filete dorado superior: un pixel, y es lo que separa la cabecera del
          borde del navegador cuando la pagina esta arriba del todo. */}
      <div aria-hidden="true" className="lsw-gold-rule" />

      <div className="lsw-container grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-3 sm:gap-4">
        {/* --- Izquierda: navegacion --- */}
        <div className="flex min-w-0 items-center justify-start">
          <MobileNav
            destinations={destinations}
            menuLabel={t("nav.menu")}
            closeLabel={t("nav.closeMenu")}
            title={t("a11y.mobileNavigation")}
          />

          <nav aria-label={t("a11y.primaryNavigation")} className="hidden xl:block">
            <ul className="flex items-center gap-1">
              {destinations.map((destination) => (
                <li key={destination.href}>
                  <Link
                    href={destination.href}
                    className={cn(
                      NAV_LINK,
                      FOCUS,
                      destination.highlighted
                        ? "text-brand hover:bg-brand/12"
                        : "text-text-muted hover:bg-brand/10 hover:text-brand",
                    )}
                  >
                    {destination.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* --- Centro: marca --- */}
        <Link href="/" className={cn("justify-self-center rounded-md", FOCUS)}>
          <BrandLockup size="md" wordmark="sm-up" />
        </Link>

        {/* --- Derecha: acciones --- */}
        <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-2">
          {/* El conmutador de idioma sale de la cabecera en telefono y vive en
              el panel de navegacion. En 360px, hamburguesa + marca + dos
              enlaces de idioma + carrito no caben en una fila, y la cabecera se
              partia en tres. */}
          <LanguageSwitcher className="hidden xl:flex" />

          <Link href="/cart" className={cn(CART_LINK, FOCUS)}>
            <CartIcon />
            {/* El rotulo solo aparece cuando hay sitio. Por debajo de `sm` el
                icono se queda solo y el nombre accesible lo aporta el texto
                oculto, no un `aria-label`: asi sigue funcionando con control por
                voz y con los traductores del navegador. */}
            <span className="sr-only sm:not-sr-only">{t("nav.cart")}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function CartIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0"
    >
      <path
        d="M2.5 3h1.7l1.9 8.6a1.4 1.4 0 0 0 1.4 1.1h6.2a1.4 1.4 0 0 0 1.4-1.1L16.5 6H5.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="16" r="1.2" fill="currentColor" />
      <circle cx="14" cy="16" r="1.2" fill="currentColor" />
    </svg>
  );
}

const NAV_LINK = cn(
  "lsw-display inline-flex min-h-touch items-center whitespace-nowrap rounded-md px-3",
  "text-body-sm font-medium transition-colors duration-fast ease-standard",
);

const CART_LINK = cn(
  "inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-md border border-brand/45 px-2 sm:px-3",
  "lsw-display text-body-sm font-medium text-brand",
  "transition-colors duration-fast ease-standard hover:border-brand hover:bg-brand/12",
);

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
