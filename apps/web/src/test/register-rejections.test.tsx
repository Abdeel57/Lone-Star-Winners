import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PasswordField } from "@/components/auth-form-shell";
import { LOCALES, type Locale } from "@/i18n/locales";
import { fromFailure } from "@/lib/action-result";
import type { ApiFailure } from "@/lib/api";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Rechazos del alta (seccion 10 del contrato, `POST /auth/register`).
 *
 * LO QUE SE PROTEGE
 * -----------------
 * Que quien teclea una contrasena corta lea CUANTOS caracteres hacen falta, y
 * que ese numero sea el que manda el backend en `details.minimum_length`, no
 * uno escrito en el frontend. Si alguien "simplifica" esto poniendo un 12 en el
 * diccionario, el dia que `packages/security` suba el minimo esta pantalla
 * mentiria, y el caso de abajo con un 16 es el que lo detecta.
 */

function weakPassword(details: unknown): ApiFailure {
  return {
    kind: "http",
    status: 422,
    code: "WEAK_PASSWORD",
    requestId: "01JC000000000000000000EXAMPLE",
    details,
  };
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

describe("fromFailure con WEAK_PASSWORD", () => {
  it("publica el minimo que manda el backend", () => {
    const result = fromFailure(
      weakPassword({ reason: "too_short", minimum_length: 12, maximum_length: 1024 }),
      "password",
    );

    expect(result.code).toBe("WEAK_PASSWORD");
    expect(result.field).toBe("password");
    expect(result.minimumPasswordLength).toBe(12);
  });

  it("no anuncia un minimo a quien se paso del maximo", () => {
    const result = fromFailure(
      weakPassword({ reason: "too_long", minimum_length: 12, maximum_length: 1024 }),
      "password",
    );

    expect(result.minimumPasswordLength).toBeUndefined();
  });

  it.each([
    ["sin detalles", null],
    ["minimo que no es un numero", { reason: "too_short", minimum_length: "12" }],
    ["minimo no entero", { reason: "too_short", minimum_length: 12.5 }],
    ["minimo no positivo", { reason: "too_short", minimum_length: 0 }],
  ])("descarta un detalle que no se puede creer: %s", (_name, details) => {
    expect(fromFailure(weakPassword(details), "password").minimumPasswordLength).toBeUndefined();
  });

  it("otro codigo con la misma forma de detalles no lo publica", () => {
    const result = fromFailure(
      { ...weakPassword({ reason: "too_short", minimum_length: 12 }), code: "VALIDATION_FAILED" },
      "password",
    );

    expect(result.minimumPasswordLength).toBeUndefined();
  });
});

describe("el campo de contrasena dice cuantos caracteres hacen falta", () => {
  it.each(LOCALES)("interpola el numero del backend en %s", (locale) => {
    // 16 y no 12 a proposito: si el numero estuviera escrito en el diccionario,
    // este caso fallaria.
    const result = fromFailure(
      weakPassword({ reason: "too_short", minimum_length: 16 }),
      "password",
    );

    renderIn(
      locale,
      <PasswordField result={result} name="password" label="x" purpose="new-password" />,
    );

    expect(screen.getByRole("alert").textContent).toContain("16");
  });

  it("sin minimo publicado cae al mensaje generico del codigo", () => {
    const result = fromFailure(weakPassword(null), "password");

    renderIn(
      "es",
      <PasswordField result={result} name="password" label="x" purpose="new-password" />,
    );

    expect(screen.getByRole("alert").textContent).toBe(esMessages.apiErrors.WEAK_PASSWORD);
  });

  it("el error de OTRO campo no se pinta en este", () => {
    const result = fromFailure(
      weakPassword({ reason: "too_short", minimum_length: 12 }),
      "password",
    );

    renderIn(
      "es",
      <PasswordField
        result={result}
        name="password_confirmation"
        label="x"
        purpose="new-password"
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
