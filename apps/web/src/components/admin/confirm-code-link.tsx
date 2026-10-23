"use client";

import { type ButtonSize, type ButtonVariant, buttonVariants } from "@lsw/ui";
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
 *
 * DOS SITIOS, UN SOLO ENLACE. En la cabecera va discreto (`ghost`, `sm`) porque
 * casi nunca hace falta. Dentro del aviso de `STEP_UP_REQUIRED` (`StepUpPrompt`)
 * va como accion principal y con `anchor`: el destino de vuelta lleva el `#` de
 * la seccion desde la que se pidio, para aterrizar otra vez en el formulario y
 * no en lo alto de la ficha. El href se construye en un unico sitio para que
 * los dos no puedan divergir.
 */
export function ConfirmCodeLink({
  locale,
  label,
  variant = "ghost",
  size = "sm",
  anchor,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** `id` de la seccion a la que volver, sin `#`. */
  readonly anchor?: string;
}) {
  // `null` cuando no hay router (prerender, pruebas): se vuelve a la portada.
  const pathname: string | null = usePathname();
  const here = pathname?.startsWith("/admin/") === true ? pathname : null;
  const back =
    here === null ? adminHref(locale) : anchor === undefined ? here : `${here}#${anchor}`;

  return (
    <Link
      href={`${adminHref(locale, "/mfa")}?next=${encodeURIComponent(back)}`}
      className={buttonVariants({ variant, size })}
    >
      {label}
    </Link>
  );
}
