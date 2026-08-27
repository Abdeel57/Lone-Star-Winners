"use client";

import { cn } from "@lsw/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { ADMIN_BASE } from "@/i18n/admin-routing";
import { isLocale, LOCALES, type Locale } from "@/i18n/locales";

/**
 * Conmutador de idioma del PANEL.
 *
 * POR QUE NO SE REUTILIZA EL DEL ESCAPARATE
 * -----------------------------------------
 * Aquel usa `Link` y `usePathname` de `@/i18n/navigation`, que son los del
 * router de next-intl y trabajan con rutas SIN prefijo de idioma. El panel no
 * esta en ese router: su prefijo es `/admin/<locale>` y lo resuelve el
 * middleware por su cuenta (DEC-048). Usar alli el `Link` de next-intl
 * produciria `/es/admin/...`, que es exactamente la ruta en la que la cookie de
 * personal deja de viajar.
 *
 * Es la unica excepcion documentada a la regla de no importar `next/link`
 * directamente, y esta acotada al subarbol `/admin`.
 *
 * CONSERVA LA RUTA. Cambiar de idioma en `/admin/es/amoe` lleva a
 * `/admin/en/amoe`, no a la portada del panel: se sustituye UNICAMENTE el
 * segundo segmento. Y conserva la query, que en un listado paginado es el
 * cursor: perderlo devolveria a la primera pagina por cambiar de idioma.
 */
export function AdminLanguageSwitcher({
  locale,
  className,
}: {
  readonly locale: Locale;
  readonly className?: string;
}) {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <nav aria-label={t("a11y.languageSwitcher")} className={cn("flex items-center", className)}>
      <ul className="flex list-none items-center gap-1">
        {LOCALES.map((candidate) => {
          const isCurrent = candidate === locale;

          return (
            <li key={candidate}>
              <Link
                href={swapAdminLocale(pathname, candidate)}
                hrefLang={candidate}
                {...(isCurrent ? { "aria-current": "true" as const } : {})}
                className={cn(
                  "lsw-display inline-flex min-h-touch items-center rounded-md px-3 text-body-sm",
                  "transition-colors duration-fast ease-standard",
                  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  isCurrent
                    ? "border border-brand/45 bg-brand/12 font-semibold text-brand"
                    : "border border-transparent text-text-muted hover:text-brand",
                )}
              >
                {candidate === "en" ? t("localeName.en") : t("localeName.es")}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Sustituye el segmento de idioma de una ruta del panel.
 *
 * Si la ruta no tiene la forma esperada -algo que solo pasaria si este
 * componente se montara fuera de `/admin`- devuelve la portada del panel en el
 * idioma pedido, en vez de componer una ruta inventada.
 */
function swapAdminLocale(pathname: string, target: Locale): string {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "admin" || segments[1] === undefined || !isLocale(segments[1])) {
    return `${ADMIN_BASE}/${target}`;
  }

  const rest = segments.slice(2);
  return `${ADMIN_BASE}/${target}${rest.length === 0 ? "" : `/${rest.join("/")}`}`;
}
