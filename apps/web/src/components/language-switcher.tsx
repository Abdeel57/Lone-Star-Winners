"use client";

import { cn } from "@lsw/ui";
import { useLocale, useTranslations } from "next-intl";

import { LOCALES, type Locale } from "@/i18n/locales";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Conmutador de idioma.
 *
 * Dos decisiones que importan:
 *
 * 1. **Conserva la ruta.** `usePathname` de next-intl devuelve la ruta SIN el
 *    prefijo de idioma, y `Link` vuelve a anadir el del idioma destino. Cambiar
 *    de idioma en `/es/account/entries` lleva a `/en/account/entries`, no a la
 *    portada. Que un participante pierda la pagina en la que estaba por cambiar
 *    de idioma es exactamente lo que DEC-021 quiere evitar.
 *
 * 2. **Son enlaces, no un menu.** Con dos idiomas, un `<nav>` con dos enlaces
 *    funciona sin JavaScript, es indexable y no necesita gestion de foco. El
 *    idioma actual se marca con `aria-current="true"`, no solo con color.
 *
 * El nombre de cada idioma sale de los diccionarios (`localeName`), que
 * contienen los dos nombres en ambos idiomas. Asi el test de paridad tambien
 * cubre este texto.
 */
export function LanguageSwitcher({ className }: { readonly className?: string }) {
  const current = useLocale() as Locale;
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <nav aria-label={t("a11y.languageSwitcher")} className={cn("flex items-center", className)}>
      <ul className="flex items-center gap-1">
        {LOCALES.map((locale) => {
          const isCurrent = locale === current;

          return (
            <li key={locale}>
              <Link
                href={pathname}
                locale={locale}
                hrefLang={locale}
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-touch items-center rounded-md px-3 text-body-sm",
                  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  isCurrent
                    ? "bg-brand-subtle font-semibold text-brand"
                    : "text-text-muted hover:bg-surface-sunken hover:text-text",
                )}
              >
                {locale === "en" ? t("localeName.en") : t("localeName.es")}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
