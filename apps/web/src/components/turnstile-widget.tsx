"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import type { Locale } from "@/i18n/locales";

/**
 * Comprobacion anti-bots de Cloudflare Turnstile (DEC-060).
 *
 * DONDE SE USA Y POR QUE SOLO AHI
 * -------------------------------
 * Antes de pedir un codigo por SMS. Es la unica accion publica del sitio que
 * cuesta dinero cada vez que se ejecuta, y sin esta comprobacion un programa
 * podria pedir miles de codigos a costa del saldo del negocio.
 *
 * QUE HACE
 * --------
 * Pinta el widget de Cloudflare, que deja su token en un campo oculto
 * `cf-turnstile-response` DENTRO del formulario. La accion lo reenvia a la API
 * y la API lo valida contra Cloudflare con la clave secreta. Este componente no
 * decide nada: sin la validacion del servidor, el widget no protege de nada.
 *
 * SIN CLAVE, NO SE PINTA
 * ----------------------
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` se incrusta al compilar. Sin ella -en
 * desarrollo, o antes de configurarla- el componente no pinta nada, y es la API
 * la que decide si el envio exigia la comprobacion.
 *
 * `resetSignal` vuelve a pedir el desafio: cada token sirve una sola vez, asi
 * que tras un envio -con exito o sin el- hace falta uno nuevo.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      theme?: "auto" | "light" | "dark";
      "error-callback"?: () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Carga el script de Cloudflare UNA vez por pagina, aunque haya varios widgets. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);

  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.turnstile === undefined) reject(new Error("turnstile_missing"));
      else resolve(window.turnstile);
    };
    script.onerror = () => {
      // Se permite reintentar en el siguiente montaje.
      loading = null;
      reject(new Error("turnstile_script_failed"));
    };
    document.head.appendChild(script);
  });

  return loading;
}

export function TurnstileWidget({
  locale,
  resetSignal,
}: {
  readonly locale: Locale;
  readonly resetSignal: number;
}) {
  const t = useTranslations("auth.phone");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (siteKey === undefined || siteKey.length === 0) return;
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || container.current === null) return;
        widgetId.current = turnstile.render(container.current, {
          sitekey: siteKey,
          language: locale,
          theme: "auto",
          "error-callback": () => {
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetId.current !== null) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey, locale]);

  useEffect(() => {
    if (resetSignal > 0 && widgetId.current !== null) {
      window.turnstile?.reset(widgetId.current);
    }
  }, [resetSignal]);

  if (siteKey === undefined || siteKey.length === 0) return null;

  return (
    <div className="flex flex-col gap-s2">
      <div ref={container} />
      {failed ? <p className="text-body-sm text-danger-text">{t("botCheckUnavailable")}</p> : null}
    </div>
  );
}
