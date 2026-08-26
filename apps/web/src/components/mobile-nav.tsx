"use client";

import { cn, Drawer, IconButton } from "@lsw/ui";
import { useState } from "react";

import { Link } from "@/i18n/navigation";

import { LanguageSwitcher } from "./language-switcher";

/**
 * Un destino de la navegacion principal.
 *
 * Llega YA TRADUCIDO desde la cabecera, que es un Server Component. Es la misma
 * regla que gobierna `@lsw/ui`: el texto se resuelve donde se resuelve el
 * idioma, y los componentes no van a buscarlo por su cuenta. Aqui ademas evita
 * que la lista de destinos exista dos veces -una en la cabecera de escritorio y
 * otra aqui- y que las dos se desincronicen.
 */
export interface NavDestination {
  readonly href: string;
  readonly label: string;
  /** El destino que la marca destaca en oro. Solo uno debe traerlo. */
  readonly highlighted: boolean;
}

/**
 * Navegacion en telefono: hamburguesa + panel lateral.
 *
 * POR QUE UN DRAWER Y NO UNA SEGUNDA LISTA OCULTA
 * -----------------------------------------------
 * La version anterior de la cabecera renderizaba UNA sola navegacion que
 * cambiaba de sitio con `order` y `width`, precisamente para no duplicar los
 * enlaces en el arbol de accesibilidad. Con el logotipo centrado eso deja de
 * ser posible: la fila central esta ocupada por la marca y no hay hueco para
 * una tira de enlaces.
 *
 * La duplicacion se evita igual, pero por otro camino: el contenido del panel
 * solo EXISTE en el DOM mientras esta abierto -Radix lo desmonta al cerrarse- y
 * la navegacion de escritorio esta en `display:none` por debajo de `lg`, lo que
 * la saca del arbol de accesibilidad. En ningun momento hay dos copias
 * anunciables de los mismos enlaces.
 *
 * El panel entra por la IZQUIERDA porque es el lado donde esta el boton que lo
 * abre, y porque el gesto de retroceso del sistema vive en el borde contrario.
 */
export function MobileNav({
  destinations,
  menuLabel,
  closeLabel,
  title,
}: {
  readonly destinations: readonly NavDestination[];
  readonly menuLabel: string;
  readonly closeLabel: string;
  /** Nombre accesible del panel, ya traducido. */
  readonly title: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        variant="ghost"
        label={menuLabel}
        icon={<HamburgerIcon />}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
        // El punto de ruptura es `xl` y no `lg`, y esta medido: la tira de
        // escritorio en espanol -"Tienda / Promociones / Reglas Oficiales /
        // Preguntas frecuentes"- mas la marca centrada y las dos acciones de la
        // derecha no caben en 1024px, y la cabecera se parte en dos filas justo
        // en las tabletas. El mismo panel sirve hasta 1280px, que es donde de
        // verdad sobra sitio. Debe coincidir con `xl:block` de la tira y con
        // `xl:flex` del conmutador de idioma en `site-header.tsx`.
        className="text-text hover:text-brand xl:hidden"
      />

      <Drawer open={open} onOpenChange={setOpen} side="left" title={title} closeLabel={closeLabel}>
        <nav aria-label={title}>
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
                    "text-heading-sm transition-colors duration-fast ease-standard",
                    "outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                    destination.highlighted
                      ? "border-brand text-brand hover:bg-brand/12"
                      : "border-transparent text-text hover:border-brand/50 hover:text-brand",
                  )}
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* El conmutador de idioma vive aqui en telefono. En la cabecera de
            360px no cabe junto a la hamburguesa, la marca y el carrito, y
            partir la cabecera en tres filas -que es lo que hacia antes- se come
            un tercio de la pantalla en cada scroll, porque la cabecera es
            fija. */}
        <div className="mt-s6 border-t border-border pt-s5">
          <LanguageSwitcher />
        </div>
      </Drawer>
    </>
  );
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false" className="h-5 w-5">
      <path
        d="M3 5.5h14M3 10h14M3 14.5h14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
