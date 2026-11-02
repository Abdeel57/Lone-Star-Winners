import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz",
      set: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers({ host: "panel.interno.test" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

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

import { AddPhoneForm } from "@/components/add-phone-form";
import { OrderContactCard } from "@/components/admin/order-contact-card";
import type { Locale } from "@/i18n/locales";
import { startAddPhoneAction, verifyAddPhoneAction } from "@/lib/account-actions";
import { IDLE, SUCCEEDED, type ActionResult } from "@/lib/action-result";
import { setContactPhoneAction } from "@/lib/admin/actions";
import { API_PATHS, apiBaseUrl } from "@/lib/api";
import { cashPendingOrder } from "@/mocks/fixtures/account";
import { adminOrderContact } from "@/mocks/fixtures/admin";
import { mockApiServer } from "@/mocks/node";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * CELULAR PARA LAS CUENTAS QUE ENTRARON CON CORREO (DEC-097).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Panel: la tarjeta "Cliente" ofrece anadir el celular de CONTACTO solo a
 *    quien tiene la capacidad, a la vista si no hay celular y plegado si ya lo
 *    hay; y la accion manda el numero tal cual a SU ruta.
 * 2. Perfil: el formulario del celular de ACCESO empieza pidiendo el numero
 *    con el aviso de SMS, y sus dos acciones mandan numero, anti-bots y
 *    codigo a sus rutas. Lo que decide si el numero vale es la API.
 */

const API = apiBaseUrl().replace(/\/+$/, "");
const order = { ...cashPendingOrder, order_number: "LSW-10524", entries_granted: 10 };

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

function form(entries: Readonly<Record<string, string>>): FormData {
  const formData = new FormData();
  formData.set("locale", "es");
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
}

const noopAction = (): Promise<ActionResult> => Promise.resolve(SUCCEEDED);

describe("panel: celular de contacto en la tarjeta Cliente", () => {
  it("sin la capacidad no hay formulario", async () => {
    const ui = await OrderContactCard({
      contact: { ...adminOrderContact, phone: null },
      order,
      promotionName: null,
      locale: "es",
    });
    renderIn("es", ui);

    expect(
      screen.queryByLabelText(esMessages.admin.orderContact.phoneFieldLabel),
    ).not.toBeInTheDocument();
  });

  it("con la capacidad y sin celular, el formulario esta a la vista", async () => {
    const ui = await OrderContactCard({
      contact: { ...adminOrderContact, phone: null },
      order,
      promotionName: null,
      locale: "es",
      phoneAction: noopAction,
    });
    renderIn("es", ui);

    expect(screen.getByText(esMessages.admin.orderContact.noPhoneIntro)).toBeInTheDocument();
    expect(screen.getByLabelText(esMessages.admin.orderContact.phoneFieldLabel)).toBeVisible();
    expect(
      screen.getByRole("button", { name: esMessages.admin.orderContact.addPhone }),
    ).toBeInTheDocument();
  });

  it("con celular ya puesto, cambiarlo queda plegado bajo un resumen", async () => {
    const ui = await OrderContactCard({
      contact: adminOrderContact,
      order,
      promotionName: null,
      locale: "es",
      phoneAction: noopAction,
    });
    const { container } = renderIn("es", ui);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText(esMessages.admin.orderContact.changePhone)).toBeInTheDocument();
    expect(screen.queryByText(esMessages.admin.orderContact.noPhoneIntro)).not.toBeInTheDocument();
  });

  it("la accion manda el numero tal cual a la ruta del participante", async () => {
    const bodies: unknown[] = [];
    mockApiServer.use(
      http.put(
        `${API}${API_PATHS.adminParticipants}/${adminOrderContact.participant_id}/contact-phone`,
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({
            participant_id: adminOrderContact.participant_id,
            phone: "+15055550123",
          });
        },
      ),
    );

    const result = await setContactPhoneAction(
      IDLE,
      form({ participant_id: adminOrderContact.participant_id, phone: "(505) 555-0123" }),
    );

    expect(result.status).toBe("ok");
    expect(bodies).toEqual([{ phone: "(505) 555-0123" }]);
  });

  it("un numero que la API rechaza se pinta en el campo", async () => {
    mockApiServer.use(
      http.put(
        `${API}${API_PATHS.adminParticipants}/${adminOrderContact.participant_id}/contact-phone`,
        () =>
          HttpResponse.json(
            { error: { code: "PHONE_INVALID", request_id: "req-phone" } },
            { status: 422 },
          ),
      ),
    );

    const result = await setContactPhoneAction(
      IDLE,
      form({ participant_id: adminOrderContact.participant_id, phone: "123" }),
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("PHONE_INVALID");
    expect(result.field).toBe("phone");
  });

  it("sin numero no llama al backend", async () => {
    const result = await setContactPhoneAction(
      IDLE,
      form({ participant_id: adminOrderContact.participant_id }),
    );
    expect(result.code).toBe("FIELD_REQUIRED");
    expect(result.field).toBe("phone");
  });
});

describe("perfil: anadir el celular de acceso", () => {
  it("empieza pidiendo el numero, con el aviso de SMS", () => {
    renderIn("es", <AddPhoneForm locale="es" />);

    expect(screen.getByText(esMessages.account.profile.phoneIntro)).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(esMessages.auth.fields.phone))).toBeInTheDocument();
    expect(screen.getByText(esMessages.auth.code.smsDisclosure)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: esMessages.account.profile.phoneSend }),
    ).toBeInTheDocument();
  });

  it("pedir el codigo manda el numero y el token anti-bots a su ruta", async () => {
    const bodies: unknown[] = [];
    mockApiServer.use(
      http.post(`${API}${API_PATHS.mePhoneStart}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ acknowledged: true });
      }),
    );

    const result = await startAddPhoneAction(
      IDLE,
      form({ phone: "505-555-0123", "cf-turnstile-response": "token-humano" }),
    );

    expect(result.status).toBe("ok");
    expect(bodies).toEqual([{ phone: "505-555-0123", bot_check_token: "token-humano" }]);
  });

  it("el codigo viaja sin espacios y un codigo incorrecto se pinta en su campo", async () => {
    const bodies: unknown[] = [];
    mockApiServer.use(
      http.post(`${API}${API_PATHS.mePhoneVerify}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          { error: { code: "SIGN_IN_CODE_INVALID", request_id: "req-code" } },
          { status: 422 },
        );
      }),
    );

    const result = await verifyAddPhoneAction(IDLE, form({ phone: "5055550123", code: "123 456" }));

    expect(bodies).toEqual([{ phone: "5055550123", code: "123456" }]);
    expect(result.code).toBe("SIGN_IN_CODE_INVALID");
    expect(result.field).toBe("code");
  });

  it("si el numero ya es de otra cuenta lo dice con su propio codigo", async () => {
    mockApiServer.use(
      http.post(`${API}${API_PATHS.mePhoneVerify}`, () =>
        HttpResponse.json(
          { error: { code: "PHONE_IN_OTHER_ACCOUNT", request_id: "req-other" } },
          { status: 409 },
        ),
      ),
    );

    const result = await verifyAddPhoneAction(IDLE, form({ phone: "5055550123", code: "123456" }));

    expect(result.status).toBe("error");
    expect(result.code).toBe("PHONE_IN_OTHER_ACCOUNT");
    expect(esMessages.apiErrors.PHONE_IN_OTHER_ACCOUNT).toBeTruthy();
    expect(enMessages.apiErrors.PHONE_IN_OTHER_ACCOUNT).toBeTruthy();
  });
});
