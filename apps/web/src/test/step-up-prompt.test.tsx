import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/*
 * `usePathname` necesita el router del App Router, que no existe en jsdom. El
 * doble devuelve la ficha de un pedido del panel: es desde donde se pide el
 * codigo en el caso que motivo esto (anular un pedido cobrado, DEC-091).
 */
const route = { pathname: "/admin/es/orders/ord_0000000000000001" };

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

import { SensitiveConfirmForm } from "@/components/admin/sensitive-confirm";
import { FormError } from "@/components/auth-form-shell";
import { LOCALES, type Locale } from "@/i18n/locales";
import type { ActionResult } from "@/lib/action-result";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * `STEP_UP_REQUIRED` SE ENSENA COMO EL PASO QUE FALTA, NO COMO UNA AVERIA.
 *
 * Quien anulaba un pedido con el segundo factor caducado leia "no hemos podido
 * cargar esta seccion" en rojo, con referencia de soporte, y un texto que le
 * mandaba a buscar un boton pequeno en la cabecera. Lo que protege este
 * fichero: que el aviso diga de donde sale el codigo, que el boton para ir a
 * escribirlo este EN el aviso, que la vuelta aterrice en la misma seccion, y
 * que no se pinte ni el titulo de error ni la referencia.
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

const STEP_UP: ActionResult = {
  status: "error",
  code: "STEP_UP_REQUIRED",
  requestId: "req_stepup_0000000001",
  field: null,
  retryAfterSeconds: null,
  detail: null,
};

const FORBIDDEN: ActionResult = { ...STEP_UP, code: "FORBIDDEN", requestId: "req_forbidden_01" };

describe("aviso de step-up en los formularios", () => {
  it("ofrece el boton de confirmar el codigo dentro del aviso, en los dos idiomas", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      route.pathname = `/admin/${locale}/orders/ord_0000000000000001`;

      const view = renderIn(locale, <FormError result={STEP_UP} />);

      expect(screen.getByText(messages.states.stepUp.title)).toBeInTheDocument();
      expect(screen.getByText(messages.states.stepUp.body)).toBeInTheDocument();

      const link = screen.getByRole("link", { name: messages.states.stepUp.cta });
      expect(link).toHaveAttribute(
        "href",
        `/admin/${locale}/mfa?next=${encodeURIComponent(route.pathname)}`,
      );

      view.unmount();
    }
  });

  it("no lo pinta como fallo: ni titulo de error ni referencia de soporte", () => {
    route.pathname = "/admin/es/orders/ord_0000000000000001";
    const { container } = renderIn("es", <FormError result={STEP_UP} />);

    expect(screen.queryByText(esMessages.states.actionFailed.title)).not.toBeInTheDocument();
    expect(screen.queryByText(esMessages.states.loadFailed.title)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(STEP_UP.requestId);
  });

  it("la vuelta aterriza en la seccion desde la que se pidio", () => {
    route.pathname = "/admin/es/orders/ord_0000000000000001";
    renderIn("es", <FormError result={STEP_UP} stepUpAnchor="void-order" />);

    expect(screen.getByRole("link", { name: esMessages.states.stepUp.cta })).toHaveAttribute(
      "href",
      `/admin/es/mfa?next=${encodeURIComponent(`${route.pathname}#void-order`)}`,
    );
  });

  it("los demas fallos de una accion siguen diciendo que la accion no se completo", () => {
    const { container } = renderIn("es", <FormError result={FORBIDDEN} />);

    expect(screen.getByText(esMessages.states.actionFailed.title)).toBeInTheDocument();
    expect(screen.getByText(esMessages.apiErrors.FORBIDDEN)).toBeInTheDocument();
    expect(container.textContent).toContain(FORBIDDEN.requestId);
    expect(
      screen.queryByRole("link", { name: esMessages.states.stepUp.cta }),
    ).not.toBeInTheDocument();
  });

  it("la confirmacion sensible lo ensena tras enviar, con la vuelta a su seccion", async () => {
    route.pathname = "/admin/es/orders/ord_0000000000000001";
    const user = userEvent.setup();

    renderIn(
      "es",
      <SensitiveConfirmForm
        locale="es"
        action={() => Promise.resolve(STEP_UP)}
        hiddenFields={{ order_id: "ord_0000000000000001" }}
        impact={[
          {
            label: esMessages.admin.orderVoid.impactMoney,
            before: "$215.00",
            delta: esMessages.admin.orderVoid.impactCardRefund,
            after: "$0.00",
          },
        ]}
        reasons={[{ value: "DUPLICATE_ORDER", label: esMessages.admin.reasons.DUPLICATE_ORDER }]}
        submitLabel={esMessages.admin.orderVoid.submit}
        confirmLabel="confirmo"
        destructive
        stepUpAnchor="void-order"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: esMessages.admin.orderVoid.submit }));

    expect(await screen.findByText(esMessages.states.stepUp.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: esMessages.states.stepUp.cta })).toHaveAttribute(
      "href",
      `/admin/es/mfa?next=${encodeURIComponent(`${route.pathname}#void-order`)}`,
    );
  });
});
