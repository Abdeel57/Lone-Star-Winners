/**
 * DEC-032: catalogo canonico de feature flags, y su relacion con el catalogo de
 * capacidades.
 *
 * EL AGUJERO QUE CIERRA
 *   Hasta DEC-032, `CapabilityDefinition` tenia `dependsOnFeatureFlag: boolean`
 *   con una nota que decia que el nombre del flag estaba pendiente de `HO-003`.
 *   Un booleano no le dice a nadie QUE flag consultar. La unica forma de que
 *   `apps/api` hubiera podido evaluarlo era escribir el identificador a mano en
 *   cada handler: exactamente el hardcoding que prohibe el principio #14, y
 *   ademas repartido en tantos sitios como rutas.
 */

import { describe, expect, it } from "vitest";

import {
  authorize,
  CAPABILITIES,
  FEATURE_FLAGS,
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  getCapability,
  isFeatureFlagKey,
  LEGALLY_MATERIAL_FLAG_KEYS,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type CapabilityId,
  type FeatureFlagKey,
} from "@lsw/security";

describe("coherencia del catalogo de flags", () => {
  it("la clave de cada flag coincide con su identificador", () => {
    for (const [key, definition] of Object.entries(FEATURE_FLAGS)) {
      expect(definition.key, key).toBe(key);
    }
  });

  it("DEC-032 declara exactamente doce flags", () => {
    expect(FEATURE_FLAG_KEYS.length).toBe(12);
    expect(new Set(FEATURE_FLAG_KEYS).size).toBe(12);
  });

  it("todos en snake_case minuscula", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(/^[a-z][a-z0-9_]*$/u.test(key), key).toBe(true);
    }
  });

  it("todo flag lleva una nota que explica que gobierna", () => {
    for (const definition of Object.values(FEATURE_FLAGS)) {
      expect(definition.notes.length, definition.key).toBeGreaterThan(30);
    }
  });
});

describe("DEC-032: los defaults son la respuesta a `nadie ha decidido todavia`", () => {
  it("el unico flag que arranca encendido es la segunda aprobacion", () => {
    const encendidos = Object.values(FEATURE_FLAGS)
      .filter((definition) => definition.defaultValue)
      .map((definition) => definition.key);
    expect(encendidos).toStrictEqual(["dual_approval_for_sensitive_actions_enabled"]);
  });

  it("el sorteo interno arranca apagado (DEC-017, cerrojo 1)", () => {
    expect(FEATURE_FLAG_DEFAULTS.internal_draw_enabled).toBe(false);
  });

  it("AMOE, publicacion de ganador y numeros visibles arrancan apagados", () => {
    expect(FEATURE_FLAG_DEFAULTS.amoe_enabled).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS.winner_publication_enabled).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS.visible_entry_numbers_enabled).toBe(false);
  });

  it("la caducidad de entries de DEC-033 arranca apagada", () => {
    // Con el flag apagado, `expires_at` es siempre NULL y el saldo vuelve a ser
    // una suma pura. Es la condicion bajo la que DEC-033 no toca DEC-016.
    expect(FEATURE_FLAG_DEFAULTS.entry_expiration_enabled).toBe(false);
  });

  it("los defaults derivan del catalogo y no de una lista paralela", () => {
    for (const definition of Object.values(FEATURE_FLAGS)) {
      const seeded: boolean | undefined = Object.entries(FEATURE_FLAG_DEFAULTS).find(
        ([key]) => key === definition.key,
      )?.[1];
      expect(seeded, definition.key).toBe(definition.defaultValue);
    }
    expect(Object.keys(FEATURE_FLAG_DEFAULTS).sort()).toStrictEqual([...FEATURE_FLAG_KEYS].sort());
  });
});

describe("flags legalmente materiales", () => {
  it("la lista se deriva del catalogo", () => {
    const esperados = Object.values(FEATURE_FLAGS)
      .filter((definition) => definition.legallyMaterial)
      .map((definition) => definition.key);
    expect([...LEGALLY_MATERIAL_FLAG_KEYS]).toStrictEqual([...esperados]);
  });

  it("todo flag legalmente material declara de que decision legal depende", () => {
    const material = new Set<string>(LEGALLY_MATERIAL_FLAG_KEYS);
    for (const definition of Object.values(FEATURE_FLAGS)) {
      if (material.has(definition.key)) {
        expect(definition.legalDependency, definition.key).not.toBeNull();
      }
    }
  });

  it("los cuatro que nombra `flag.update.legally_material` estan marcados", () => {
    const nombrados: readonly FeatureFlagKey[] = [
      "amoe_enabled",
      "visible_entry_numbers_enabled",
      "winner_publication_enabled",
      "internal_draw_enabled",
    ];
    const nombradas = new Set<string>(nombrados);
    for (const definition of Object.values(FEATURE_FLAGS)) {
      if (nombradas.has(definition.key)) {
        expect(definition.legallyMaterial, definition.key).toBe(true);
      }
    }
    expect(nombrados.every((key) => isFeatureFlagKey(key))).toBe(true);
  });
});

describe("la segunda aprobacion no se puede apagar por la puerta de atras", () => {
  it("`authorize()` no consulta el flag de segunda aprobacion", () => {
    // El flag arranca en `true` y solo puede ANADIR la exigencia. Si `authorize`
    // lo consultara, apagarlo relajaria `requiresSecondApproval` en las
    // capacidades CRITICAL, y un control que se apaga con un booleano no es un
    // control. La comprobacion es directa: con la segunda aprobacion ausente, se
    // deniega, se ponga el flag como se ponga.
    const decision = authorize({
      roles: ["SECURITY_ADMIN"],
      capability: "rbac.role.assign",
      secondsSinceLastMfa: 1,
      stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS_LIMIT,
      reasonProvided: true,
      secondApprovalGranted: false,
      featureFlagEnabled: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("SECOND_APPROVAL_REQUIRED");
  });

  it("el flag esta documentado como no relajante", () => {
    expect(FEATURE_FLAGS.dual_approval_for_sensitive_actions_enabled.notes).toContain("NO RELAJA");
  });
});

describe("las capacidades condicionadas por flag ya NOMBRAN su flag", () => {
  it("`dependsOnFeatureFlag` es exactamente `featureFlagKey !== null`", () => {
    for (const capability of Object.values(CAPABILITIES)) {
      expect(capability.dependsOnFeatureFlag, capability.id).toBe(
        capability.featureFlagKey !== null,
      );
    }
  });

  it("todo flag nombrado por una capacidad existe en el catalogo", () => {
    for (const capability of Object.values(CAPABILITIES)) {
      if (capability.featureFlagKey !== null) {
        expect(isFeatureFlagKey(capability.featureFlagKey), capability.id).toBe(true);
      }
    }
  });

  it("cada capacidad condicionada apunta al flag que le corresponde", () => {
    const esperado: readonly (readonly [CapabilityId, FeatureFlagKey])[] = [
      ["amoe.self.submit", "amoe_enabled"],
      ["amoe.review.approve", "amoe_enabled"],
      ["amoe.review.reject", "amoe_enabled"],
      ["entry.adjust.create", "manual_adjustments_enabled"],
      ["draw.authorization.create", "internal_draw_enabled"],
      ["draw.initiate", "internal_draw_enabled"],
      ["winner.publish", "winner_publication_enabled"],
    ];
    for (const [capability, flag] of esperado) {
      expect(getCapability(capability).featureFlagKey, capability).toBe(flag);
    }
  });

  it("no hay ninguna otra capacidad condicionada por flag sin declarar aqui", () => {
    const condicionadas = Object.values(CAPABILITIES)
      .filter((capability) => capability.featureFlagKey !== null)
      .map((capability) => capability.id)
      .sort();

    expect(condicionadas).toStrictEqual([
      "amoe.review.approve",
      "amoe.review.reject",
      "amoe.self.submit",
      "draw.authorization.create",
      "draw.initiate",
      "entry.adjust.create",
      "winner.publish",
    ]);
  });

  it("un flag no evaluado sigue denegando, aunque ahora se sepa cual es", () => {
    // Saber el nombre del flag no cambia el fallo en cerrado de DEC-013.
    const decision = authorize({
      roles: ["DRAW_OFFICER"],
      capability: "draw.initiate",
      secondsSinceLastMfa: 1,
      stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS_LIMIT,
      reasonProvided: true,
      secondApprovalGranted: true,
      featureFlagEnabled: null,
    });
    expect(decision.allowed ? null : decision.reason).toBe("FEATURE_FLAG_NOT_EVALUATED");
  });
});
