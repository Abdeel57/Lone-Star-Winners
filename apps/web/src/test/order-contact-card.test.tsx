import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

/*
 * El origen del enlace sale de `WEB_PUBLIC_URL` (la misma que usan los correos)
 * y, sin ella, de `NEXT_PUBLIC_SITE_URL` o las cabeceras. Aqui se fija la
 * variable y se dobla `headers()` con el host interno del panel: el enlace
 * tiene que llevar el dominio canonico, NUNCA el de quien opera.
 */
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ host: "panel.interno.test" })),
}));

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
 *    REDACTADO en el idioma del cliente, con el pedido, sus participaciones,
 *    el nombre del sorteo y el enlace a "Mis participaciones" (por el login,
 *    con vuelta), aunque el panel este en el otro idioma.
 * 3. Que el SMS lleve el mismo mensaje sin los asteriscos de las negritas.
 * 4. Que sin participaciones el mensaje no invente ninguna, y que sin celular
 *    no se ofrezca ni WhatsApp, ni SMS, ni llamar.
 * 5. Que el mensaje termine con las tres redes de la tienda, despues del enlace
 *    y en el idioma del cliente, tambien en el correo.
 * 6. Que nada rompa la presentacion: WhatsApp por `api.whatsapp.com` (`wa.me`
 *    estropea los emojis), negritas solo ahi, saltos CRLF en el correo, emojis
 *    sin selector de variacion y enlaces de largo razonable.
 */

const SITE = "https://lonestarwinners.test";

beforeAll(() => {
  // `WEB_PUBLIC_URL` es la fuente primaria en produccion; `panel.interno.test`
  // (el host doblado) no debe aparecer nunca en el enlace.
  vi.stubEnv("WEB_PUBLIC_URL", SITE);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

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

/** Texto del mensaje que lleva un enlace `...&text=` de WhatsApp o `sms:...?&body=`. */
function messageText(href: string): string {
  const marker = href.startsWith("sms:") ? "&body=" : "&text=";
  return decodeURIComponent(href.slice(href.indexOf(marker) + marker.length));
}

function hrefOf(name: string): string {
  return screen.getByRole("link", { name }).getAttribute("href") ?? "";
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
    expect(hrefOf(esMessages.admin.orderContact.call)).toBe("tel:+15055550123");
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

    expect(href.startsWith("https://api.whatsapp.com/send?phone=15055550123&text=")).toBe(true);
    expect(link).toHaveAttribute("target", "_blank");

    const text = messageText(href);
    expect(text).toContain("Hola Ada Lovelace");
    expect(text).toContain("LSW-10524");
    expect(text).toContain("430 participaciones");
    expect(text).toContain("Chevrolet Silverado 2025");
  });

  it("el mensaje lleva el enlace a Mis participaciones, por el login y en el idioma del cliente", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName,
      locale: "en",
    });
    renderIn("en", ui);

    const text = messageText(hrefOf(enMessages.admin.orderContact.whatsapp));

    // Dominio canonico (la variable), no el host del panel; idioma del cliente;
    // login con vuelta a /account/entries, que es como entra quien no tiene sesion.
    expect(text).toContain(`${SITE}/es/account/login?next=/account/entries`);
    expect(text).not.toContain("panel.interno.test");
  });

  it("el SMS abre la app de mensajes con el texto del WhatsApp, sin los asteriscos", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    const sms = hrefOf(esMessages.admin.orderContact.sms);
    expect(sms.startsWith("sms:+15055550123?&body=")).toBe(true);

    const whatsapp = messageText(hrefOf(esMessages.admin.orderContact.whatsapp));
    expect(whatsapp).toContain("*LSW-10524*");
    expect(whatsapp).toContain("*430 participaciones*");
    expect(messageText(sms)).not.toContain("*");
    expect(messageText(sms)).toBe(whatsapp.replace(/\*/gu, ""));
  });

  it("el mensaje se presenta bien en cualquier canal y dispositivo", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    const whatsappHref = hrefOf(esMessages.admin.orderContact.whatsapp);
    const smsHref = hrefOf(esMessages.admin.orderContact.sms);
    const mailHref = hrefOf(esMessages.admin.orderContact.email);

    // `wa.me` cambia los emojis por el caracter de reemplazo al redirigir.
    expect(whatsappHref).not.toContain("wa.me");

    const whatsapp = messageText(whatsappHref);
    expect(whatsapp).toContain("✅");
    expect(whatsapp).not.toContain("�");
    // El selector de variacion (FE0F) sale como cuadrito en telefonos viejos.
    expect(whatsapp).not.toContain("️");

    // Cada enlace en su linea, para que ningun telefono lo pegue al texto.
    const lines = whatsapp.split("\n");
    expect(lines).toContain(`${SITE}/es/account/login?next=/account/entries`);

    // Correo: sin negritas y con saltos CRLF (RFC 6068).
    const mail = decodeURIComponent(mailHref);
    expect(mail).not.toContain("*");
    expect(mail).toContain("\r\n\r\n");
    expect(mail.replace(/\r\n/gu, "")).not.toContain("\n");

    // Algunos navegadores y clientes de correo cortan los enlaces muy largos.
    for (const href of [whatsappHref, smsHref, mailHref]) {
      expect(href.length).toBeLessThan(2000);
    }
  });

  it("un cliente en ingles recibe el mensaje y el enlace en ingles", async () => {
    const ui = await OrderContactCard({
      contact: { ...adminOrderContact, preferred_locale: "en-US" },
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    const text = messageText(hrefOf(esMessages.admin.orderContact.whatsapp));

    expect(text).toContain("Hi Ada Lovelace");
    expect(text).toContain("430 entries");
    expect(text).toContain("2025 Chevrolet Silverado");
    expect(text).toContain(`${SITE}/en/account/login?next=/account/entries`);
  });

  it("el mensaje termina con las redes sociales, en el idioma del cliente", async () => {
    const socials = [
      "📘 Facebook: https://www.facebook.com/share/1EoeJLnhF8/",
      "📸 Instagram: https://www.instagram.com/lonestarwinners_/",
      "🎵 TikTok: https://www.tiktok.com/@lonestarwinners_/",
    ].join("\n");

    const uiEs = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName,
      locale: "en",
    });
    const { unmount } = renderIn("en", uiEs);

    const textEs = messageText(hrefOf(enMessages.admin.orderContact.whatsapp));
    expect(textEs.endsWith(`${esMessages.admin.orderContact.socialsIntro}\n${socials}`)).toBe(true);
    expect(textEs.indexOf("/account/login")).toBeLessThan(textEs.indexOf("Facebook:"));

    // El correo comparte el texto, con saltos CRLF: `decodeURIComponent` del enlace entero.
    const mail = decodeURIComponent(hrefOf(enMessages.admin.orderContact.email));
    expect(mail.endsWith(socials.replace(/\n/gu, "\r\n"))).toBe(true);
    unmount();

    const uiEn = await OrderContactCard({
      contact: { ...adminOrderContact, preferred_locale: "en-US" },
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", uiEn);

    const textEn = messageText(hrefOf(esMessages.admin.orderContact.whatsapp));
    expect(textEn.endsWith(`${enMessages.admin.orderContact.socialsIntro}\n${socials}`)).toBe(true);
  });

  it("sin participaciones todavia, el mensaje solo nombra el pedido", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order: { ...order, entries_granted: null },
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    const text = messageText(hrefOf(esMessages.admin.orderContact.whatsapp));

    expect(text).toContain("LSW-10524");
    expect(text).not.toContain("430");
    expect(text).not.toContain("Confirmamos");
  });

  it("sin celular no ofrece WhatsApp, SMS ni llamar, pero si el correo", async () => {
    const ui = await OrderContactCard({
      contact: { ...adminOrderContact, phone: null },
      order,
      promotionName,
      locale: "es",
    });
    renderIn("es", ui);

    for (const name of [
      esMessages.admin.orderContact.whatsapp,
      esMessages.admin.orderContact.sms,
      esMessages.admin.orderContact.call,
    ]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(hrefOf(esMessages.admin.orderContact.email)).toContain(
      "mailto:ada.lovelace@example.test",
    );
  });
});
