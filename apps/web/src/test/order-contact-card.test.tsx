import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/*
 * `getTranslations` de next-intl/server necesita la configuracion de peticion
 * del App Router, que no existe en jsdom. El doble resuelve los diccionarios
 * por el `locale` que se le pasa, que es justo lo que esta tarjeta hace para
 * redactar el mensaje en el idioma del CLIENTE y no en el del panel.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("../../messages/en-US.json")).default;
  const es = (await import("../../messages/es-US.json")).default;

  return {
    setRequestLocale: () => undefined,
    getTranslations: (options: { locale: "en" | "es"; namespace: "admin.orderContact" }) =>
      Promise.resolve(
        createTranslator({
          locale: options.locale,
          messages: options.locale === "en" ? en : es,
          namespace: options.namespace,
        }),
      ),
  };
});

import { OrderContactCard } from "@/components/admin/order-contact-card";
import type { Locale } from "@/i18n/locales";
import { cashPendingOrder } from "@/mocks/fixtures/account";
import { adminOrderContact } from "@/mocks/fixtures/admin";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * CONTACTO DEL CLIENTE DE UN PEDIDO (DEC-094).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que el celular y el correo se pinten enteros y con sus enlaces: el dato
 *    llega sin enmascarar de una ruta con su propia capacidad.
 * 2. Que el WhatsApp vaya al numero en digitos y lleve el mensaje YA
 *    REDACTADO en el idioma del cliente, con el pedido, sus participaciones y
 *    el nombre del sorteo, aunque el panel este en el otro idioma.
 * 3. Que sin participaciones el mensaje no invente ninguna, y que sin celular
 *    no se ofrezca ni WhatsApp ni llamar.
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

const order = { ...cashPendingOrder, order_number: "LSW-10524", entries_granted: 430 };
const promotionName = { "en-US": "2025 Chevrolet Silverado", "es-US": "Chevrolet Silverado 2025" };

/** Texto del mensaje que lleva el enlace de WhatsApp. */
function whatsappText(href: string): string {
  return decodeURIComponent(href.slice(href.indexOf("=") + 1));
}

describe("contacto del cliente de un pedido", () => {
  it("pinta nombre, celular y correo con sus enlaces", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+15055550123" })).toHaveAttribute(
      "href",
      "tel:+15055550123",
    );
    expect(screen.getByRole("link", { name: "ada.lovelace@example.test" })).toHaveAttribute(
      "href",
      "mailto:ada.lovelace@example.test",
    );
    expect(screen.getByRole("link", { name: esMessages.admin.orderContact.call })).toHaveAttribute(
      "href",
      "tel:+15055550123",
    );
  });

  it("el WhatsApp va al numero en digitos y con el mensaje en el idioma del CLIENTE", async () => {
    // Panel en ingles, cliente en espanol: el mensaje sale en espanol.
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName,
      locale: "en",
    });
    renderIn("en", ui);

    const link = screen.getByRole("link", { name: enMessages.admin.orderContact.whatsapp });
    const href = link.getAttribute("href") ?? "";

    expect(href.startsWith("https://wa.me/15055550123?text=")).toBe(true);
    expect(link).toHaveAttribute("target", "_blank");

    const text = whatsappText(href);
    expect(text).toContain("Hola Ada Lovelace");
    expect(text).toContain("LSW-10524");
    expect(text).toContain("430 participaciones");
    expect(text).toContain("Chevrolet Silverado 2025");
  });

  it("un cliente en ingles recibe el mensaje en ingles", async () => {
    const ui = await OrderContactCard({
      contact: { ...adminOrderContact, preferred_locale: "en-US" },
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    const href =
      screen
        .getByRole("link", { name: esMessages.admin.orderContact.whatsapp })
        .getAttribute("href") ?? "";
    const text = whatsappText(href);

    expect(text).toContain("Hi Ada Lovelace");
    expect(text).toContain("430 entries");
    expect(text).toContain("2025 Chevrolet Silverado");
  });

  it("sin participaciones todavia, el mensaje solo nombra el pedido", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order: { ...order, entries_granted: null },
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    const href =
      screen
        .getByRole("link", { name: esMessages.admin.orderContact.whatsapp })
        .getAttribute("href") ?? "";
    const text = whatsappText(href);

    expect(text).toContain("LSW-10524");
    expect(text).not.toContain("participaciones");
  });

  it("sin celular no ofrece WhatsApp ni llamar, pero si el correo", async () => {
    const ui = await OrderContactCard({
      contact: { ...adminOrderContact, phone: null },
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    expect(
      screen.queryByRole("link", { name: esMessages.admin.orderContact.whatsapp }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: esMessages.admin.orderContact.call }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: esMessages.admin.orderContact.email })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:ada.lovelace@example.test"),
    );
  });
});
