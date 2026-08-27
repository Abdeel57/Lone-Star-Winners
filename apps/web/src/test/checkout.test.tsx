import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/checkout",
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

vi.mock("@/lib/checkout-actions", () => {
  const idle = { status: "idle" as const, code: null, requestId: null, field: null };
  return { startCheckoutAction: () => Promise.resolve(idle) };
});

import { CheckoutForm } from "@/components/checkout-form";
import { LOCALES, type Locale } from "@/i18n/locales";
import { CHECKOUT_MODES, CHECKOUT_SESSION_STATUSES } from "@/lib/api";
import {
  cancelledCheckout,
  completedCheckout,
  completedWithoutOrder,
  embeddedComponentSession,
  failedCheckout,
  hostedRedirectSession,
  pendingCheckout,
} from "@/mocks/fixtures/checkout";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Checkout (FE-M5).
 *
 * LAS TRES REDES QUE IMPORTAN
 * ---------------------------
 * 1. Que el formulario NO recoja ni un dato de pago. En `hosted_redirect` la
 *    tarjeta se teclea en el dominio del proveedor, y un campo de tarjeta que
 *    apareciera aqui seria un cambio de arquitectura disfrazado de mejora.
 * 2. Que la direccion NO lleve ninguna regla de jurisdiccion: ni lista de
 *    estados, ni pais por defecto, ni patron de codigo postal. La elegibilidad
 *    territorial la fijan las Official Rules y sigue en TBD.
 * 3. Que los cuatro estados de la sesion de pago y las dos modalidades del
 *    adaptador tengan texto en LOS DOS idiomas. Un estado sin texto deja en
 *    blanco justo la pantalla a la que se llega despues de pagar.
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

describe("formulario de checkout", () => {
  it.each(LOCALES)("no recoge ningun dato de pago en %s", (locale) => {
    const { container } = renderIn(locale, <CheckoutForm locale={locale} />);

    for (const forbidden of [
      "card_number",
      "cardnumber",
      "cc-number",
      "cvc",
      "cvv",
      "expiry",
      "exp_date",
    ]) {
      expect(
        container.querySelector(`[name="${forbidden}"]`),
        `el checkout recoge un dato de pago: ${forbidden}`,
      ).toBeNull();
    }

    // Ni un `autocomplete` de tarjeta, que es la otra forma de delatarlo.
    for (const input of container.querySelectorAll("input")) {
      expect(input.getAttribute("autocomplete") ?? "").not.toMatch(/^cc-/);
    }
  });

  it("la region es texto libre y no una lista de estados", () => {
    /*
     * Un desplegable con la lista de estados admitidos seria una regla legal
     * escrita por el frontend (CLAUDE.md #2 y #14). Cuando el backend publique
     * la lista, el desplegable se pinta con SUS valores.
     */
    const { container } = renderIn("en", <CheckoutForm locale="en" />);

    expect(container.querySelector('select[name="region"]')).toBeNull();
    expect(container.querySelector('input[name="region"]')).not.toBeNull();
    expect(container.querySelector('select[name="country"]')).toBeNull();
  });

  it("el pais no trae ningun valor por defecto", () => {
    const { container } = renderIn("en", <CheckoutForm locale="en" />);
    const country = container.querySelector('input[name="country"]');

    expect(country).not.toBeNull();
    expect(country?.getAttribute("value") ?? "").toBe("");
  });

  it("el codigo postal no impone ningun formato", () => {
    const { container } = renderIn("en", <CheckoutForm locale="en" />);
    const postal = container.querySelector('input[name="postal_code"]');

    expect(postal?.hasAttribute("pattern")).toBe(false);
    expect(postal?.hasAttribute("maxlength")).toBe(false);
  });

  it.each(LOCALES)("dice quien cobra, en %s", (locale) => {
    renderIn(locale, <CheckoutForm locale={locale} />);

    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getByText(messages.checkout.providerNote)).toBeInTheDocument();
  });
});

describe("adaptador de proveedor de pago", () => {
  it("las dos modalidades del contrato estan cubiertas por fixtures", () => {
    // `hosted_redirect` se implementa entera; `embedded_component` es el punto
    // de extension y tiene que poder probarse que la interfaz LO DICE en vez de
    // quedarse en blanco.
    expect(CHECKOUT_MODES).toHaveLength(2);
    expect(hostedRedirectSession.mode).toBe("hosted_redirect");
    expect(embeddedComponentSession.mode).toBe("embedded_component");
  });

  it("ningun fixture nombra un proveedor de pago real", () => {
    // La eleccion de proveedor es un DEC pendiente del usuario. Que un fixture
    // se llamara como un proveedor concreto convertiria una decision pendiente
    // en un hecho consumado.
    for (const session of [hostedRedirectSession, embeddedComponentSession]) {
      expect(session.provider).toBe("mock");
    }
  });

  it.each(CHECKOUT_SESSION_STATUSES)("el estado %s tiene texto en los dos idiomas", (status) => {
    // `status` esta estrechado a los cuatro valores del contrato y el objeto
    // los cubre enteros: el acceso no puede fallar ni procede de una peticion.
    // eslint-disable-next-line security/detect-object-injection
    const key = {
      PENDING: "pending",
      COMPLETED: "completed",
      CANCELLED: "cancelled",
      FAILED: "failed",
    }[status];

    for (const messages of [enMessages, esMessages]) {
      const bundle = messages.checkout.return as unknown as Record<string, string>;
      expect(bundle[`${key}Title`], `falta ${key}Title`).toBeTruthy();
      expect(bundle[`${key}Body`], `falta ${key}Body`).toBeTruthy();
    }
  });

  it("un pago confirmado sin pedido todavia es un estado representable", () => {
    // Es real y corto: el webhook llega, el pedido se crea, y entre las dos
    // cosas hay un instante. Sin este caso, la pagina de retorno enviaria a
    // alguien a un 404 justo despues de pagarle.
    expect(completedWithoutOrder.status).toBe("COMPLETED");
    expect(completedWithoutOrder.order_id).toBeNull();
    expect(completedCheckout.order_id).not.toBeNull();
  });

  it("cancelado y fallido no son el mismo estado", () => {
    expect(cancelledCheckout.status).not.toBe(failedCheckout.status);
    expect(pendingCheckout.order_id).toBeNull();
  });
});
