"use client";

import { buttonVariants } from "@lsw/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { adminHref } from "@/i18n/admin-routing";
import type { Locale } from "@/i18n/locales";

/**
 * "Confirmar codigo": renovar el segundo factor sin cerrar sesion.
 *
 * Las acciones con step-up -activar o cerrar una promocion, activar reglas,
 * aprobar un cambio, devolver un pago- exigen un codigo escrito hace pocos
 * minutos (`STEP_UP_MAX_AGE_SECONDS`). `POST /auth/mfa/verify` lo renueva con la
 * sesion ya abierta, pero el panel no ofrecia como llegar ahi: la unica salida
 * era cerrar sesion y volver a entrar.
 *
 * Es de cliente solo para leer la ruta actual y volver a ELLA despues del
 * codigo, no a la seccion: quien estaba en la ficha de una promocion tiene que
 * aterrizar en esa ficha para pulsar "Activar".
 */
export function ConfirmCodeLink({
  locale,
  label,
}: {
  readonly locale: Locale;
  readonly label: string;
}) {
  const pathname = usePathname();
  const back = pathname.startsWith("/admin/") ? pathname : adminHref(locale);

  return (
    <Link
      href={`${adminHref(locale, "/mfa")}?next=${encodeURIComponent(back)}`}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      {label}
    </Link>
  );
}
