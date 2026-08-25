import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Los componentes hablan los dos idiomas.
 *
 * El test de paridad garantiza que las claves existen en los dos diccionarios.
 * Este comprueba lo siguiente: que los componentes las USAN, y que un cambio de
 * locale cambia de verdad lo que lee el usuario.
 */

// `usePathname` y `Link` de next-intl necesitan el router del App Router, que no
// existe en jsdom. El doble reproduce su contrato documentado: `usePathname`
// devuelve la ruta SIN prefijo de idioma y `Link` anade el del `locale`. Lo que
// se comprueba con el es la decision propia del componente: pasar la ruta
// actual en vez de mandar al usuario a la portada.
vi.mock("@/i18n/navigation", async () => {
  // Sin JSX dentro del factory: `vi.mock` se eleva por encima de los imports y
  // el runtime automatico de JSX podria no estar disponible todavia.
  const { createElement } = await import("react");

  return {
    usePathname: () => "/account/entries",
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

import { ApiErrorState } from "@/components/api-error-state";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";

function renderIn(locale: "en" | "es", ui: ReactNode) {
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

describe("PromotionStatusBadge", () => {
  it("muestra el estado en ingles", () => {
    renderIn("en", <PromotionStatusBadge status="winner_verification" />);
    expect(screen.getByText(enMessages.promotionStatus.winner_verification)).toBeInTheDocument();
  });

  it("muestra el mismo estado en espanol", () => {
    renderIn("es", <PromotionStatusBadge status="winner_verification" />);
    expect(screen.getByText(esMessages.promotionStatus.winner_verification)).toBeInTheDocument();
  });

  it("el estado no se transmite solo con el color", () => {
    // Quien no distinga los colores tiene que poder leer el estado.
    renderIn("en", <PromotionStatusBadge status="ended" />);
    expect(screen.getByText(enMessages.promotionStatus.ended)).toBeInTheDocument();
  });
});

describe("ApiErrorState (DEC-022)", () => {
  it("traduce el codigo del backend con el copy del frontend", () => {
    renderIn(
      "es",
      <ApiErrorState
        failure={{
          kind: "http",
          status: 500,
          code: "INTERNAL_ERROR",
          messageKey: "apiErrors.INTERNAL_ERROR",
          requestId: "req_test_0001",
          details: null,
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(esMessages.apiErrors.INTERNAL_ERROR);
    expect(alert).toHaveTextContent("req_test_0001");
  });

  it("cae al mensaje generico ante un codigo que no conoce", () => {
    // El backend puede introducir codigos nuevos en cualquier despliegue. Un
    // codigo sin traducir no puede acabar en pantalla en el idioma equivocado.
    renderIn(
      "es",
      <ApiErrorState
        failure={{
          kind: "http",
          status: 422,
          code: "SOME_NEW_CODE_FROM_BACKEND",
          messageKey: "apiErrors.SOME_NEW_CODE_FROM_BACKEND",
          requestId: null,
          details: null,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(esMessages.apiErrors.fallback);
  });

  it("un fallo de red tiene su propio mensaje", () => {
    renderIn(
      "en",
      <ApiErrorState
        failure={{
          kind: "network",
          status: null,
          code: null,
          messageKey: null,
          requestId: null,
          details: null,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(enMessages.apiErrors.NETWORK_UNAVAILABLE);
  });
});

describe("LanguageSwitcher (DEC-021)", () => {
  it("conserva la ruta al cambiar de idioma", () => {
    renderIn("es", <LanguageSwitcher />);

    // Cambiar de idioma desde `/es/account/entries` lleva a la misma pagina en
    // ingles, no a la portada.
    expect(screen.getByRole("link", { name: enMessages.localeName.en })).toHaveAttribute(
      "href",
      "/en/account/entries",
    );
    expect(screen.getByRole("link", { name: esMessages.localeName.es })).toHaveAttribute(
      "href",
      "/es/account/entries",
    );
  });

  it("marca el idioma actual para tecnologia de asistencia", () => {
    renderIn("en", <LanguageSwitcher />);

    const current = screen.getByRole("link", { name: enMessages.localeName.en });
    expect(current).toHaveAttribute("aria-current", "true");

    const other = screen.getByRole("link", { name: enMessages.localeName.es });
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("el conmutador es una region con nombre", () => {
    renderIn("es", <LanguageSwitcher />);
    expect(
      screen.getByRole("navigation", { name: esMessages.a11y.languageSwitcher }),
    ).toBeInTheDocument();
  });
});
