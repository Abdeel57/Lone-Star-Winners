import { cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { BrandLockup } from "./brand-lockup";
import { LanguageSwitcher } from "./language-switcher";

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
 * COMPOSICION (DEC-038)
 * ---------------------
 * Fija arriba, sobre un negro semitransparente con desenfoque: al hacer scroll,
 * el contenido pasa POR DEBAJO de la marca en vez de empujarla fuera. Es lo que
 * hace que la identidad este siempre presente sin ocupar sitio.
 *
 * UNA SOLA NAVEGACION, DOS COLOCACIONES
 * -------------------------------------
 * En escritorio va en la misma fila que la marca. Por debajo de `lg` pasa a una
 * segunda fila que se desplaza horizontalmente dentro de SU caja. La
 * alternativa habitual -renderizar dos `<nav>` y ocultar uno con `hidden`-
 * duplicaria todos los enlaces en el arbol de accesibilidad. Aqui hay un unico
 * elemento que cambia de sitio con `order` y `width`.
 */
export async function SiteHeader() {
  const t = await getTranslations();

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

      <div className="lsw-container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <Link href="/" className={cn("mr-auto rounded-md", FOCUS)}>
          <BrandLockup size="md" wordmark="sm-up" />
        </Link>

        <nav
          aria-label={t("a11y.primaryNavigation")}
          className={cn(
            "order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4",
            "border-t border-border/70 pt-2",
            "lg:order-none lg:mx-0 lg:w-auto lg:overflow-visible lg:border-0 lg:pt-0",
          )}
        >
          <ul className="flex items-center gap-1 whitespace-nowrap">
            <li>
              <Link href="/shop" className={cn(NAV_LINK, FOCUS)}>
                {t("nav.shop")}
              </Link>
            </li>
            <li>
              <Link href="/promotions" className={cn(NAV_LINK, FOCUS)}>
                {t("nav.promotions")}
              </Link>
            </li>
            <li>
              <Link href="/official-rules" className={cn(NAV_LINK, FOCUS)}>
                {t("nav.officialRules")}
              </Link>
            </li>
            <li>
              <Link href="/faq" className={cn(NAV_LINK, FOCUS)}>
                {t("nav.faq")}
              </Link>
            </li>
          </ul>
        </nav>

        <LanguageSwitcher />

        {/* El carrito sale de la navegacion y se convierte en accion: es lo
            unico de la cabecera que lleva estado del visitante, y mezclarlo con
            los enlaces de contenido lo escondia. */}
        <Link href="/cart" className={cn(CART_LINK, FOCUS)}>
          <CartIcon />
          {t("nav.cart")}
        </Link>
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
      className="h-4 w-4 shrink-0"
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
  "lsw-display inline-flex min-h-touch items-center rounded-md px-3",
  "text-body-sm font-medium text-text-muted transition-colors duration-fast ease-standard",
  "hover:bg-brand/10 hover:text-brand",
);

const CART_LINK = cn(
  "inline-flex min-h-touch items-center gap-2 rounded-md border border-brand/45 px-3",
  "lsw-display text-body-sm font-medium text-brand",
  "transition-colors duration-fast ease-standard hover:border-brand hover:bg-brand/12",
);

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
