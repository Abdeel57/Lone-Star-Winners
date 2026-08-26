import { cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { BrandLockup } from "./brand-lockup";

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
 * COMPOSICION (DEC-038)
 * ---------------------
 * Es el cierre de la pagina y la segunda aparicion -mas grande- de la marca. El
 * filete dorado superior lo separa del ultimo bloque de contenido sin una linea
 * dura de lado a lado, y el fondo baja al negro mas profundo del sistema para
 * que la pagina termine, en vez de simplemente dejar de tener contenido.
 */
export async function SiteFooter({ showMockNotice }: { readonly showMockNotice: boolean }) {
  const t = await getTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-s20 bg-surface-sunken">
      <div aria-hidden="true" className="lsw-gold-rule" />

      <div className="lsw-container py-s12">
        <div className="flex flex-col gap-s8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-narrow">
            <BrandLockup size="lg" />
            <p className="mt-s5 text-body-md text-text-muted">{t("brand.tagline")}</p>
          </div>

          <nav aria-label={t("a11y.footerNavigation")} className="lg:pt-s2">
            <ul className="flex flex-col gap-1">
              <li>
                <Link href="/official-rules" className={FOOTER_LINK}>
                  {t("nav.officialRules")}
                </Link>
              </li>
              <li>
                <Link href="/shop" className={FOOTER_LINK}>
                  {t("nav.shop")}
                </Link>
              </li>
              <li>
                <Link href="/promotions" className={FOOTER_LINK}>
                  {t("nav.promotions")}
                </Link>
              </li>
              <li>
                <Link href="/faq" className={FOOTER_LINK}>
                  {t("nav.faq")}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-s10 border-t border-border pt-s6">
          <div className="flex flex-col gap-s3 text-body-sm text-text-muted">
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
    </footer>
  );
}

const FOOTER_LINK = cn(
  "lsw-display inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted",
  "transition-colors duration-fast ease-standard hover:text-brand",
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
);
