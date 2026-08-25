import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Envoltorios de navegacion conscientes del locale.
 *
 * En toda la app se importan estos y NUNCA `next/link` ni `next/navigation`
 * directamente: un `<Link href="/shop">` de Next perderia el prefijo de idioma
 * y sacaria al usuario de su idioma a mitad de sesion.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
