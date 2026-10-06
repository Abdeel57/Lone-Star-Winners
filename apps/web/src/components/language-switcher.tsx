"use client";

import { cn } from "@lsw/ui";
import { useLocale, useTranslations } from "next-intl";

import { LOCALES } from "@/i18n/locales";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Conmutador de idioma.
 *
 * Tres decisiones que importan:
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
 * 3. **Cada idioma se nombra en SU idioma** ("English", "Español") y con su
 *    `lang`, en cualquier pagina. Quien no entiende el idioma en que esta la
 *    pagina reconoce el suyo escrito como lo escribe el; y el lector de
 *    pantalla lo pronuncia bien en vez de leer "English" con fonetica
 *    espanola. Los nombres salen de los diccionarios (`localeName`), asi que el
 *    test de paridad tambien los cubre.
 *
 * FORMA DE INTERRUPTOR (DEC-081)
 * ------------------------------
 * Una pastilla con las dos opciones y la actual RELLENA en oro: se ve de un
 * vistazo que es un control de dos posiciones y cual esta puesta, cosa que dos
 * palabras sueltas en caja alta no decian. La pastilla mide 32px para no
 * engordar la franja superior; el area de pulsacion llega a 44px con un
 * pseudo-elemento invisible (`before:`), que es lo que cuenta en un telefono.
 *
 * `showLabel` antepone un globo y la palabra "Idioma"/"Language". Va
 * `aria-hidden` porque el `<nav>` ya se llama asi: anunciarlo dos veces seria
 * ruido. Es para quien mira la franja superior y busca donde se cambia.
 */
export function LanguageSwitcher({
  className,
  showLabel = false,
}: {
  readonly className?: string;
  readonly showLabel?: boolean;
}) {
  // `useLocale` ya devuelve `Locale` gracias a `AppConfig` en `src/global.d.ts`.
  const current = useLocale();
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <nav
      aria-label={t("a11y.languageSwitcher")}
      className={cn("flex items-center gap-2.5", className)}
    >
      {showLabel ? (
        <span aria-hidden="true" className="flex items-center gap-1.5 text-body-sm text-text-muted">
          <GlobeIcon />
          {t("a11y.languageSwitcher")}
        </span>
      ) : null}

      <ul className="flex items-center gap-0.5 rounded-full border border-border-strong bg-bg p-0.5">
        {LOCALES.map((locale) => {
          const isCurrent = locale === current;

          return (
            <li key={locale}>
              <Link
                href={pathname}
                locale={locale}
                lang={locale}
                hrefLang={locale}
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "relative inline-flex h-8 items-center rounded-full px-3.5 text-body-sm",
                  // Area tactil de 44px sin cambiar el tamano visible.
                  "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
                  "transition-colors duration-fast ease-standard",
                  "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  isCurrent
                    ? "bg-brand font-semibold text-on-brand"
                    : "font-medium text-text-muted hover:bg-surface-raised hover:text-text",
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

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4 shrink-0"
    >
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.75 10h14.5M10 2.75c2 2 3 4.4 3 7.25s-1 5.25-3 7.25c-2-2-3-4.4-3-7.25s1-5.25 3-7.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
