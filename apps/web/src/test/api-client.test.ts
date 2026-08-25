import { describe, expect, it } from "vitest";

import { API_PATHS, fetchActivePromotion, fetchSiteConfig } from "@/lib/api";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * Capa de API contra MSW.
 *
 * Estos tests no comprueban el backend (que no existe): comprueban que la capa
 * de adaptacion se comporta bien ante cada forma de respuesta, incluidas las
 * que hoy nadie ha contratado todavia. Es lo que permite sustituir el
 * adaptador por el cliente generado desde OpenAPI (DEC-014) y saber que la
 * interfaz sigue reaccionando igual.
 */

describe("fetchActivePromotion", () => {
  it("devuelve la promocion cuando la hay", async () => {
    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.status).toBe("active");
    // DEC-010: el importe viaja como entero en unidad menor, nunca como decimal.
    expect(Number.isInteger(result.data?.prize_value?.amount_minor)).toBe(true);
    // DEC-011: la promocion declara su zona horaria legal.
    expect(result.data?.legal_timezone).toBe("America/Chicago");
  });

  it("trata el 404 como 'no hay promocion abierta', no como error", async () => {
    mockApiServer.use(scenarios.noActivePromotion());

    const result = await fetchActivePromotion("es");

    // Entre promociones no hay ninguna activa. Eso es un estado vacio, no un
    // fallo: pintarlo como error asustaria al participante sin motivo.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("propaga codigo y request_id de un error del servidor", async () => {
    mockApiServer.use(scenarios.serverError(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http");
    expect(result.error.status).toBe(500);
    expect(result.error.code).toBe("INTERNAL_ERROR");
    // El `request_id` es lo unico que permite a soporte encontrar el fallo.
    expect(result.error.requestId).toBe("req_mock_000000000000");
  });

  it("acepta el envelope sin `message_key` y no reintroduce el campo (DEC-031)", async () => {
    // DEC-031 elimina `message_key` del contrato: `code` es la unica clave.
    // Un envelope que solo trae `code` es VALIDO, no malformado.
    mockApiServer.use(scenarios.serverError(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http");
    expect(result.error.code).toBe("INTERNAL_ERROR");
    // Si alguien reintrodujera `messageKey`, este test lo delata.
    expect(Object.keys(result.error)).not.toContain("messageKey");
  });

  it("distingue una respuesta que no respeta el envelope de DEC-022", async () => {
    mockApiServer.use(scenarios.malformedError(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // No es un error de dominio: es un defecto del backend, y hay que poder
    // verlo como tal en lugar de disfrazarlo de error de negocio.
    expect(result.error.kind).toBe("malformed");
    expect(result.error.code).toBeNull();
  });

  it("no lanza excepciones cuando no hay red", async () => {
    mockApiServer.use(scenarios.networkFailure(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network");
    expect(result.error.status).toBeNull();
  });
});

describe("fetchSiteConfig", () => {
  it("devuelve la configuracion publica", async () => {
    const result = await fetchSiteConfig("en");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.supported_locales).toEqual(["en-US", "es-US"]);
  });
});
