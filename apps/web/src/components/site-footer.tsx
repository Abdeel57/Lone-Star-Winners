import { buttonVariants, cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { BrandLockup } from "./brand-lockup";
import { FooterDisclosure } from "./footer-disclosure";
import { LanguageSwitcher } from "./language-switcher";

/**
 * Pie del sitio.
 *
 * Lleva el enlace a las Reglas Oficiales porque en un producto de sweepstakes
 * ese documento tiene que estar a un clic desde cualquier pantalla, no solo
 * desde la promocion. `Privacy` y `Terms` NO estan: esos documentos todavia no
 * existen y su contenido lo aprueba el abogado del cliente (CLAUDE.md #1).
 * Enlazarlos vacios seria peor que no enlazarlos.
 *
 * El aviso de datos simulados solo aparece fuera de produccion, y esta ahi para
 * que nadie confunda un fixture con una cifra real de participaciones.
 *
 * ---------------------------------------------------------------------------
 * COMPOSICION (segunda pasada de DEC-038)
 * ---------------------------------------------------------------------------
 * Cuatro cosas cambian respecto de la version anterior, y las cuatro salen de
 * la referencia visual:
 *
 * 1. **Patron topografico de fondo**, como en el resto de superficies oscuras.
 *    Es lo que impide que el bloque mas alto de la pagina sea un rectangulo
 *    negro vacio.
 * 2. **Grupos plegables en telefono** (`FooterDisclosure`). Un pie de tres
 *    columnas en 360px son quince enlaces apilados y media pantalla de scroll;
 *    plegado son tres lineas.
 * 3. **Bloque destacado de Reglas Oficiales**, con filete y titular en caja
 *    alta. Ya estaba el texto legal, pero como una linea mas entre otras: en un
 *    producto donde ese documento es lo que gobierna, tratarlo como una nota al
 *    pie era una decision equivocada.
 * 4. **Fila de cierre** con pais, idioma y copyright, que es donde la
 *    referencia pone su bandera.
 */
export async function SiteFooter({ showMockNotice }: { readonly showMockNotice: boolean }) {
  const t = await getTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="lsw-topo mt-s20 bg-surface-sunken">
      <div aria-hidden="true" className="lsw-gold-rule" />

      <div className="lsw-container py-s12">
        <div className="grid gap-s10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] lg:gap-s12">
          <div className="max-w-narrow">
            <BrandLockup size="lg" />
            <p className="mt-s5 text-body-md text-text-muted">{t("brand.tagline")}</p>
          </div>

          {/* Los tres grupos. En escritorio son tres columnas siempre abiertas;
              en telefono, tres cabeceras plegables. */}
          <nav
            aria-label={t("a11y.footerNavigation")}
            className="grid gap-s2 sm:grid-cols-3 sm:gap-s8"
          >
            <FooterDisclosure title={t("nav.shop")}>
              <ul className="flex flex-col gap-1 pt-s2">
                <li>
                  <Link href="/shop" className={FOOTER_LINK}>
                    {t("shop.title")}
                  </Link>
                </li>
                <li>
                  <Link href="/cart" className={FOOTER_LINK}>
                    {t("nav.cart")}
                  </Link>
                </li>
              </ul>
            </FooterDisclosure>

            <FooterDisclosure title={t("nav.promotions")}>
              <ul className="flex flex-col gap-1 pt-s2">
                <li>
                  <Link href="/promotions" className={FOOTER_LINK}>
                    {t("promotion.listHeading")}
                  </Link>
                </li>
                <li>
                  <Link href="/official-rules" className={FOOTER_LINK}>
                    {t("nav.officialRules")}
                  </Link>
                </li>
              </ul>
            </FooterDisclosure>

            <FooterDisclosure title={t("footer.help")}>
              <ul className="flex flex-col gap-1 pt-s2">
                <li>
                  <Link href="/faq" className={FOOTER_LINK}>
                    {t("nav.faq")}
                  </Link>
                </li>
              </ul>
            </FooterDisclosure>
          </nav>
        </div>

        {/* Bloque destacado de Reglas Oficiales. */}
        <section
          aria-labelledby="footer-rules"
          className="mt-s10 border border-brand/35 bg-bg/40 p-s6 sm:p-s8"
        >
          <div className="flex flex-col gap-s5 lg:flex-row lg:items-center lg:justify-between lg:gap-s10">
            <div className="max-w-narrow">
              <h2 id="footer-rules" className="lsw-display text-heading-md text-brand">
                {t("nav.officialRules")}
              </h2>
              <p className="mt-s3 text-body-sm text-text-muted">{t("footer.rulesBlockBody")}</p>
            </div>

            <Link
              href="/official-rules"
              className={cn("shrink-0", buttonVariants({ variant: "secondary", size: "lg" }))}
            >
              {t("footer.rulesBlockCta")}
            </Link>
          </div>
        </section>

        <div className="mt-s10 border-t border-border pt-s6">
          <div className="flex flex-col gap-s5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* La bandera es DECORACION: el pais va escrito al lado como
                  texto. Un emoji como unica senal se anuncia de formas
                  distintas segun el lector de pantalla y no siempre se
                  renderiza. */}
              <span className="flex items-center gap-2 text-body-sm text-text-muted">
                <span aria-hidden="true">🇺🇸</span>
                {t("footer.country")}
              </span>

              <LanguageSwitcher />
            </div>

            <div className="flex flex-col gap-s2 text-body-sm text-text-muted">
              <p>{t("footer.legalNote")}</p>

              {/* El ano va como cadena a proposito: un numero en ICU se formatea
                  con separador de miles y saldria "2,026". */}
              <p className="text-text-subtle">{t("footer.copyright", { year: String(year) })}</p>

              {showMockNotice ? (
                <p className="text-caption text-text-subtle">{t("footer.mockDataNotice")}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

const FOOTER_LINK = cn(
  "inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted",
  "transition-colors duration-fast ease-standard hover:text-brand",
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
);
