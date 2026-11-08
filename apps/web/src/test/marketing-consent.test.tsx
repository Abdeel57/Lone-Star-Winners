/**
 * Permiso de correo promocional en la web (DEC-098).
 *
 * Lo que estos casos protegen:
 *
 *   1. que la casilla del alta llegue DESMARCADA y solo si el backend la ofrece;
 *   2. que el alta mande el permiso solo cuando la persona marco la casilla, y
 *      con la version del texto que vio;
 *   3. que con el permiso dado la tarjeta ofrezca retirarlo, y que retirar no
 *      necesite nada mas.
 */

import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz",
      set: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers({ host: "tienda.interno.test" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// El alta redirige al terminar; aqui solo importa lo que se manda a la API.
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/account/register",
    redirect: () => undefined,
    getPathname: ({ href }: { href: string }) => href,
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});

import {
  MarketingConsentCard,
  MarketingOptInField,
  marketingOffer,
} from "@/components/marketing-consent";
import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { API_PATHS, apiBaseUrl, type MarketingConsent } from "@/lib/api";
import { completeSignupAction } from "@/lib/auth-actions";
import { setMarketingConsentAction } from "@/lib/marketing-consent-actions";
import { mockApiServer } from "@/mocks/node";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

const API = apiBaseUrl().replace(/\/+$/, "");
const VERSION = "2026-11-07-borrador";
const OFFER = {
  key: "MARKETING_EMAIL",
  version: VERSION,
  text_key: "MARKETING_EMAIL",
  required: false,
};

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

function form(entries: Readonly<Record<string, string>>): FormData {
  const formData = new FormData();
  formData.set("locale", "es");
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
}

const NONE_OFFERED: MarketingConsent = {
  status: "NONE",
  text_version: null,
  source: null,
  updated_at: null,
  offer: { key: "MARKETING_EMAIL", text_version: VERSION, text_key: "MARKETING_EMAIL" },
};

describe("alta: casilla de correo promocional", () => {
  it("solo hay oferta si el backend publica MARKETING_EMAIL", () => {
    expect(marketingOffer([])).toBeNull();
    expect(marketingOffer([{ ...OFFER, key: "OTRA" }])).toBeNull();
    expect(marketingOffer([OFFER])).toEqual(OFFER);
  });

  it("llega desmarcada, con su texto y la version del texto como valor", () => {
    renderIn("es", <MarketingOptInField offer={OFFER} />);

    const box = screen.getByRole("checkbox", { name: esMessages.marketingConsent.checkbox });
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute("name", "marketing_email");
    expect(box).toHaveAttribute("value", VERSION);
    expect(screen.getByText(esMessages.marketingConsent.checkboxHint)).toBeInTheDocument();
  });

  it("el alta manda el permiso SOLO si la casilla llego marcada", async () => {
    const bodies: { consents: { key: string }[] }[] = [];
    mockApiServer.use(
      http.post(`${API}${API_PATHS.authCodeRegister}`, async ({ request }) => {
        bodies.push((await request.json()) as { consents: { key: string }[] });
        return HttpResponse.json(
          { error: { code: "SIGNUP_EXPIRED", request_id: "req-alta" } },
          { status: 410 },
        );
      }),
    );
    const base = {
      display_name: "Ana",
      residence_state: "TX",
      consents_agreed: "on",
      consent: "OFFICIAL_RULES:2026-10-04",
      "consent_required:OFFICIAL_RULES": "true",
    };

    await completeSignupAction(IDLE, form(base));
    await completeSignupAction(IDLE, form({ ...base, marketing_email: VERSION }));

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.consents.map((consent) => consent.key)).not.toContain("MARKETING_EMAIL");
    expect(bodies[1]?.consents).toContainEqual({ key: "MARKETING_EMAIL", version: VERSION });
  });
});

describe("perfil: tarjeta de correo promocional", () => {
  it("sin permiso y con la casilla ofrecida: el texto y Aceptar", () => {
    renderIn("es", <MarketingConsentCard locale="es" consent={NONE_OFFERED} date={null} />);

    expect(screen.getByText(esMessages.marketingConsent.statusNone)).toBeInTheDocument();
    expect(screen.getByText(esMessages.marketingConsent.checkbox)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: esMessages.marketingConsent.accept }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: esMessages.marketingConsent.withdraw }),
    ).not.toBeInTheDocument();
  });

  it("con el permiso dado: solo retirarlo, aunque la casilla ya no se ofrezca", () => {
    renderIn(
      "en",
      <MarketingConsentCard
        locale="en"
        consent={{
          status: "GRANTED",
          text_version: VERSION,
          source: "SIGNUP",
          updated_at: "2026-11-01T18:00:00.000Z",
          offer: null,
        }}
        date="November 1, 2026"
      />,
    );

    expect(
      screen.getByText(
        enMessages.marketingConsent.statusGranted.replace("{date}", "November 1, 2026"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: enMessages.marketingConsent.withdraw }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enMessages.marketingConsent.accept }),
    ).not.toBeInTheDocument();
  });

  it("retirado y sin casilla ofrecida: solo el estado, sin botones", () => {
    renderIn(
      "es",
      <MarketingConsentCard
        locale="es"
        consent={{ ...NONE_OFFERED, status: "WITHDRAWN", offer: null }}
        date="1 de noviembre de 2026"
      />,
    );

    expect(
      screen.getByText(
        esMessages.marketingConsent.statusWithdrawn.replace("{date}", "1 de noviembre de 2026"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("perfil: accion de dar o retirar", () => {
  it("retirar manda solo `granted: false`", async () => {
    const bodies: unknown[] = [];
    mockApiServer.use(
      http.put(`${API}${API_PATHS.meMarketingConsent}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...NONE_OFFERED, status: "WITHDRAWN" });
      }),
    );

    const result = await setMarketingConsentAction(IDLE, form({ granted: "false" }));

    expect(result.status).toBe("ok");
    expect(bodies).toEqual([{ granted: false }]);
  });

  it("aceptar manda la version del texto que se pinto y el idioma de la pagina", async () => {
    const bodies: unknown[] = [];
    mockApiServer.use(
      http.put(`${API}${API_PATHS.meMarketingConsent}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...NONE_OFFERED, status: "GRANTED", text_version: VERSION });
      }),
    );

    const result = await setMarketingConsentAction(
      IDLE,
      form({ granted: "true", text_version: VERSION }),
    );

    expect(result.status).toBe("ok");
    expect(bodies).toEqual([{ granted: true, text_version: VERSION, locale: "es-US" }]);
  });

  it("un texto desactualizado vuelve como error con su codigo", async () => {
    mockApiServer.use(
      http.put(`${API}${API_PATHS.meMarketingConsent}`, () =>
        HttpResponse.json(
          { error: { code: "MARKETING_CONSENT_TEXT_OUTDATED", request_id: "req-texto" } },
          { status: 409 },
        ),
      ),
    );

    const result = await setMarketingConsentAction(
      IDLE,
      form({ granted: "true", text_version: "2020-01-01" }),
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("MARKETING_CONSENT_TEXT_OUTDATED");
  });

  it("sin `granted` valido no se llama a la API", async () => {
    const result = await setMarketingConsentAction(IDLE, form({ granted: "quizas" }));

    expect(result.status).toBe("error");
    expect(result.code).toBe("VALIDATION_FAILED");
  });
});
