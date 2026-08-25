import { describe, expect, it } from "vitest";

import { loadFeatureFlags } from "@/lib/flags-server";
import { isFeatureEnabled, toFeatureFlags } from "@/lib/flags";
import { allFlagsOff, amoeEnabled, withUnknownFlag } from "@/mocks/fixtures/config";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * Feature flags (DEC-013).
 *
 * Lo que se comprueba aqui no es comodidad de API: es la direccion del fallo.
 * Un flag legalmente material que se enciende solo porque algo fue mal seria un
 * problema legal; uno que se queda apagado es solo una pantalla que no se ve.
 */

describe("toFeatureFlags", () => {
  it("un flag ausente cuenta como apagado", () => {
    const flags = toFeatureFlags({ feature_flags: {}, supported_locales: [] });

    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "internal_draw_enabled")).toBe(false);
  });

  it("lee un flag encendido", () => {
    expect(isFeatureEnabled(toFeatureFlags(amoeEnabled), "amoe_enabled")).toBe(true);
  });

  it("ignora claves que el frontend no conoce", () => {
    // El backend puede ir por delante del frontend sin tirar la pagina abajo.
    const flags = toFeatureFlags(withUnknownFlag);

    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
    expect(flags.size).toBe(Object.keys(allFlagsOff.feature_flags).length);
  });

  it("un valor que no es booleano cuenta como apagado", () => {
    const flags = toFeatureFlags({
      feature_flags: { amoe_enabled: "true" } as unknown as Record<string, boolean>,
      supported_locales: [],
    });

    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
  });
});

describe("loadFeatureFlags", () => {
  it("apaga TODOS los flags si la configuracion no se puede leer", async () => {
    mockApiServer.use(scenarios.serverError("/config"));

    const flags = await loadFeatureFlags("en");

    expect(flags.size).toBe(0);
    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "internal_draw_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "winner_publication_enabled")).toBe(false);
  });

  it("el escenario por defecto de desarrollo tiene todo apagado", async () => {
    // DEC-013: desactivados por defecto. Que el fixture habitual sea "todo
    // apagado" obliga a disenar cada pantalla primero en su estado no
    // disponible, que es como se vera hasta que alguien encienda el flag.
    const flags = await loadFeatureFlags("en");

    for (const value of flags.values()) {
      expect(value).toBe(false);
    }
  });

  it("no enciende el sorteo interno ni siquiera cuando el resto esta encendido", async () => {
    mockApiServer.use(scenarios.siteConfig(amoeEnabled));

    const flags = await loadFeatureFlags("es");

    // DEC-017: `internal_draw_enabled` es el flag con mas consecuencias del
    // sistema y no basta con el para sortear, pero la interfaz nunca debe
    // deducirlo de otro.
    expect(isFeatureEnabled(flags, "internal_draw_enabled")).toBe(false);
  });
});
