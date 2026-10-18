import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
 * que la pantalla PINTA, no lo que la accion HACE. Las del acceso con codigo
 * (DEC-089) se pueden programar para que devuelvan `ok` y la pantalla avance.
 */
const actions = vi.hoisted(() => {
  const idle = {
    status: "idle" as const,
    code: null,
    requestId: null,
    field: null,
    retryAfterSeconds: null,
    detail: null,
  };
  const ok = { ...idle, status: "ok" as const };

  return {
    idle,
    ok,
    sendSignInCodeAction: vi.fn(() => Promise.resolve(ok)),
    verifySignInCodeAction: vi.fn(() => Promise.resolve(ok)),
    completeSignupAction: vi.fn(() => Promise.resolve(idle)),
  };
});

vi.mock("@/lib/auth-actions", () => ({
  sendSignInCodeAction: actions.sendSignInCodeAction,
  verifySignInCodeAction: actions.verifySignInCodeAction,
  completeSignupAction: actions.completeSignupAction,
  logoutAction: () => Promise.resolve(undefined),
  forgotPasswordAction: () => Promise.resolve(actions.idle),
  resetPasswordAction: () => Promise.resolve(actions.idle),
  verifyEmailAction: () => Promise.resolve(actions.idle),
  resendVerificationAction: () => Promise.resolve(actions.idle),
  verifyMfaAction: () => Promise.resolve(actions.idle),
  sendPhoneCodeAction: () => Promise.resolve(actions.idle),
  resetPasswordSmsAction: () => Promise.resolve(actions.idle),
}));

import { UnverifiedEmailNotice } from "@/components/email-verification";
import { MfaForm } from "@/components/mfa-form";
import { SignInFlow } from "@/components/sign-in-flow";
import { LOCALES, type Locale } from "@/i18n/locales";
import type { ConsentRequirement } from "@/lib/api";
import { requiredConsents, unknownConsent, unverifiedParticipant } from "@/mocks/fixtures/account";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Pantallas de identidad (FE-M4).
 *
 * LAS REDES QUE IMPORTAN DE VERDAD AQUI
 * -------------------------------------
 * 1. Que el alta NO PREGUNTE nada legal que nadie ha aprobado. Desde DEC-089
 *    pide contacto, nombre, estado y UNA casilla con los documentos que
 *    publica el backend; nada mas, ni siquiera la fecha de nacimiento, que la
 *    pide el checkout si la puerta de edad esta encendida.
 * 2. Que en ningun formulario haya un token ni un `localStorage` (DEC-006), ni
 *    una contrasena en la tienda.
 *
 * Un test que solo comprobara que los campos se ven no detectaria a nadie
 * anadiendo un "confirmo que tengo 18 anos", que es exactamente el cambio
 * bienintencionado que hay que impedir.
 */

/** Ningun paso pregunta esto: ni las Reglas lo piden ni la tienda usa contrasena. */
const FORBIDDEN_FIELDS = [
  "password",
  "password_confirmation",
  "date_of_birth",
  "birth_date",
  "age",
  "state",
  "region",
  "country",
];

function expectNoForbiddenFields(container: HTMLElement): void {
  for (const forbidden of FORBIDDEN_FIELDS) {
    expect(
      container.querySelector(`[name="${forbidden}"]`),
      `el acceso pregunta un dato que no debe: ${forbidden}`,
    ).toBeNull();
  }
  expect(container.querySelector('input[type="password"]')).toBeNull();
}

/** Escribe el contacto y lo envia; espera al paso del codigo. */
async function sendCode(container: HTMLElement, contact: string, locale: Locale): Promise<void> {
  const input = container.querySelector('input[name="contact"]');
  if (input === null) throw new Error("no hay campo de contacto");
  fireEvent.change(input, { target: { value: contact } });

  const form = input.closest("form");
  if (form === null) throw new Error("el campo no esta en un formulario");
  fireEvent.submit(form);

  const messages = locale === "en" ? enMessages : esMessages;
  await screen.findByRole("button", { name: messages.auth.code.verify });
}

/** Teclea un codigo y lo envia; espera al paso de nombre y estado. */
async function verifyCode(container: HTMLElement, locale: Locale): Promise<void> {
  const code = container.querySelector('input[name="code"]');
  if (code === null) throw new Error("no hay campo de codigo");
  fireEvent.change(code, { target: { value: "123456" } });

  const form = code.closest("form");
  if (form === null) throw new Error("el campo no esta en un formulario");
  fireEvent.submit(form);

  const messages = locale === "en" ? enMessages : esMessages;
  await screen.findByText(messages.auth.code.profileTitle);
}

function renderFlow(
  locale: Locale,
  consents: readonly ConsentRequirement[] = [],
  returnPath: string | null = null,
) {
  return renderIn(
    locale,
    <SignInFlow locale={locale} consents={consents} returnPath={returnPath} />,
  );
}

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

describe("entrar o crear la cuenta con un codigo (DEC-089)", () => {
  beforeEach(() => {
    actions.sendSignInCodeAction.mockClear();
    actions.verifySignInCodeAction.mockClear();
  });

  it.each(LOCALES)("el primer paso es UN campo, correo o celular, en %s", (locale) => {
    const { container } = renderFlow(locale);

    // `type="text"` y no `email`: el navegador rechazaria un telefono.
    const contact = container.querySelector('input[name="contact"]');
    expect(contact).not.toBeNull();
    expect(contact?.getAttribute("type")).toBe("text");
    expect(container.querySelectorAll("input:not([type=hidden])")).toHaveLength(1);

    // Se avisa del mensaje de texto ANTES de enviarlo.
    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getByText(messages.auth.code.smsDisclosure)).toBeInTheDocument();

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    // Sin la clave publica de Turnstile no se pinta ningun widget.
    expect(container.querySelector("iframe")).toBeNull();
    expectNoForbiddenFields(container);
  });

  it.each(LOCALES)(
    "tras enviar, pide el codigo de forma que el telefono lo rellene, en %s",
    async (locale) => {
      const { container } = renderFlow(locale);
      await sendCode(container, "ana@example.invalid", locale);

      const code = container.querySelector('input[name="code"]');
      expect(code?.getAttribute("inputmode")).toBe("numeric");
      expect(code?.getAttribute("autocomplete")).toBe("one-time-code");
      // La longitud la decide el backend.
      expect(code?.hasAttribute("pattern")).toBe(false);
      expect(code?.hasAttribute("maxlength")).toBe(false);

      // El contacto viaja con el codigo; no hay ningun token en el formulario.
      expect(
        container.querySelector('form input[name="contact"][type="hidden"]')?.getAttribute("value"),
      ).toBe("ana@example.invalid");
      expectNoForbiddenFields(container);
    },
  );

  it("dice por donde salio el codigo: correo o mensaje de texto", async () => {
    const byEmail = renderFlow("es");
    await sendCode(byEmail.container, "ana@example.invalid", "es");
    expect(screen.getByText(esMessages.auth.code.sentEmailTitle)).toBeInTheDocument();
    byEmail.unmount();

    const byPhone = renderFlow("es");
    await sendCode(byPhone.container, "(512) 555-0100", "es");
    expect(screen.getByText(esMessages.auth.code.sentSmsTitle)).toBeInTheDocument();
  });

  it("el destino de vuelta viaja con el codigo", async () => {
    const { container } = renderFlow("en", [], "/checkout");
    await sendCode(container, "ana@example.invalid", "en");

    expect(container.querySelector('input[name="next"]')?.getAttribute("value")).toBe("/checkout");
  });

  it("'usar otro correo o celular' vuelve al primer paso sin perder lo escrito", async () => {
    const { container } = renderFlow("es");
    await sendCode(container, "ana@example.invalid", "es");

    fireEvent.click(screen.getByRole("button", { name: esMessages.auth.code.changeContact }));

    expect(
      container.querySelector('input[name="contact"]:not([type="hidden"])')?.getAttribute("value"),
    ).toBe("ana@example.invalid");
  });

  it.each(LOCALES)(
    "un contacto sin cuenta pide nombre, estado y UNA casilla; nada mas, en %s",
    async (locale) => {
      const { container } = renderFlow(locale, requiredConsents);
      await sendCode(container, "nueva@example.invalid", locale);
      await verifyCode(container, locale);

      const name = container.querySelector('input[name="display_name"]');
      expect(name?.hasAttribute("required")).toBe(true);
      expect(name?.getAttribute("autocomplete")).toBe("name");

      const state = container.querySelector('select[name="residence_state"]');
      // 50 estados + DC, mas la opcion vacia de "elige".
      expect(state?.querySelectorAll("option")).toHaveLength(52);
      expect(state?.querySelector('option[value="DC"]')).not.toBeNull();
      expect(state?.querySelector('option[value="PR"]')).toBeNull();

      // Una sola casilla para todos los documentos.
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
      expect(container.querySelector('input[name="consents_agreed"]')).not.toBeNull();

      // Nombre y estado son los unicos campos que se teclean.
      expect(
        container.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), select"),
      ).toHaveLength(2);
      expectNoForbiddenFields(container);
      expect(container.textContent).not.toMatch(/\b18\b/u);
    },
  );

  it("la casilla nombra los documentos que publica el backend, y su version viaja oculta", async () => {
    const consents: readonly ConsentRequirement[] = [
      { key: "OFFICIAL_RULES", version: "2026-10-04", text_key: "OFFICIAL_RULES", required: true },
      { key: "TERMS", version: "2026-09-30", text_key: "TERMS", required: true },
      { key: "PRIVACY", version: "2026-09-30", text_key: "PRIVACY", required: true },
    ];
    const { container } = renderFlow("es", consents);
    await sendCode(container, "nueva@example.invalid", "es");
    await verifyCode(container, "es");

    expect(
      screen.getByText(
        "He leído y acepto las Reglas Oficiales, los Términos y condiciones y la Política de privacidad.",
      ),
    ).toBeInTheDocument();

    // Clave y version juntas: aceptar sin decir que version es una afirmacion sin fecha.
    const hidden = [...container.querySelectorAll('input[name="consent"]')].map((input) =>
      input.getAttribute("value"),
    );
    expect(hidden).toEqual(["OFFICIAL_RULES:2026-10-04", "TERMS:2026-09-30", "PRIVACY:2026-09-30"]);
  });

  it("sin consentimientos publicados no pinta ninguna casilla", async () => {
    const { container } = renderFlow("en", []);
    await sendCode(container, "new@example.invalid", "en");
    await verifyCode(container, "en");

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("una clave de consentimiento desconocida no aparece en crudo", async () => {
    const { container } = renderFlow("es", [unknownConsent]);
    await sendCode(container, "nueva@example.invalid", "es");
    await verifyCode(container, "es");

    // Nunca la clave tecnica delante de un participante; un texto generico.
    expect(screen.queryByText(/SOMETHING_THE_FRONTEND_DOES_NOT_KNOW/)).toBeNull();
    expect(
      screen.getByText(`He leído y acepto ${esMessages.auth.consent.documents.fallback}.`),
    ).toBeInTheDocument();
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
