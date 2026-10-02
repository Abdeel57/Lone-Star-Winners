import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { NewPasswordFields } from "@/components/auth-form-shell";
import { LOCALES, type Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import type { ApiResult, SiteConfigResponse } from "@/lib/api";
import { passwordMinimumFrom } from "@/lib/password-policy";
import { defaultConfig } from "@/mocks/fixtures/config";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Politica de contrasenas publicada por `GET /config` (`password_policy`).
 *
 * LO QUE SE PROTEGE: que quien se da de alta lea cuantos caracteres hacen falta
 * ANTES de enviar. Con el celular, enterarse despues significaba haber pedido
 * ya el SMS. El numero sale de la API: el caso con 16 falla si alguien lo
 * escribe en el diccionario.
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

function ok(data: SiteConfigResponse): ApiResult<SiteConfigResponse> {
  return { ok: true, data };
}

describe("passwordMinimumFrom", () => {
  it("lee el minimo publicado", () => {
    expect(passwordMinimumFrom(ok(defaultConfig))).toBe(12);
  });

  it("sin politica publicada devuelve null", () => {
    const { password_policy: _omitted, ...withoutPolicy } = defaultConfig;
    expect(passwordMinimumFrom(ok(withoutPolicy))).toBeNull();
  });

  it("descarta un valor que no es un entero positivo", () => {
    for (const minimum of [0, -3, 12.5, Number.NaN]) {
      const config = {
        ...defaultConfig,
        password_policy: { minimum_length: minimum, maximum_length: 1024 },
      };
      expect(passwordMinimumFrom(ok(config))).toBeNull();
    }
  });

  it("si la configuracion fallo devuelve null", () => {
    const failed = {
      ok: false,
      error: { kind: "network" },
    } as unknown as ApiResult<SiteConfigResponse>;
    expect(passwordMinimumFrom(failed)).toBeNull();
  });
});

describe("NewPasswordFields", () => {
  it.each(LOCALES)("dice el minimo antes de enviar y lo exige en %s", (locale) => {
    const { container } = renderIn(locale, <NewPasswordFields result={IDLE} minimumLength={16} />);

    expect(container.textContent).toContain("16");
    for (const input of container.querySelectorAll('input[type="password"]')) {
      expect(input.getAttribute("minlength")).toBe("16");
    }
  });

  it("sin minimo publicado vuelve a la pista generica y no fija minLength", () => {
    const { container } = renderIn("es", <NewPasswordFields result={IDLE} minimumLength={null} />);

    expect(screen.getByText(esMessages.auth.fields.passwordHint)).toBeInTheDocument();
    for (const input of container.querySelectorAll('input[type="password"]')) {
      expect(input.hasAttribute("minlength")).toBe(false);
    }
  });
});
