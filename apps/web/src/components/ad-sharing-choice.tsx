"use client";

import { Alert, Button } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  AD_SHARING_OPT_OUT_COOKIE,
  AD_SHARING_OPT_OUT_MAX_AGE_SECONDS,
  hasAdSharingOptOut,
} from "@/lib/meta-pixel";

type ChoiceState = "unknown" | "sharing" | "opted-out" | "gpc";

/**
 * "No compartir mi actividad para publicidad" en este navegador (DEC-086).
 *
 * Es la exclusion que la CCPA exige ofrecer cuando un sitio usa un pixel de
 * publicidad. Se guarda en una cookie de este navegador, que el pixel mira
 * antes de cargarse (`src/lib/meta-pixel.ts`). Si el navegador ya envia Global
 * Privacy Control, la exclusion ya esta aplicada y se dice.
 *
 * El estado se lee al montar, no en el servidor: la cookie y la senal GPC son
 * del navegador, y leerlas aqui evita que la pagina dependa de ellas al
 * renderizarse.
 */
export function AdSharingChoice() {
  const t = useTranslations("legal.privacyChoices");
  const [state, setState] = useState<ChoiceState>("unknown");

  useEffect(() => {
    setState(
      navigator.globalPrivacyControl === true
        ? "gpc"
        : hasAdSharingOptOut(document.cookie)
          ? "opted-out"
          : "sharing",
    );
  }, []);

  function writeCookie(value: "1" | null): void {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      value === null
        ? `${AD_SHARING_OPT_OUT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
        : `${AD_SHARING_OPT_OUT_COOKIE}=1; Max-Age=${String(AD_SHARING_OPT_OUT_MAX_AGE_SECONDS)}; Path=/; SameSite=Lax${secure}`;
  }

  function optOut(): void {
    writeCookie("1");
    // Si el pixel ya estaba cargado en esta visita, deja de enviar desde ya.
    window.fbq?.("consent", "revoke");
    setState("opted-out");
  }

  function optIn(): void {
    writeCookie(null);
    setState("sharing");
  }

  return (
    <section aria-labelledby="ad-sharing-title" className="flex flex-col gap-s3">
      <h2 id="ad-sharing-title" className="text-heading-sm font-semibold text-text">
        {t("adSharingTitle")}
      </h2>
      <p className="text-body-sm text-text-muted">{t("adSharingBody")}</p>

      {state === "gpc" ? (
        <Alert tone="success">{t("adSharingGpc")}</Alert>
      ) : state === "opted-out" ? (
        <>
          <Alert tone="success">{t("adSharingOptedOut")}</Alert>
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={optIn}>
            {t("adSharingOptIn")}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="self-start"
          disabled={state === "unknown"}
          onClick={optOut}
        >
          {t("adSharingOptOut")}
        </Button>
      )}
    </section>
  );
}
