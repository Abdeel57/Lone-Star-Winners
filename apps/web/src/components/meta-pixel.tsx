"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef } from "react";

import { usePathname } from "@/i18n/navigation";
import { META_SCRIPT_URL, metaPixelAllowed } from "@/lib/meta-pixel";

/** La funcion global que publica `fbevents.js`, con su cola previa a la carga. */
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
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
  const page = `${useLocale()}:${usePathname()}`;
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (lastTracked.current === page) return;

    const allowed = metaPixelAllowed({
      hostname: window.location.hostname,
      globalPrivacyControl: navigator.globalPrivacyControl === true,
      cookieHeader: document.cookie,
    });
    if (!allowed) return;

    const firstTime = window.fbq === undefined;
    const fbq = installFbq();
    if (firstTime) fbq("init", pixelId);
    fbq("track", "PageView");
    lastTracked.current = page;
  }, [page, pixelId]);

  return null;
}
