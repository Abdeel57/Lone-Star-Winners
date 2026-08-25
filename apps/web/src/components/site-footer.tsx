import { getTranslations } from "next-intl/server";

/**
 * Pie del sitio.
 *
 * En este hito no lleva enlaces legales (Official Rules, Privacy, Terms): esas
 * paginas todavia no existen y su contenido lo aprueba el abogado del cliente
 * (CLAUDE.md #1). Poner un enlace roto a las Reglas Oficiales seria peor que no
 * ponerlo.
 *
 * El aviso de datos simulados solo aparece fuera de produccion, y esta ahi para
 * que nadie confunda un fixture con una cifra real de participaciones.
 */
export async function SiteFooter({ showMockNotice }: { readonly showMockNotice: boolean }) {
  const t = await getTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-s16 border-t border-border bg-surface">
      <div className="lsw-container flex flex-col gap-2 py-s6 text-body-sm text-text-muted">
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
