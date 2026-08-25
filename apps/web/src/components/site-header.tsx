import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { LanguageSwitcher } from "./language-switcher";

/**
 * Cabecera del sitio.
 *
 * En este hito solo lleva marca y conmutador de idioma. La navegacion de
 * producto (Shop, Current Promotion, How It Works, Winners, FAQ, cuenta,
 * carrito) llega en hitos posteriores, cuando existan las rutas: un enlace a
 * una pantalla que no existe es peor que no tener el enlace.
 */
export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="border-b border-border bg-surface">
      <div className="lsw-container flex min-h-touch items-center justify-between gap-4 py-3">
        <Link
          href="/"
          className="rounded-md text-heading-sm font-semibold tracking-tight text-text outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t("brand.name")}
        </Link>

        <LanguageSwitcher />
      </div>
    </header>
  );
}
