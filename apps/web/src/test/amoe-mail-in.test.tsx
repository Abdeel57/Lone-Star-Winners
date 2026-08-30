import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
    Link: ({
      href,
      locale,
      children,
      ...rest
    }: {
      href: string;
      locale?: string;
      children: ReactNode;
    }) =>
      createElement(
        "a",
        { href: locale === undefined ? href : `/${locale}${href}`, ...rest },
        children,
      ),
  };
});

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("../../messages/en-US.json")).default;
  const es = (await import("../../messages/es-US.json")).default;

  return {
    setRequestLocale: () => undefined,
    getTranslations: (options: { locale: "en" | "es"; namespace: "amoe.page" }) =>
      Promise.resolve(
        createTranslator({
          locale: options.locale,
          messages: options.locale === "en" ? en : es,
          namespace: options.namespace,
        }),
      ),
  };
});

import { AmoeDecisionPanel } from "@/components/admin/amoe-review";
import { AmoeModePanel } from "@/components/amoe-mode-panel";
import type { Locale } from "@/i18n/locales";
import { rulesIssues } from "@/lib/admin/rules-version";
import { adminAmoeSubmissionPage, adminRulesVersions } from "@/mocks/fixtures/admin";
import {
  amoeMailInConfig,
  amoeMailInWithoutInstructionsConfig,
  amoeOnlineFormConfig,
} from "@/mocks/fixtures/amoe";
import { baseEntryOffer } from "@/mocks/fixtures/promotions";

import esMessages from "../../messages/es-US.json";

/**
 * VIA GRATUITA POSTAL (§13.2, DEC-054 punto 4).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * Que la pagina de la via gratuita diga CUANTO VALE UNA FICHA y CUANTAS SE
 * ADMITEN. Antes solo podia remitir al documento, y quien quiere participar sin
 * comprar tiene que poder saber eso antes de escribir una ficha a mano y pagar
 * un sello.
 *
 * Y a la vez, que NO invente nada: los plazos y las instrucciones son del
 * abogado, cada cifra se pinta solo si llega, y la modalidad postal sigue sin
 * ofrecer formulario -eso es exactamente lo que el segundo borrador dice que no
 * existe, y desde HO-041 la API ademas lo rechaza con `AMOE_MODE_NOT_ONLINE`-.
 */

const TIME_ZONE = "America/Chicago";

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={esMessages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AmoeModePanel con modalidad postal", () => {
  it("publica el valor por ficha, el limite, las fichas por sobre y los plazos", async () => {
    const ui = await AmoeModePanel({
      config: amoeMailInConfig,
      locale: "es",
      promotionSlug: "gmc-2025",
      authenticated: false,
      summary: baseEntryOffer.amoe ?? null,
      timeZone: TIME_ZONE,
    });

    renderIn("es", ui);

    expect(screen.getByText(esMessages.amoe.page.entriesPerCard)).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
    expect(screen.getByText(esMessages.amoe.page.maxPerParticipant)).toBeInTheDocument();
    expect(screen.getByText(esMessages.amoe.page.cardsPerEnvelope)).toBeInTheDocument();
    expect(screen.getByText(esMessages.amoe.page.postmarkBy)).toBeInTheDocument();
    expect(screen.getByText(esMessages.amoe.page.receivedBy)).toBeInTheDocument();
  });

  it("NO ofrece formulario de envio: la via es postal", async () => {
    /*
     * Un boton aqui sugeriria que se puede participar desde la web, que es lo
     * contrario de lo que dicen las instrucciones. Desde HO-041 la API tambien
     * lo rechaza (`AMOE_MODE_NOT_ONLINE`), y esta pantalla no llega a
     * intentarlo.
     */
    const ui = await AmoeModePanel({
      config: amoeMailInConfig,
      locale: "es",
      promotionSlug: "gmc-2025",
      authenticated: true,
      summary: baseEntryOffer.amoe ?? null,
      timeZone: TIME_ZONE,
    });

    renderIn("es", ui);

    expect(screen.queryByText(esMessages.amoe.page.submitHeading)).not.toBeInTheDocument();
  });

  it("sin instrucciones publicadas remite al documento y CONSERVA las cifras", async () => {
    /*
     * Son dos cosas distintas: las instrucciones son prosa del abogado -si no
     * llegan, no se redactan- y los limites son configuracion, que si se puede
     * publicar. Callar las dos a la vez seria perder informacion que existe.
     */
    const ui = await AmoeModePanel({
      config: amoeMailInWithoutInstructionsConfig,
      locale: "es",
      promotionSlug: "gmc-2025",
      authenticated: false,
      summary: baseEntryOffer.amoe ?? null,
      timeZone: TIME_ZONE,
    });

    renderIn("es", ui);

    expect(screen.getByText(esMessages.amoe.page.noInstructions)).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
  });

  it("sin cifras en ninguna de las dos fuentes no pinta el bloque", async () => {
    /*
     * `amoeOnlineFormConfig` no declara `mail_in`, ni valor por ficha, ni
     * limite; y aqui no se pasa resumen. Un recuadro vacio bajo las
     * instrucciones pareceria un fallo de carga.
     */
    const ui = await AmoeModePanel({
      config: amoeOnlineFormConfig,
      locale: "es",
      promotionSlug: "gmc-2025",
      authenticated: false,
      summary: null,
      timeZone: TIME_ZONE,
    });

    renderIn("es", ui);

    expect(screen.queryByText(esMessages.amoe.page.mailInNote)).not.toBeInTheDocument();
  });
});

describe("separacion de funciones en la cola AMOE (§13.10)", () => {
  const own = adminAmoeSubmissionPage.items.find((item) => item.transcribed_by_me);
  const other = adminAmoeSubmissionPage.items.find((item) => !item.transcribed_by_me);

  it("el fixture trae los dos casos, o el resto de este bloque no prueba nada", () => {
    expect(own, "una ficha transcrita por quien mira").toBeDefined();
    expect(other, "y una que no").toBeDefined();
  });

  it("NINGUNA de las dos decisiones se ofrece sobre la propia transcripcion", async () => {
    /*
     * Esta prueba afirmaba lo contrario para el rechazo, con el argumento de que
     * la separacion de funciones protege la concesion de participaciones y no la
     * negativa. La revision de seguridad lo desmonto: **rechazar una ficha
     * valida tambien es un dano** -le niega participaciones a alguien que
     * participo bien- y quien la transcribio es exactamente quien podria tapar
     * su propio error al teclearla. El backend bloquea las DOS rutas con 409
     * `SEPARATION_OF_DUTIES`, y la pantalla no ofrece ninguna.
     *
     * Retirar los formularios es CORTESIA: evita que alguien elija motivo,
     * marque la casilla y descubra al final que no podia. El control sigue
     * siendo el 409.
     */
    if (own === undefined) return;

    for (const decision of ["approve", "reject"] as const) {
      const ui = await AmoeDecisionPanel({
        submission: own,
        locale: "es",
        decision,
        canApprove: true,
        canReject: true,
      });

      const view = renderIn("es", ui);

      expect(
        screen.getByText(esMessages.admin.amoeReview.ownTranscriptionTitle),
        decision,
      ).toBeInTheDocument();
      expect(
        screen.queryByText(esMessages.admin.amoeReview.approveSubmit),
        decision,
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(esMessages.admin.amoeReview.rejectSubmit),
        decision,
      ).not.toBeInTheDocument();

      view.unmount();
    }
  });

  it("una ficha de otra persona si se puede aprobar", async () => {
    if (other === undefined) return;

    const ui = await AmoeDecisionPanel({
      submission: other,
      locale: "es",
      decision: "approve",
      canApprove: true,
      canReject: true,
    });

    renderIn("es", ui);

    expect(screen.getByText(esMessages.admin.amoeReview.approveSubmit)).toBeInTheDocument();
    expect(
      screen.queryByText(esMessages.admin.amoeReview.ownTranscriptionTitle),
    ).not.toBeInTheDocument();
  });
});

describe("lectura de una version de reglas (§13.7)", () => {
  it("las claves sin resolver llegan con UN solo nombre", () => {
    /*
     * Esta capa llevo un `missing_keys` paralelo mientras no se sabia cual
     * publicaba la API. Backend confirmo (HO-041) que ese nombre nunca existio
     * en `apps/api`: no era una forma antigua, era una forma inventada, y el
     * ayudante que elegia entre las dos se retiro con ella.
     *
     * Lo que este test protege es que el contrato siga teniendo un solo nombre:
     * si reapareciera el segundo, media pantalla leeria uno y media el otro, y
     * el sintoma seria un boton de activar habilitado en un sitio y bloqueado
     * en el de al lado.
     */
    const draft = adminRulesVersions.find((version) => version.status === "DRAFT");
    expect(draft).toBeDefined();
    if (draft === undefined) return;

    expect(draft.unresolved_required_keys).toContain("minimum_age");
    expect(Object.keys(draft)).not.toContain("missing_keys");
  });

  it("`activatable` lo decide el backend y exige DRAFT", () => {
    /*
     * No se deriva de que la lista de claves este vacia: la version ACTIVA no
     * tiene ninguna y tampoco es activable, porque `activatable` exige
     * `status === "DRAFT"` (§13.7). Deducirlo aqui seria reimplementar el
     * cerrojo de DEC-012 en el frontend.
     */
    const active = adminRulesVersions.find((version) => version.status === "ACTIVE");
    const draft = adminRulesVersions.find((version) => version.status === "DRAFT");
    expect(active).toBeDefined();
    expect(draft).toBeDefined();
    if (active === undefined || draft === undefined) return;

    expect(active.unresolved_required_keys, "la activa no tiene claves pendientes").toEqual([]);
    expect(active.activatable, "y aun asi no es activable: no es un borrador").toBe(false);
    expect(draft.activatable, "el borrador con claves pendientes tampoco").toBe(false);
  });

  it("los problemas de validacion se leen aunque no haya claves pendientes", () => {
    // `INVALID` y `UNRESOLVED` no son lo mismo, y la pantalla los pinta con su
    // ruta y su codigo en crudo: es lo que se busca en la configuracion.
    const draft = adminRulesVersions.find((version) => version.status === "DRAFT");
    expect(draft).toBeDefined();
    if (draft === undefined) return;

    expect(rulesIssues(draft).map((issue) => issue.path)).toContain("amoe.limit.period");
  });
});
