"use client";

import { Button, cn, Drawer, IconButton } from "@lsw/ui";
import { useState } from "react";

import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/auth-actions";

/**
 * Un destino del menu de cuenta, ya traducido.
 *
 * Misma regla que `MobileNav`: el texto se resuelve en la cabecera, que es un
 * Server Component, y llega por props. Este componente no va a buscar
 * traducciones por su cuenta.
 */
export interface AccountDestination {
  readonly href: string;
  readonly label: string;
}

/**
 * Menu de cuenta de la cabecera.
 *
 * POR QUE UN PANEL Y NO UN DESPLEGABLE
 * ------------------------------------
 * El mismo razonamiento que llevo la navegacion principal a un `Drawer`: Radix
 * atrapa y devuelve el foco, cierra con `Escape`, y desmonta el contenido al
 * cerrarse, de modo que los enlaces no existen dos veces en el arbol de
 * accesibilidad. Un desplegable posicionado a mano tendria que reimplementar
 * las tres cosas, y ademas se sale de la pantalla en un telefono.
 *
 * Entra por la DERECHA, que es el lado donde esta su boton -y el contrario al
 * de la navegacion principal, para que los dos paneles no parezcan el mismo.
 *
 * EL CIERRE DE SESION ES UN `<form>`, NO UN ENLACE
 * ------------------------------------------------
 * Cerrar sesion cambia estado en el servidor, y eso no se hace con un `GET`: un
 * enlace lo dispararia cualquier precargador, cualquier previsualizador de
 * enlaces y cualquier antivirus corporativo que siga las URL de una pagina. Con
 * un formulario, ademas, funciona sin JavaScript.
 */
export function AccountMenu({
  locale,
  label,
  closeLabel,
  signOutLabel,
  accountName,
  destinations,
}: {
  readonly locale: string;
  /** Nombre accesible del boton y titulo del panel, ya traducido. */
  readonly label: string;
  readonly closeLabel: string;
  readonly signOutLabel: string;
  /** Como se llama quien ha entrado. Es un dato, no copy: no se traduce. */
  readonly accountName: string;
  readonly destinations: readonly AccountDestination[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        variant="ghost"
        label={label}
        icon={<AccountIcon />}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
        className="text-text hover:text-brand"
      />

      <Drawer open={open} onOpenChange={setOpen} side="right" title={label} closeLabel={closeLabel}>
        {/* El nombre o el correo de quien ha entrado. Es la unica forma de
            confirmar de un vistazo con que cuenta se esta operando, que importa
            en un dispositivo compartido. */}
        <p className="mb-s5 break-words text-body-sm text-text-muted">{accountName}</p>

        <nav aria-label={label}>
          <ul className="flex flex-col gap-1">
            {destinations.map((destination) => (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                  className={cn(
                    "lsw-display flex min-h-touch items-center rounded-md border-l-2 px-4 py-3",
                    "border-transparent text-heading-sm text-text transition-colors duration-fast ease-standard",
                    "hover:border-brand/50 hover:text-brand",
                    "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                  )}
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <form action={logoutAction} className="mt-s6 border-t border-border pt-s5">
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="secondary" size="md" fullWidth>
            {signOutLabel}
          </Button>
        </form>
      </Drawer>
    </>
  );
}

function AccountIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0"
    >
      <circle cx="10" cy="6.75" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.75 17c0-3.2 2.8-5.25 6.25-5.25S16.25 13.8 16.25 17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** El mismo icono, para el enlace de quien todavia no ha entrado. */
export function AccountGlyph() {
  return <AccountIcon />;
}
