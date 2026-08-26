import { cn } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

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
 */
export async function SiteFooter({ showMockNotice }: { readonly showMockNotice: boolean }) {
  const t = await getTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-s16 border-t border-border bg-surface">
      <div className="lsw-container flex flex-col gap-s4 py-s6 text-body-sm text-text-muted">
        <nav aria-label={t("a11y.footerNavigation")}>
          <ul className="flex flex-wrap gap-x-s5 gap-y-2">
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

        <p className="text-body-sm text-text-muted">{t("footer.legalNote")}</p>

        {/* El ano va como cadena a proposito: un numero en ICU se formatea con
            separador de miles y saldria "2,026". */}
        <p>{t("footer.copyright", { year: String(year) })}</p>

        {showMockNotice ? (
          <p className="text-caption text-text-subtle">{t("footer.mockDataNotice")}</p>
        ) : null}
      </div>
    </footer>
  );
}

const FOOTER_LINK = cn(
  "inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted underline underline-offset-4",
  "hover:text-text",
  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
);
