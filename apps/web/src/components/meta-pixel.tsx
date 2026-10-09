"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef } from "react";

import { usePathname } from "@/i18n/navigation";
import { isMetaPixelExcludedPath, META_SCRIPT_URL, metaPixelAllowed } from "@/lib/meta-pixel";

/** La funcion global que publica `fbevents.js`, con su cola previa a la carga. */
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  /** Apaga el `PageView` automatico de Meta en cada `pushState`. */
  disablePushState?: boolean;
  /** Sin esto, Meta descarta el segundo `PageView` del mismo documento. */
  allowDuplicatePageViews?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
  interface Navigator {
    readonly globalPrivacyControl?: boolean;
  }
}

/**
 * La cola de Meta, la misma que crea su fragmento oficial, escrita aqui para no
 * necesitar un script en linea: hasta que llega `fbevents.js`, cada llamada se
 * guarda y el fichero las procesa al cargar.
 */
function installFbq(): Fbq {
  if (window.fbq !== undefined) return window.fbq;

  const fbq = function (...args: unknown[]): void {
    if (fbq.callMethod !== undefined) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  // Los `PageView` los decide ESTE componente, ruta a ruta: el automatico de
  // Meta en cada cambio de URL se los mandaria tambien desde la cuenta o el
  // checkout, que estan excluidos (`META_PIXEL_EXCLUDED_PATHS`).
  fbq.disablePushState = true;
  // Y como la tienda navega sin recargar, cada ruta es un `PageView` aunque el
  // documento sea el mismo; sin esto Meta se queda solo con el primero.
  fbq.allowDuplicatePageViews = true;

  window.fbq = fbq;
  window._fbq ??= fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = META_SCRIPT_URL;
  document.head.appendChild(script);

  return fbq;
}

/**
 * Pixel de Meta en la tienda (DEC-086). Las reglas -donde dispara, cuando no-
 * estan en `src/lib/meta-pixel.ts`.
 *
 * Un `PageView` al entrar y otro en cada cambio de ruta: la tienda navega sin
 * recargar la pagina, y sin esto Meta solo veria la primera.
 */
export function MetaPixel({ pixelId }: { readonly pixelId: string }) {
  // La ruta de next-intl llega SIN el idioma: cambiar de idioma tambien es
  // una pagina nueva, asi que la clave lleva los dos.
  const pathname = usePathname();
  const page = `${useLocale()}:${pathname}`;
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (lastTracked.current === page) return;

    // Cuenta, checkout y confirmacion de pedido: ni se carga ni se registra.
    // Llegar a la tienda desde un enlace con token deja el token fuera, porque
    // el pixel no existe todavia en esa pagina.
    if (isMetaPixelExcludedPath(pathname)) return;

    const allowed = metaPixelAllowed({
      hostname: window.location.hostname,
      globalPrivacyControl: navigator.globalPrivacyControl === true,
      cookieHeader: document.cookie,
    });
    if (!allowed) return;

    const firstTime = window.fbq === undefined;
    const fbq = installFbq();
    if (firstTime) {
      // Sin eventos automaticos (clics en botones, metadatos de la pagina):
      // solo los `PageView` que manda este componente.
      fbq("set", "autoConfig", false, pixelId);
      fbq("init", pixelId);
    }
    fbq("track", "PageView");
    lastTracked.current = page;
  }, [page, pathname, pixelId]);

  return null;
}
