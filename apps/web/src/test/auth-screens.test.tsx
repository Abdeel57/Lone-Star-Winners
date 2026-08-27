import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
    redirect: () => undefined,
    getPathname: ({ href }: { href: string }) => href,
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

/*
 * Las Server Actions no se pueden importar en jsdom: son funciones marcadas
 * `"use server"` que Next transforma en tiempo de build. Se sustituyen por
 * funciones que devuelven el estado inicial, porque lo que se prueba aqui es lo
 * que la pantalla PINTA, no lo que la accion HACE.
 */
vi.mock("@/lib/auth-actions", () => {
  const idle = {
    status: "idle" as const,
    code: null,
    requestId: null,
    field: null,
    retryAfterSeconds: null,
  };

  return {
    registerAction: () => Promise.resolve(idle),
    loginAction: () => Promise.resolve(idle),
    logoutAction: () => Promise.resolve(undefined),
    forgotPasswordAction: () => Promise.resolve(idle),
    resetPasswordAction: () => Promise.resolve(idle),
    verifyEmailAction: () => Promise.resolve(idle),
    resendVerificationAction: () => Promise.resolve(idle),
    verifyMfaAction: () => Promise.resolve(idle),
  };
});

import { UnverifiedEmailNotice } from "@/components/email-verification";
import { LoginForm } from "@/components/login-form";
import { MfaForm } from "@/components/mfa-form";
import { RegisterForm } from "@/components/register-form";
import { LOCALES, type Locale } from "@/i18n/locales";
import { requiredConsents, unknownConsent, unverifiedParticipant } from "@/mocks/fixtures/account";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Pantallas de identidad (FE-M4).
 *
 * LAS DOS REDES QUE IMPORTAN DE VERDAD AQUI
 * -----------------------------------------
 * 1. Que el alta NO PREGUNTE nada legal que nadie ha aprobado: ni edad, ni
 *    estado de residencia, ni una casilla de elegibilidad escrita por el
 *    frontend. Las unicas casillas que aparecen son las que publica el backend.
 * 2. Que en ningun formulario haya un token ni un `localStorage` (DEC-006).
 *
 * Un test que solo comprobara que los campos se ven no detectaria a nadie
 * anadiendo un "confirmo que tengo 18 anos", que es exactamente el cambio
 * bienintencionado que hay que impedir.
 */

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

describe("formulario de inicio de sesion", () => {
  it.each(LOCALES)("pinta correo y contrasena en %s", (locale) => {
    const { container } = renderIn(locale, <LoginForm locale={locale} returnPath={null} />);

    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
  });

  it("el destino de vuelta viaja en un campo oculto", () => {
    const { container } = renderIn("en", <LoginForm locale="en" returnPath="/account/entries" />);

    const hidden = container.querySelector('input[name="next"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.getAttribute("value")).toBe("/account/entries");
  });

  it("sin destino de vuelta no se pinta el campo", () => {
    const { container } = renderIn("en", <LoginForm locale="en" returnPath={null} />);
    expect(container.querySelector('input[name="next"]')).toBeNull();
  });

  it("el campo de contrasena pide la guardada, no una nueva", () => {
    // `current-password` y no `new-password`: con el segundo, el gestor de
    // contrasenas ofrece GENERAR una en la pantalla de entrar.
    const { container } = renderIn("en", <LoginForm locale="en" returnPath={null} />);

    expect(container.querySelector('input[name="password"]')?.getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });
});

describe("formulario de alta", () => {
  it.each(LOCALES)("no pregunta ningun dato legal en %s", (locale) => {
    const { container } = renderIn(
      locale,
      <RegisterForm locale={locale} consents={[]} returnPath={null} />,
    );

    // La elegibilidad la fijan las Official Rules y sigue en TBD: ningun campo
    // de este formulario puede preguntar por ella (CLAUDE.md #2).
    for (const forbidden of ["birth_date", "date_of_birth", "age", "state", "region", "country"]) {
      expect(
        container.querySelector(`[name="${forbidden}"]`),
        `el alta pregunta un dato legal no aprobado: ${forbidden}`,
      ).toBeNull();
    }
  });

  it("sin consentimientos publicados no pinta ninguna casilla", () => {
    const { container } = renderIn(
      "en",
      <RegisterForm locale="en" consents={[]} returnPath={null} />,
    );

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("pinta las casillas que publica el backend, con su version", () => {
    const { container } = renderIn(
      "en",
      <RegisterForm locale="en" consents={requiredConsents} returnPath={null} />,
    );

    const consent = requiredConsents[0];
    expect(consent).toBeDefined();
    if (consent === undefined) return;

    expect(container.querySelector(`input[name="consent_accepted:${consent.key}"]`)).not.toBeNull();

    // Clave y version viajan juntas: aceptar unas reglas sin decir cual version
    // es una afirmacion sin fecha.
    const hidden = container.querySelector('input[name="consent"]');
    expect(hidden?.getAttribute("value")).toBe(`${consent.key}:${consent.version}`);
    // El patron sale de un fixture de este repositorio, no de entrada de usuario.
    // eslint-disable-next-line security/detect-non-literal-regexp
    expect(screen.getByText(new RegExp(consent.version))).toBeInTheDocument();
  });

  it("una clave de consentimiento desconocida no aparece en crudo", () => {
    renderIn("es", <RegisterForm locale="es" consents={[unknownConsent]} returnPath={null} />);

    // Nunca la clave tecnica delante de un participante; un texto generico que
    // remite a las Reglas Oficiales.
    expect(screen.queryByText(/SOMETHING_THE_FRONTEND_DOES_NOT_KNOW/)).toBeNull();
    expect(screen.getByText(esMessages.auth.consent.fallback)).toBeInTheDocument();
  });

  it.each(LOCALES)("las dos contrasenas piden una nueva en %s", (locale) => {
    const { container } = renderIn(
      locale,
      <RegisterForm locale={locale} consents={[]} returnPath={null} />,
    );

    for (const name of ["password", "password_confirmation"]) {
      expect(container.querySelector(`input[name="${name}"]`)?.getAttribute("autocomplete")).toBe(
        "new-password",
      );
    }
  });
});

describe("aviso de correo sin verificar", () => {
  it.each(LOCALES)("dice el estado y ofrece reenviar en %s", (locale) => {
    renderIn(locale, <UnverifiedEmailNotice locale={locale} email={unverifiedParticipant.email} />);

    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getByText(messages.auth.unverified.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: messages.auth.unverified.resend }),
    ).toBeInTheDocument();
  });

  it("NO afirma ninguna consecuencia sobre las participaciones", () => {
    /*
     * Que un correo sin verificar impida o no acumular participaciones es un
     * TBD legal (`docs/LEGAL_PENDING.md`). El aviso dice que el correo no esta
     * verificado y ofrece reenviar el mensaje; en cuanto alguien anada aqui
     * "sin verificar no participas", habra escrito un requisito legal desde el
     * frontend (CLAUDE.md #2) y este test lo dira.
     */
    const { container } = renderIn(
      "es",
      <UnverifiedEmailNotice locale="es" email={unverifiedParticipant.email} />,
    );

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/participaci/i);
    expect(text).not.toMatch(/no podr/i);
  });
});

describe("segundo factor (MFA_PENDING)", () => {
  it.each(LOCALES)("pide el codigo y nada mas en %s", (locale) => {
    const { container } = renderIn(locale, <MfaForm locale={locale} returnPath={null} />);

    const code = container.querySelector('input[name="code"]');
    expect(code).not.toBeNull();

    // Un solo campo: la sesion existe y todavia no autentica, asi que no hay
    // nada de la cuenta que ensenar aqui.
    expect(container.querySelectorAll("input:not([type=hidden])")).toHaveLength(1);
  });

  it("el campo ayuda a teclear el codigo en un telefono", () => {
    const { container } = renderIn("en", <MfaForm locale="en" returnPath={null} />);
    const code = container.querySelector('input[name="code"]');

    expect(code?.getAttribute("inputmode")).toBe("numeric");
    expect(code?.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("NO impone longitud ni patron: esa politica es del backend", () => {
    // El contrato dice seis digitos y admite espacios. Una restriccion del
    // navegador que no coincida exactamente rechazaria codigos validos.
    const { container } = renderIn("en", <MfaForm locale="en" returnPath={null} />);
    const code = container.querySelector('input[name="code"]');

    expect(code?.hasAttribute("pattern")).toBe(false);
    expect(code?.hasAttribute("maxlength")).toBe(false);
  });

  it("conserva el destino de vuelta a traves del segundo paso", () => {
    const { container } = renderIn("en", <MfaForm locale="en" returnPath="/account/orders" />);

    expect(container.querySelector('input[name="next"]')?.getAttribute("value")).toBe(
      "/account/orders",
    );
  });

  it.each(LOCALES)("avisa de que cada codigo sirve una sola vez en %s", (locale) => {
    renderIn(locale, <MfaForm locale={locale} returnPath={null} />);

    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getByText(messages.auth.mfa.codeHint)).toBeInTheDocument();
  });
});
