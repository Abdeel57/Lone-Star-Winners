import { buttonVariants, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { ApiErrorState } from "@/components/api-error-state";
import { adminHref } from "@/i18n/admin-routing";
import type { Locale } from "@/i18n/locales";
import type { AdminActor } from "@/lib/admin/capabilities";
import { can } from "@/lib/admin/capabilities";
import type { AdminNavKey } from "@/lib/admin/navigation";
import { loadAdminSession } from "@/lib/admin/session-server";
import type { AdminCapability, ApiFailure, SessionContext } from "@/lib/api";

import { AdminAccessFrame, AdminChrome } from "./admin-chrome";

/**
 * Apertura de una pantalla del panel.
 *
 * POR QUE ES UNA FUNCION Y NO UN COMPONENTE ENVOLVENTE
 * ----------------------------------------------------
 * Un `<AdminGuard>` que envolviera a la pantalla tendria que renderizar a sus
 * hijos SIEMPRE -React no puede "no evaluar" a un hijo ya construido-, y eso
 * significa que la pantalla habria pedido sus datos antes de saber si el actor
 * tiene derecho a verlos. Con una funcion, la pagina no llama a ningun `fetch`
 * hasta que esta autorizada, que es la unica forma de que una pantalla sin
 * permiso no genere trafico contra el backend.
 *
 * DEVUELVE UNA DE DOS COSAS y quien llama tiene que decidir explicitamente:
 * el nodo ya renderizado del estado bloqueado, o el actor y su sesion.
 *
 * LOS CINCO ESTADOS BLOQUEADOS SE PINTAN DISTINTO A PROPOSITO
 * -----------------------------------------------------------
 * Sin sesion, sesion a medias, sesion de cliente, error de lectura y falta de
 * capacidad son cinco situaciones con cinco respuestas correctas distintas.
 * Colapsarlas en "no autorizado" manda a la persona equivocada a hacer lo
 * equivocado: a teclear una contrasena que ya tiene, a llamar a soporte por un
 * fallo de red, o a pedir un permiso que si tiene.
 */

export type AdminScreenResult =
  | {
      readonly ok: true;
      readonly session: SessionContext;
      readonly actor: AdminActor;
    }
  | { readonly ok: false; readonly node: ReactNode };

export async function openAdminScreen(options: {
  readonly locale: Locale;
  /** Entrada de navegacion que corresponde a esta pantalla. */
  readonly current: AdminNavKey;
  /** Ruta INTERNA del panel, para poder volver aqui tras iniciar sesion. */
  readonly path: string;
  /** Titulo ya traducido, para el marco cuando falta la capacidad. */
  readonly title: string;
  /**
   * Capacidad minima para ver la pantalla. `null` en las que no exigen ninguna
   * concreta -no hay ninguna hoy, y el hueco existe para no forzar una
   * capacidad inventada el dia que aparezca una pantalla puramente informativa.
   */
  readonly capability: AdminCapability | null;
}): Promise<AdminScreenResult> {
  const { locale, current, path, title, capability } = options;
  const { session, state } = await loadAdminSession(locale);

  if (state.kind === "anonymous") {
    return { ok: false, node: <StaffSignInRequired locale={locale} returnPath={path} /> };
  }

  if (state.kind === "mfaPending") {
    return { ok: false, node: <StaffMfaRequired locale={locale} returnPath={path} /> };
  }

  if (state.kind === "notStaff") {
    return { ok: false, node: <NotStaffNotice locale={locale} /> };
  }

  if (state.kind === "unavailable") {
    return { ok: false, node: <AdminUnavailable locale={locale} failure={state.failure} /> };
  }

  const { actor } = state;

  if (capability !== null && !can(actor, capability)) {
    return {
      ok: false,
      node: (
        <AdminChrome locale={locale} actor={actor} current={current} title={title}>
          <CapabilityDenied locale={locale} capability={capability} />
        </AdminChrome>
      ),
    };
  }

  return { ok: true, session, actor };
}

/**
 * Sin sesion.
 *
 * NO ES UN ERROR. Es el estado normal de cualquiera que abra el panel por la
 * manana, y tambien el de quien vuelve tras las ocho horas de TTL absoluto de
 * una sesion de personal (DEC-006).
 */
export async function StaffSignInRequired({
  locale,
  returnPath,
}: {
  readonly locale: Locale;
  readonly returnPath: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.access" });
  const destination = adminHref(locale, returnPath);

  return (
    <AdminAccessFrame locale={locale}>
      <EmptyState
        headingLevel="h1"
        title={t("signInTitle")}
        description={t("signInBody")}
        action={
          <Link
            href={`${adminHref(locale, "/login")}?next=${encodeURIComponent(destination)}`}
            className={buttonVariants({ variant: "accent" })}
          >
            {t("signInCta")}
          </Link>
        }
      />
    </AdminAccessFrame>
  );
}

/**
 * `MFA_PENDING`.
 *
 * NO ES UNA SESION MEDIO ABIERTA y no ensena NADA del panel: ni el correo, ni
 * los roles, ni una cifra. El contrato lo dice sin rodeos -es una sesion que
 * "todavia no vale para nada" salvo para completar el segundo factor-, y una
 * pantalla que mostrara algo aqui abriria en la interfaz una puerta que el
 * backend tiene cerrada.
 */
export async function StaffMfaRequired({
  locale,
  returnPath,
}: {
  readonly locale: Locale;
  readonly returnPath: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.access" });
  const destination = adminHref(locale, returnPath);

  return (
    <AdminAccessFrame locale={locale}>
      <EmptyState
        headingLevel="h1"
        title={t("mfaTitle")}
        description={t("mfaBody")}
        action={
          <Link
            href={`${adminHref(locale, "/mfa")}?next=${encodeURIComponent(destination)}`}
            className={buttonVariants({ variant: "accent" })}
          >
            {t("mfaCta")}
          </Link>
        }
      />
    </AdminAccessFrame>
  );
}

/**
 * Sesion valida, pero de PARTICIPANTE.
 *
 * OCURRE A DIARIO, no es un caso raro: la cookie del escaparate tiene `Path=/`,
 * asi que viaja tambien a `/admin`, y cualquiera que escriba la URL con su
 * sesion de cliente abierta cae aqui.
 *
 * SE RESPONDE CON UN 403 DELIBERADO Y NO CON EL FORMULARIO DE PERSONAL.
 * Ofrecer un login de administracion a quien acaba de demostrar que tiene una
 * cuenta valida es invitar a probar credenciales, y ademas confirmaria que el
 * panel existe y donde esta. Lo unico que se ofrece es volver a la tienda.
 */
export async function NotStaffNotice({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "admin.access" });

  return (
    <AdminAccessFrame locale={locale}>
      <EmptyState
        headingLevel="h1"
        title={t("notStaffTitle")}
        description={t("notStaffBody")}
        action={
          <Link href={`/${locale}`} className={buttonVariants({ variant: "secondary" })}>
            {t("backToStore")}
          </Link>
        }
      />
    </AdminAccessFrame>
  );
}

/** La lectura de sesion fallo. Es un error, y se distingue de no tener sesion. */
export function AdminUnavailable({
  locale,
  failure,
}: {
  readonly locale: Locale;
  readonly failure: ApiFailure;
}) {
  return (
    <AdminAccessFrame locale={locale}>
      <ApiErrorState failure={failure} headingLevel="h1" />
    </AdminAccessFrame>
  );
}

/**
 * Falta la capacidad.
 *
 * Se dice CUAL falta, con su identificador tecnico. En el escaparate eso seria
 * inaceptable -una clave en pantalla delante de un cliente-, pero aqui el
 * identificador es exactamente lo que quien opera necesita para pedir el
 * permiso correcto a quien administra los roles, y lo que evita el ticket de
 * "no puedo entrar en una pantalla".
 */
export async function CapabilityDenied({
  locale,
  capability,
}: {
  readonly locale: Locale;
  readonly capability: AdminCapability;
}) {
  const t = await getTranslations({ locale, namespace: "admin.access" });

  return (
    <EmptyState
      headingLevel="h2"
      title={t("forbiddenTitle")}
      description={t("forbiddenBody", { capability })}
    />
  );
}
