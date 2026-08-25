import { buttonVariants, EmptyState } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * 404 dentro de un idioma.
 *
 * Vive bajo `[locale]` para que el usuario no pierda su idioma justo cuando ya
 * se ha perdido de pagina. El middleware garantiza que toda ruta llega con
 * prefijo, asi que este es el 404 que se ve.
 *
 * La accion es un enlace con aspecto de boton, no un `<button>`: navega, y
 * envolver un enlace dentro de un boton romperia la semantica y la navegacion
 * por teclado.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("notFound");

  return (
    <div className="lsw-container py-s16">
      <EmptyState
        headingLevel="h1"
        title={t("title")}
        description={t("body")}
        action={
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            {t("backHome")}
          </Link>
        }
      />
    </div>
  );
}
