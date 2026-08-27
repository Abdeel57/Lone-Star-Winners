import { buttonVariants, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AdminAccessFrame } from "@/components/admin/admin-chrome";
import { adminHref } from "@/i18n/admin-routing";
import { FALLBACK_LOCALE } from "@/i18n/locales";

/**
 * 404 del panel.
 *
 * EXISTE PORQUE EL PANEL TIENE SU PROPIO LAYOUT RAIZ (DEC-048). Sin este
 * fichero, un `notFound()` bajo `/admin` buscaria un `not-found` mas arriba, y
 * el que hay vive dentro de `app/[locale]`, que es otro arbol con otro `<html>`.
 *
 * NO PUEDE LEER EL LOCALE DE LA RUTA: un `not-found` no recibe `params`. Se
 * sirve en el idioma de desempate y ofrece volver al panel, que si redirige por
 * negociacion. Es una pantalla de dos frases; la alternativa -inventar un
 * segmento de idioma a partir de una URL que ya se sabe invalida- no mejora
 * nada.
 */
export default async function AdminNotFound() {
  const t = await getTranslations({ locale: FALLBACK_LOCALE, namespace: "admin.notFound" });

  return (
    <AdminAccessFrame locale={FALLBACK_LOCALE}>
      <EmptyState
        headingLevel="h1"
        title={t("title")}
        description={t("body")}
        action={
          <Link href={adminHref(FALLBACK_LOCALE)} className={buttonVariants({ variant: "accent" })}>
            {t("cta")}
          </Link>
        }
      />
    </AdminAccessFrame>
  );
}
