import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz",
      set: () => undefined,
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { submitAmoeAction } from "@/lib/amoe-actions";
import { amoeSubmissionsPath, apiBaseUrl } from "@/lib/api";
import {
  amoeDisabledConfig,
  amoeOnlineFormConfig,
  amoePendingSubmissionResponse,
} from "@/mocks/fixtures/amoe";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * EL PAYLOAD AMOE SE CONSTRUYE CON LA LISTA DEL BACKEND, NO CON EL FORMULARIO.
 *
 * POR QUE ESTE FICHERO ES EL MAS IMPORTANTE DE AMOE
 * -------------------------------------------------
 * El frontend NO sabe -y no debe saber- que datos se piden para participar sin
 * comprar: eso lo fijan las Official Rules y lo publica el backend en
 * `required_fields`. La accion vuelve a pedir esa lista al enviar y compone el
 * payload a partir de ella.
 *
 * La alternativa -que el formulario le diga a la accion que campos hay, en un
 * `<input type="hidden">`- se edita con las herramientas del navegador en cinco
 * segundos. El resultado seria que el cliente decide la forma del payload de la
 * unica via de participacion que no exige comprar nada.
 *
 * Los dos casos que se comprueban:
 *   1. un campo de MAS en el formulario NO viaja;
 *   2. con la via apagada no se envia nada, se conteste lo que se conteste.
 */

const PROMOTION_SLUG = "gmc-2025";
const PROMOTION_ID = amoeOnlineFormConfig.promotion_id ?? "pro_1";

const IDLE = {
  status: "idle" as const,
  code: null,
  requestId: null,
  field: null,
  retryAfterSeconds: null,
  detail: null,
};

function formWith(entries: Readonly<Record<string, string>>): FormData {
  const formData = new FormData();
  formData.set("locale", "es");
  formData.set("promotion_slug", PROMOTION_SLUG);
  formData.set("promotion_id", PROMOTION_ID);

  for (const [name, value] of Object.entries(entries)) {
    formData.set(name, value);
  }

  return formData;
}

/** Captura el cuerpo del envio. */
function captureSubmission(): { readonly bodies: unknown[] } {
  const bodies: unknown[] = [];

  mockApiServer.use(
    http.post(
      `${apiBaseUrl().replace(/\/+$/, "")}${amoeSubmissionsPath(PROMOTION_ID)}`,
      async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(amoePendingSubmissionResponse, { status: 201 });
      },
    ),
  );

  return { bodies };
}

describe("envio de una participacion gratuita", () => {
  it("manda SOLO los campos que el backend declara", async () => {
    mockApiServer.use(scenarios.amoeConfig(PROMOTION_SLUG, amoeOnlineFormConfig));
    const captured = captureSubmission();

    const result = await submitAmoeAction(
      IDLE,
      formWith({
        full_name: "Alex Rivera",
        email: "participant@example.com",
        postal_code: "78701",
        // Nadie ha pedido esto. Un campo de mas es recogida de datos personales
        // que nadie autorizo (CLAUDE.md #2).
        date_of_birth: "1990-01-01",
        ssn: "000-00-0000",
      }),
    );

    expect(result.status).toBe("ok");
    expect(captured.bodies).toHaveLength(1);

    expect(captured.bodies[0]).toEqual({
      payload: {
        full_name: "Alex Rivera",
        email: "participant@example.com",
        postal_code: "78701",
      },
    });
  });

  it("un campo obligatorio vacio se detiene antes de salir a la red", async () => {
    mockApiServer.use(scenarios.amoeConfig(PROMOTION_SLUG, amoeOnlineFormConfig));
    const captured = captureSubmission();

    const result = await submitAmoeAction(
      IDLE,
      formWith({ full_name: "Alex Rivera", email: "", postal_code: "78701" }),
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("FIELD_REQUIRED");
    expect(result.field).toBe("email");
    expect(captured.bodies).toHaveLength(0);
  });

  it("con la via apagada no se envia nada", async () => {
    // El flag manda. Componer un payload a ciegas seria inventarse el
    // procedimiento de participacion gratuita.
    mockApiServer.use(scenarios.amoeConfig(PROMOTION_SLUG, amoeDisabledConfig));
    const captured = captureSubmission();

    const result = await submitAmoeAction(IDLE, formWith({ full_name: "Alex Rivera" }));

    expect(result.status).toBe("error");
    expect(result.code).toBe("AMOE_NOT_ENABLED");
    expect(captured.bodies).toHaveLength(0);
  });

  it("sin campos publicados tampoco se envia un payload vacio", async () => {
    mockApiServer.use(
      scenarios.amoeConfig(PROMOTION_SLUG, { ...amoeOnlineFormConfig, required_fields: [] }),
    );
    const captured = captureSubmission();

    const result = await submitAmoeAction(IDLE, formWith({ full_name: "Alex Rivera" }));

    expect(result.status).toBe("error");
    expect(result.code).toBe("AMOE_PAYLOAD_INVALID");
    expect(captured.bodies).toHaveLength(0);
  });

  it("los codigos de rechazo del backend llegan a la pantalla", async () => {
    /*
     * Los dos juegos de nombres conviven a proposito: el contrato publica
     * `AMOE_LIMIT_REACHED` y la revision de este hito pidio
     * `AMOE_PERIOD_LIMIT_REACHED`. Mientras no se cierre cual es, la interfaz
     * tiene que sobrevivir a los dos sin inventarse un mensaje.
     */
    for (const code of [
      "AMOE_WINDOW_CLOSED",
      "AMOE_DUPLICATE_SUBMISSION",
      "AMOE_LIMIT_REACHED",
      "AMOE_PERIOD_LIMIT_REACHED",
      "AMOE_PAYLOAD_INVALID",
    ]) {
      mockApiServer.use(
        scenarios.amoeConfig(PROMOTION_SLUG, amoeOnlineFormConfig),
        scenarios.amoeSubmitRejected(PROMOTION_ID, code),
      );

      const result = await submitAmoeAction(
        IDLE,
        formWith({
          full_name: "Alex Rivera",
          email: "participant@example.com",
          postal_code: "78701",
        }),
      );

      expect(result.status, code).toBe("error");
      expect(result.code, code).toBe(code);
    }
  });

  it("si no se puede leer la configuracion, no se envia a ciegas", async () => {
    mockApiServer.use(scenarios.amoeConfigNotFound(PROMOTION_SLUG));
    const captured = captureSubmission();

    const result = await submitAmoeAction(IDLE, formWith({ full_name: "Alex Rivera" }));

    expect(result.status).toBe("error");
    expect(captured.bodies).toHaveLength(0);
  });
});
