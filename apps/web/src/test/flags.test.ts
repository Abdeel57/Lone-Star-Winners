import { describe, expect, it } from "vitest";

import { FEATURE_FLAG_KEYS } from "@/lib/api";
import { loadFeatureFlags, loadServerUiConfig } from "@/lib/flags-server";
import { isFeatureEnabled, safeDefaultFor, toFeatureFlags } from "@/lib/flags";
import {
  amoeEnabledWithoutMode,
  amoeMailIn,
  amoeOnlineForm,
  defaultConfig,
  withUnknownFlag,
} from "@/mocks/fixtures/config";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * Feature flags (DEC-013, DEC-032).
 *
 * Lo que se comprueba aqui no es comodidad de API: es la DIRECCION DEL FALLO.
 * Un flag legalmente material que se enciende solo porque algo fue mal seria un
 * problema legal; uno que se queda apagado es solo una pantalla que no se ve.
 *
 * Con una excepcion, y es la que mas atencion merece: la segunda aprobacion de
 * acciones sensibles es una PROTECCION, no una funcion. Su direccion segura es
 * la contraria, y por eso DEC-032 la hace arrancar en `true`.
 */

describe("lista canonica (DEC-032)", () => {
  it("tiene los doce flags acordados", () => {
    expect(FEATURE_FLAG_KEYS).toHaveLength(12);
  });

  it("todos los nombres estan en snake_case minuscula", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(key, `nombre fuera de convencion: ${key}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("solo la segunda aprobacion falla hacia encendido", () => {
    const failingOn = FEATURE_FLAG_KEYS.filter((key) => safeDefaultFor(key));
    expect(failingOn).toEqual(["dual_approval_for_sensitive_actions_enabled"]);
  });
});

describe("toFeatureFlags", () => {
  it("un flag ausente cae en su valor seguro", () => {
    const flags = toFeatureFlags({
      feature_flags: {},
      amoe_mode: null,
      supported_locales: [],
    });

    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "internal_draw_enabled")).toBe(false);
    // La proteccion no desaparece porque falte el dato.
    expect(isFeatureEnabled(flags, "dual_approval_for_sensitive_actions_enabled")).toBe(true);
  });

  it("lee un flag encendido", () => {
    expect(isFeatureEnabled(toFeatureFlags(amoeOnlineForm), "amoe_enabled")).toBe(true);
  });

  it("respeta un flag apagado explicitamente, incluso el de la proteccion", () => {
    // Si el admin lo apaga a proposito y con motivo auditado, la interfaz tiene
    // que reflejarlo. El valor seguro es para cuando NO se sabe.
    const flags = toFeatureFlags({
      ...defaultConfig,
      feature_flags: {
        ...defaultConfig.feature_flags,
        dual_approval_for_sensitive_actions_enabled: false,
      },
    });

    expect(isFeatureEnabled(flags, "dual_approval_for_sensitive_actions_enabled")).toBe(false);
  });

  it("ignora claves que el frontend no conoce", () => {
    // El backend puede ir por delante del frontend sin tirar la pagina abajo.
    const flags = toFeatureFlags(withUnknownFlag);

    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
    expect(flags.size).toBe(FEATURE_FLAG_KEYS.length);
  });

  it("un valor que no es booleano se descarta y la clave cae en su valor seguro", () => {
    const flags = toFeatureFlags({
      feature_flags: { amoe_enabled: "true" } as unknown as Record<string, boolean>,
      amoe_mode: null,
      supported_locales: [],
    });

    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
  });
});

describe("loadFeatureFlags", () => {
  it("ante un fallo de configuracion, cada flag cae en su direccion segura", async () => {
    mockApiServer.use(scenarios.serverError("/config"));

    const flags = await loadFeatureFlags("en");

    expect(flags.size).toBe(0);
    expect(isFeatureEnabled(flags, "amoe_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "internal_draw_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "winner_publication_enabled")).toBe(false);
    expect(isFeatureEnabled(flags, "manual_adjustments_enabled")).toBe(false);
    // Un fallo de red no puede rebajar el control sobre una accion sensible.
    expect(isFeatureEnabled(flags, "dual_approval_for_sensitive_actions_enabled")).toBe(true);
  });

  it("el escenario por defecto reproduce los valores de DEC-032", async () => {
    const flags = await loadFeatureFlags("en");

    for (const key of FEATURE_FLAG_KEYS) {
      expect(isFeatureEnabled(flags, key), `valor inesperado para ${key}`).toBe(
        safeDefaultFor(key),
      );
    }
  });

  it("no enciende el sorteo interno ni siquiera cuando el resto esta encendido", async () => {
    mockApiServer.use(scenarios.siteConfig(amoeOnlineForm));

    const flags = await loadFeatureFlags("es");

    // DEC-017: `internal_draw_enabled` es el flag con mas consecuencias del
    // sistema y no basta con el para sortear, pero la interfaz nunca debe
    // deducirlo de otro.
    expect(isFeatureEnabled(flags, "internal_draw_enabled")).toBe(false);
  });
});

describe("loadServerUiConfig", () => {
  it("lee flags y modalidad AMOE en una sola llamada", async () => {
    mockApiServer.use(scenarios.siteConfig(amoeMailIn));

    const config = await loadServerUiConfig("en");

    expect(isFeatureEnabled(config.flags, "amoe_enabled")).toBe(true);
    expect(config.amoeMode).toBe("MAIL_IN_REVIEW");
  });

  it("la modalidad puede faltar aunque la via este encendida", async () => {
    // Estado real: alguien enciende la funcion antes de publicar la modalidad.
    // La interfaz tiene que poder decirlo en vez de elegir una por su cuenta.
    mockApiServer.use(scenarios.siteConfig(amoeEnabledWithoutMode));

    const config = await loadServerUiConfig("es");

    expect(isFeatureEnabled(config.flags, "amoe_enabled")).toBe(true);
    expect(config.amoeMode).toBeNull();
  });

  it("un fallo de configuracion no deja una modalidad colgada", async () => {
    mockApiServer.use(scenarios.serverError("/config"));

    const config = await loadServerUiConfig("en");

    expect(config.amoeMode).toBeNull();
    expect(isFeatureEnabled(config.flags, "amoe_enabled")).toBe(false);
  });
});
