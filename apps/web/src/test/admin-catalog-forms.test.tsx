import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ProductForm } from "@/components/admin/product-form";
import { PromotionForm } from "@/components/admin/promotion-form";
import { PromotionTransitionForm } from "@/components/admin/promotion-transition-form";
import { LOCALES, type Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * LOS FORMULARIOS DE ALTA DEL PANEL (seccion 12).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que un producto NO se pueda crear con un solo idioma. El formulario pide
 *    los dos y los dos viajan: es la forma verificable del principio 4.
 * 2. Que el precio viaje TAL COMO SE TECLEO ("25.50"). La conversion a unidad
 *    menor es del servidor y tiene su propio test; si el formulario la hiciera
 *    aqui, existiria aritmetica de precios en el cliente.
 * 3. Que la transicion bloqueada diga POR QUE antes del boton, y que el boton
 *    este deshabilitado. No es el control -el motor lo es-, es no mandar a
 *    nadie a elegir motivo y confirmar algo que ya se sabe que va a fallar.
 * 4. Que activar exija motivo y confirmacion, y que los dos viajen.
 *
 * Las acciones son dobles que registran el `FormData`: lo que se comprueba es
 * lo que el formulario manda, no lo que el servidor hace con ello.
 */

function messagesFor(locale: Locale) {
  return locale === "en" ? enMessages : esMessages;
}

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

function capturing(): {
  readonly submitted: FormData[];
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
} {
  const submitted: FormData[] = [];
  return {
    submitted,
    action: (_previous, formData) => {
      submitted.push(formData);
      return Promise.resolve(IDLE);
    },
  };
}

describe("ProductForm (alta)", () => {
  it("manda los dos idiomas y el precio tal como se tecleo", async () => {
    const user = userEvent.setup();
    const capture = capturing();

    renderIn("es", <ProductForm locale="es" action={capture.action} />);

    await user.type(screen.getByLabelText(/^SKU/u), "GORRA-LS-001");
    await user.type(screen.getByLabelText(/Dirección en la tienda/u), "gorra-lone-star");
    await user.type(screen.getByLabelText(/Nombre en español/u), "Gorra Lone Star");
    await user.type(screen.getByLabelText(/Nombre en inglés/u), "Lone Star Cap");
    await user.type(screen.getByLabelText(/^Precio/u), "25.50");
    await user.type(screen.getByLabelText(/^Existencias/u), "100");

    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    const sent = capture.submitted[0];
    expect(sent).toBeDefined();
    expect(sent?.get("locale")).toBe("es");
    expect(sent?.get("sku")).toBe("GORRA-LS-001");
    expect(sent?.get("name_es")).toBe("Gorra Lone Star");
    expect(sent?.get("name_en")).toBe("Lone Star Cap");
    // Sin convertir: la unidad menor la calcula el servidor.
    expect(sent?.get("price")).toBe("25.50");
    expect(sent?.get("currency")).toBe("USD");
    expect(sent?.get("stock")).toBe("100");
  });

  it("los dos nombres son obligatorios en el marcado", () => {
    renderIn("en", <ProductForm locale="en" action={capturing().action} />);

    expect(screen.getByLabelText(/Name in Spanish/u)).toBeRequired();
    expect(screen.getByLabelText(/Name in English/u)).toBeRequired();
  });

  it("al editar no ofrece SKU ni direccion, y rellena lo actual", () => {
    renderIn(
      "es",
      <ProductForm
        locale="es"
        action={capturing().action}
        product={{
          id: "prd_1",
          sku: "HW-TEE-001",
          slug: "heavyweight-tee",
          currency: "USD",
          name: { "es-US": "Camiseta", "en-US": "Tee" },
          priceText: "25.00",
          stockQuantity: null,
        }}
      />,
    );

    expect(screen.queryByLabelText(/^SKU/u)).toBeNull();
    expect(screen.getByLabelText(/^Precio/u)).toHaveValue("25.00");
    // Existencias sin gestionar: el campo queda VACIO, no en "0".
    expect(screen.getByLabelText(/^Existencias/u)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
  });
});

describe("PromotionForm (alta)", () => {
  it("la zona horaria legal no tiene valor por defecto", () => {
    renderIn("es", <PromotionForm locale="es" action={capturing().action} />);

    const zone = screen.getByLabelText(/Zona horaria legal/u);
    expect(zone).toBeRequired();
    expect(zone).toHaveValue("");
  });

  it("al editar la zona es un dato y las fechas llegan en hora de pared", () => {
    renderIn(
      "en",
      <PromotionForm
        locale="en"
        action={capturing().action}
        promotion={{
          id: "prm_1",
          slug: "gmc-2025",
          internalName: "GMC 2025",
          legalTimezone: "America/Chicago",
          publicName: { "es-US": "Gana", "en-US": "Win" },
          startsAtWall: "2026-09-01T00:00",
          endsAtWall: null,
        }}
      />,
    );

    expect(screen.queryByLabelText(/Legal time zone/u)).toBeNull();
    expect(screen.getByLabelText(/^Starts/u)).toHaveValue("2026-09-01T00:00");
    expect(screen.getByLabelText(/^Ends/u)).toHaveValue("");
    expect(screen.getAllByText(/America\/Chicago/u).length).toBeGreaterThan(0);
  });
});

describe("PromotionTransitionForm", () => {
  it("bloqueada: dice por que ANTES del boton y el boton no se puede pulsar", () => {
    renderIn(
      "es",
      <PromotionTransitionForm
        locale="es"
        action={capturing().action}
        promotionId="prm_1"
        transition="activate"
        blockedReason="No se puede activar todavía: no tiene ninguna versión de reglas activa."
        reasons={[{ value: "PROMOTION_LAUNCH_APPROVED", label: "Lanzamiento aprobado" }]}
      />,
    );

    const alert = screen.getByText(/no tiene ninguna versión de reglas activa/u);
    const button = screen.getByRole("button", { name: "Activar" });

    expect(button).toBeDisabled();
    // Orden en el documento: el aviso precede al boton.
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("activar exige motivo y confirmacion, y los dos viajan", async () => {
    const user = userEvent.setup();
    const capture = capturing();

    renderIn(
      "en",
      <PromotionTransitionForm
        locale="en"
        action={capture.action}
        promotionId="prm_1"
        transition="activate"
        reasons={[
          { value: "PROMOTION_LAUNCH_APPROVED", label: "Launch approved" },
          { value: "OTHER", label: "Other" },
        ]}
      />,
    );

    const button = screen.getByRole("button", { name: "Activate" });
    expect(button).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();

    await user.click(button);

    const sent = capture.submitted[0];
    expect(sent?.get("promotion_id")).toBe("prm_1");
    expect(sent?.get("reason_code")).toBe("PROMOTION_LAUNCH_APPROVED");
    expect(sent?.get("confirmed")).not.toBeNull();
  });

  it("programar no pide motivo", () => {
    renderIn(
      "es",
      <PromotionTransitionForm
        locale="es"
        action={capturing().action}
        promotionId="prm_1"
        transition="schedule"
        reasons={[]}
      />,
    );

    expect(screen.queryByLabelText(/^Motivo/u)).toBeNull();
    expect(screen.getByRole("button", { name: "Programar" })).toBeInTheDocument();
  });
});

describe("los dos idiomas", () => {
  it.each(LOCALES)("el formulario de producto se pinta entero en %s", (locale) => {
    renderIn(locale, <ProductForm locale={locale} action={capturing().action} />);
    // Ninguna clave sin traducir: next-intl las pintaria como `admin.catalog.x`.
    expect(document.body.textContent).not.toContain("admin.catalog.");
  });
});
