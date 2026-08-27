import { Badge, Button, cn } from "@lsw/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { adminHref } from "@/i18n/admin-routing";
import type { Locale } from "@/i18n/locales";
import { staffLogoutAction } from "@/lib/admin/actions";
import type { AdminActor } from "@/lib/admin/capabilities";
import { visibleNavFor, type AdminNavKey } from "@/lib/admin/navigation";

import { AdminLanguageSwitcher } from "./admin-language-switcher";

/**
 * Cromo del panel: cabecera, navegacion por capacidad y contenedor.
 *
 * UN SOLO SITIO DONDE SE DECIDE QUE VE CADA ACTOR
 * -----------------------------------------------
 * La navegacion se deriva de `visibleNavFor(actor)`, que consulta capacidades y
 * no roles. Ninguna pantalla pinta su propio menu, y por eso no puede existir
 * una que ensene un enlace que las demas ocultan.
 *
 * Ocultar NO es autorizar: quien escriba la URL llega igual y recibe el 403 del
 * backend, pintado como estado deliberado. Esto existe para no mandar a nadie a
 * una puerta cerrada.
 *
 * TEMA NEGRO Y ORO, EL MISMO DEL SITIO (DEC-038). El panel no tiene una paleta
 * propia: quien opera y quien compra miran el mismo producto, y dos sistemas
 * visuales significan dos sistemas que mantener. La BANDA CLARA
 * (`lsw-panel-light`) se reserva para las tablas densas, donde texto oscuro
 * sobre claro se lee mejor en jornadas largas (DEC-039).
 */

/** Identidad del actor: correo y roles. Nunca su nombre de pila. */
async function AdminIdentity({
  actor,
  locale,
}: {
  readonly actor: AdminActor;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.chrome" });

  return (
    <div className="flex min-w-0 flex-col items-end">
      <span className="truncate text-body-sm text-text" title={actor.email}>
        {actor.email}
      </span>

      <span className="flex flex-wrap justify-end gap-1">
        {actor.roles.length === 0 ? (
          <span className="text-caption text-text-subtle">{t("noRoles")}</span>
        ) : (
          actor.roles.map((role) => (
            <Badge key={role} tone="brand" size="sm" emphasis="subtle">
              {role}
            </Badge>
          ))
        )}
      </span>
    </div>
  );
}

/**
 * Boton de cierre de sesion.
 *
 * Es un `<form>` con Server Action y no un enlace: cerrar sesion CAMBIA estado
 * en el servidor -revoca la fila de sesion- y un `GET` que muta se dispara con
 * un prefetch del navegador o con la primera extension que precargue enlaces.
 */
function AdminLogout({ locale, label }: { readonly locale: Locale; readonly label: string }) {
  return (
    <form action={staffLogoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="secondary" size="sm">
        {label}
      </Button>
    </form>
  );
}

/**
 * Navegacion lateral.
 *
 * En pantallas anchas es una columna; en tableta y movil es una tira con scroll
 * horizontal PROPIO -no del documento- para que las secciones quepan sin
 * apilarse y sin empujar el ancho de la pagina.
 */
async function AdminNav({
  actor,
  locale,
  current,
}: {
  readonly actor: AdminActor;
  readonly locale: Locale;
  readonly current: AdminNavKey;
}) {
  const t = await getTranslations({ locale, namespace: "admin.nav" });
  const items = visibleNavFor(actor);

  return (
    <nav
      aria-label={t("label")}
      className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0"
    >
      <ul className="flex min-w-max list-none items-center gap-1 border-b border-border pb-s2 lg:min-w-0 lg:flex-col lg:items-stretch lg:border-b-0 lg:pb-0">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={adminHref(locale, item.path)}
              {...(item.key === current ? { "aria-current": "page" as const } : {})}
              className={cn(
                "lsw-display inline-flex min-h-touch w-full items-center whitespace-nowrap rounded-md px-3",
                "text-body-sm font-medium transition-colors duration-fast ease-standard",
                "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                item.key === current
                  ? "bg-brand/12 text-brand"
                  : "text-text-muted hover:bg-brand/10 hover:text-brand",
              )}
            >
              {t(item.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Cabecera del panel.
 *
 * Se usa TAMBIEN en las pantallas sin sesion -login y segundo factor-, sin
 * identidad ni navegacion: la marca y el idioma tienen que estar ahi antes de
 * entrar, y una pantalla de acceso sin conmutador de idioma deja fuera a la
 * mitad del personal.
 */
async function AdminHeader({
  locale,
  actor,
}: {
  readonly locale: Locale;
  readonly actor: AdminActor | null;
}) {
  const t = await getTranslations({ locale, namespace: "admin.chrome" });

  return (
    <header className="border-b border-border bg-surface">
      <div className="lsw-container flex flex-wrap items-center justify-between gap-s4 py-s4">
        <div className="flex min-w-0 items-baseline gap-s3">
          <Link
            href={adminHref(locale)}
            className={cn(
              "lsw-display text-heading-md uppercase tracking-wide text-brand",
              "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            )}
          >
            {t("brand")}
          </Link>

          <span className="text-caption uppercase tracking-wide text-text-subtle">
            {t("panelLabel")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-s4">
          <AdminLanguageSwitcher locale={locale} />

          {actor === null ? null : (
            <>
              <AdminIdentity actor={actor} locale={locale} />
              <AdminLogout locale={locale} label={t("signOut")} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Contenedor de una pantalla del panel CON sesion.
 *
 * `title` y `description` llegan ya traducidos: este componente no resuelve
 * copy de la pantalla que envuelve, porque entonces tendria que conocer todas.
 */
export async function AdminChrome({
  locale,
  actor,
  current,
  title,
  description,
  actions,
  children,
}: {
  readonly locale: Locale;
  readonly actor: AdminActor;
  readonly current: AdminNavKey;
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "admin.chrome" });

  return (
    <>
      <AdminHeader locale={locale} actor={actor} />

      <div className="lsw-container flex flex-1 flex-col gap-s6 py-s6 lg:flex-row lg:gap-s8 lg:py-s8">
        <div className="lg:w-56 lg:shrink-0">
          <AdminNav actor={actor} locale={locale} current={current} />
        </div>

        <main id="admin-main" aria-label={t("mainLandmark")} className="min-w-0 flex-1 pb-s12">
          <div className="flex flex-wrap items-start justify-between gap-s4">
            <div className="min-w-0">
              <h1 className="lsw-display text-display-sm text-text">{title}</h1>
              {description === undefined ? null : (
                <p className="mt-s2 max-w-prose text-body-sm text-text-muted">{description}</p>
              )}
            </div>

            {actions === undefined ? null : (
              <div className="flex items-center gap-s3">{actions}</div>
            )}
          </div>

          <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

          {/*
           * AVISO DE CAPACIDADES PROVISIONALES.
           *
           * Mientras el backend no publique `capabilities` en `SessionState`, el
           * panel las deriva de un espejo local de la matriz de
           * `packages/security`. Eso puede desincronizarse, y el sintoma seria
           * un enlace visible que responde 403 -o, peor, uno ausente que si
           * estaba permitido-. Se dice en pantalla en vez de dejarlo en un
           * comentario: quien opera tiene que saber que lo que ve es una
           * aproximacion.
           */}
          {actor.capabilitiesPublished ? null : (
            <p className="mt-s4 rounded-md border border-warning/40 bg-warning-subtle/20 px-3 py-2 text-caption text-text-muted">
              {t("provisionalCapabilities")}
            </p>
          )}

          <div className="mt-s6">{children}</div>
        </main>
      </div>
    </>
  );
}

/**
 * Contenedor de una pantalla del panel SIN sesion utilizable.
 *
 * Login, segundo factor, sesion de participante y error de lectura comparten
 * este marco: sin navegacion -no hay a donde navegar- y centrado, porque lo
 * unico que hay en pantalla es una accion.
 */
export async function AdminAccessFrame({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "admin.chrome" });

  return (
    <>
      <AdminHeader locale={locale} actor={null} />

      <main
        id="admin-main"
        aria-label={t("mainLandmark")}
        className="lsw-container flex flex-1 items-start justify-center py-s10 pb-s16"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
    </>
  );
}
