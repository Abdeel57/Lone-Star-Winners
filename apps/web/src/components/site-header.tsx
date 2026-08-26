import { cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

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
 * `Shop` y `Cart` entran con FE-M3, que es cuando esas dos rutas existen.
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
 */
export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="border-b border-border bg-surface">
      <div className="lsw-container flex min-h-touch flex-wrap items-center justify-between gap-3 py-3">
        <Link
          href="/"
          className={cn("rounded-md text-heading-sm font-semibold tracking-tight text-text", FOCUS)}
        >
          {t("brand.name")}
        </Link>

        <div className="flex items-center gap-1">
          <nav aria-label={t("a11y.primaryNavigation")}>
            <ul className="flex flex-wrap items-center gap-1">
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
              <li>
                <Link href="/cart" className={cn(NAV_LINK, FOCUS)}>
                  {t("nav.cart")}
                </Link>
              </li>
            </ul>
          </nav>

          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

const NAV_LINK =
  "inline-flex min-h-touch items-center rounded-md px-3 text-body-sm text-text-muted hover:bg-surface-sunken hover:text-text";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
