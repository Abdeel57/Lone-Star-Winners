"use client";

import { cn } from "@lsw/ui";
import { useId, useState, type ReactNode } from "react";

/**
 * Un grupo del pie que se pliega en telefono y esta siempre abierto en
 * escritorio.
 *
 * POR QUE NO ES UN `<details>`
 * ----------------------------
 * Seria la solucion sin JavaScript, y no sirve: un `<details>` cerrado oculta
 * su contenido por decision del navegador y NO se puede reabrir desde CSS en un
 * punto de ruptura. O empieza abierto en los dos tamanos -y entonces en el
 * telefono el pie mide media pantalla, que es lo que se queria evitar- o
 * empieza cerrado en los dos, y en escritorio el pie queda reducido a tres
 * titulos.
 *
 * POR QUE NO HAY DESAJUSTE DE HIDRATACION
 * ---------------------------------------
 * El estado inicial es `false` en servidor y en cliente: no se consulta ninguna
 * media query en JavaScript, que es lo que produciria dos arboles distintos. La
 * diferencia entre tamanos la resuelve SOLO el CSS: el contenido lleva `hidden`
 * cuando esta plegado y `lg:block`, que gana en escritorio y lo muestra
 * independientemente del estado. El boton, a su vez, es `lg:hidden`, asi que en
 * escritorio no hay ningun control que prometa plegar algo que no se pliega.
 *
 * El titulo se escribe dos veces -como boton y como texto- y en cada tamano hay
 * exactamente uno visible; el otro esta en `display:none` y por tanto fuera del
 * arbol de accesibilidad. Es la unica forma de que el encabezado del grupo sea
 * un control donde controla algo y texto plano donde no.
 */
export function FooterDisclosure({
  title,
  children,
}: {
  /** Titulo del grupo, ya traducido. */
  readonly title: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="border-b border-border lg:border-b-0">
      <h3 className="lsw-display text-body-sm tracking-wide text-text">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen((current) => !current);
          }}
          className={cn(
            "flex min-h-touch w-full items-center justify-between gap-3 py-1 text-left",
            "transition-colors duration-fast ease-standard hover:text-brand",
            "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken",
            "lg:hidden",
          )}
        >
          {title}
          <Chevron open={open} />
        </button>

        <span className="hidden lg:block">{title}</span>
      </h3>

      <div id={panelId} className={cn(open ? "block" : "hidden", "pb-s4 lg:block lg:pb-0")}>
        {children}
      </div>
    </div>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn(
        "h-4 w-4 shrink-0 text-brand transition-transform duration-base ease-standard",
        open && "rotate-180",
      )}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
