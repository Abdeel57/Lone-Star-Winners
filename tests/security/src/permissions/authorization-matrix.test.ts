/**
 * INVARIANTES de la matriz de autorizacion.
 *
 * DEC-015 (deny-by-default), DEC-006 (step-up) y DEC-017 (separacion de
 * funciones). Estos tests son la razon por la que la matriz esta escrita como
 * datos: una matriz de permisos que solo existe repartida en `if` no se puede
 * auditar de una sentada, ni antes de un sorteo ni delante de un tercero.
 */

import { describe, expect, it } from "vitest";

import {
  authorize,
  CAPABILITIES,
  CAPABILITY_IDS,
  capabilitiesForRoles,
  findSeparationOfDutiesViolationsForRoles,
  hasCapability,
  ROLE_CAPABILITIES,
  ROLE_IDS,
  ROLES,
  SEPARATION_OF_DUTIES,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type AuthorizationContext,
  type CapabilityId,
  type RoleId,
} from "@lsw/security";

function contextFor(
  roles: readonly RoleId[],
  capability: CapabilityId,
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    roles,
    capability,
    secondsSinceLastMfa: 10,
    stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS_LIMIT,
    reasonProvided: true,
    secondApprovalGranted: true,
    featureFlagEnabled: true,
    ...overrides,
  };
}

describe("coherencia del catalogo", () => {
  it("la clave de cada capacidad coincide con su identificador", () => {
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITIES[id].id).toBe(id);
    }
  });

  it("toda capacidad concedida a un rol existe en el catalogo", () => {
    const known = new Set<string>(CAPABILITY_IDS);
    for (const role of ROLE_IDS) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(known.has(capability), `${role} concede ${capability}, que no existe`).toBe(true);
      }
    }
  });

  it("toda capacidad no rutinaria se audita", () => {
    const silent = CAPABILITY_IDS.filter(
      (id) => CAPABILITIES[id].sensitivity !== "ROUTINE" && !CAPABILITIES[id].emitsAuditEvent,
    );
    expect(silent, "Hay capacidades sensibles que no dejan rastro").toStrictEqual([]);
  });

  it("toda capacidad critica exige step-up y motivo", () => {
    const weak = CAPABILITY_IDS.filter((id) => CAPABILITIES[id].sensitivity === "CRITICAL").filter(
      (id) => !CAPABILITIES[id].requiresStepUp || !CAPABILITIES[id].requiresReason,
    );
    // Excepciones deliberadas, cada una con motivo. La lista es cerrada:
    // anadir una obliga a tocar este test, que es justo cuando debe discutirse.
    //
    // entry.reversal.create la ejecuta SYSTEM desde un webhook ya verificado;
    //   no hay persona a la que pedir MFA.
    // amoe.review.* es trabajo de cola, de alto volumen y con motivo
    //   obligatorio. Exigir MFA en cada resolucion acabaria en sesiones de
    //   step-up permanentes, que es peor control que el actual.
    expect(weak).toStrictEqual([
      "entry.reversal.create",
      "amoe.review.approve",
      "amoe.review.reject",
    ]);
  });
});

describe("deny-by-default", () => {
  it("ningun rol tiene todas las capacidades", () => {
    for (const role of ROLE_IDS) {
      expect(ROLE_CAPABILITIES[role].length).toBeLessThan(CAPABILITY_IDS.length);
    }
  });

  it("un participante no accede a nada del personal", () => {
    const forbidden: readonly CapabilityId[] = [
      "participant.list",
      "entry.ledger.read",
      "pii.view.full",
      "export.download",
      "export.finalize",
      "draw.initiate",
      "audit.read",
      "rbac.role.assign",
    ];
    for (const capability of forbidden) {
      expect(hasCapability(["PARTICIPANT"], capability), capability).toBe(false);
      expect(authorize(contextFor(["PARTICIPANT"], capability)).allowed).toBe(false);
    }
  });

  it("atencion al participante no finaliza exports, no ajusta entries y no sortea", () => {
    const forbidden: readonly CapabilityId[] = [
      "export.finalize",
      "export.download",
      "entry.adjust.create",
      "entry.adjust.approve",
      "draw.initiate",
      "pii.view.full",
      "participant.disqualify",
    ];
    for (const capability of forbidden) {
      expect(hasCapability(["SUPPORT"], capability), capability).toBe(false);
    }
  });

  it("el rol SYSTEM no se asigna a personas", () => {
    expect(ROLES.SYSTEM.assignableToHuman).toBe(false);
  });

  it("todo rol de personal exige MFA", () => {
    for (const role of ROLE_IDS) {
      if (ROLES[role].kind === "STAFF") {
        expect(ROLES[role].requiresMfa, role).toBe(true);
      }
    }
  });
});

describe("DEC-017: separacion de funciones", () => {
  it("quien finaliza el snapshot no puede iniciar el sorteo", () => {
    expect(hasCapability(["COMPLIANCE_OFFICER"], "export.finalize")).toBe(true);
    expect(hasCapability(["COMPLIANCE_OFFICER"], "draw.initiate")).toBe(false);
    expect(hasCapability(["DRAW_OFFICER"], "draw.initiate")).toBe(true);
    expect(hasCapability(["DRAW_OFFICER"], "export.finalize")).toBe(false);
  });

  it("ningun rol acumula por si solo las dos mitades de una restriccion", () => {
    for (const role of ROLE_IDS) {
      const violations = findSeparationOfDutiesViolationsForRoles([role]);
      expect(violations.map((constraint) => constraint.id), role).toStrictEqual([]);
    }
  });

  it("combinar roles no permite saltarse la separacion de funciones", () => {
    const violations = findSeparationOfDutiesViolationsForRoles([
      "COMPLIANCE_OFFICER",
      "DRAW_OFFICER",
    ]);
    expect(violations.map((constraint) => constraint.id)).toContain("finalize-vs-draw");

    const decision = authorize(contextFor(["COMPLIANCE_OFFICER", "DRAW_OFFICER"], "draw.initiate"));
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("SEPARATION_OF_DUTIES");
  });

  it("cada restriccion apunta a capacidades que existen", () => {
    const known = new Set<string>(CAPABILITY_IDS);
    for (const constraint of SEPARATION_OF_DUTIES) {
      expect(known.has(constraint.capabilities[0]), constraint.id).toBe(true);
      expect(known.has(constraint.capabilities[1]), constraint.id).toBe(true);
      expect(constraint.source.length).toBeGreaterThan(0);
    }
  });
});

describe("DEC-006: step-up y aprobaciones", () => {
  it("sin MFA reciente no se finaliza un export", () => {
    const decision = authorize(
      contextFor(["COMPLIANCE_OFFICER"], "export.finalize", { secondsSinceLastMfa: null }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("STEP_UP_REQUIRED");
  });

  it("un MFA caducado no vale", () => {
    const decision = authorize(
      contextFor(["COMPLIANCE_OFFICER"], "export.finalize", {
        secondsSinceLastMfa: STEP_UP_MAX_AGE_SECONDS_LIMIT + 1,
      }),
    );
    expect(decision.allowed ? null : decision.reason).toBe("STEP_UP_REQUIRED");
  });

  it("configurar una ventana mayor que el tope duro no la amplia", () => {
    const decision = authorize(
      contextFor(["COMPLIANCE_OFFICER"], "export.finalize", {
        stepUpMaxAgeSeconds: 86_400,
        secondsSinceLastMfa: 3_600,
      }),
    );
    expect(decision.allowed ? null : decision.reason).toBe("STEP_UP_REQUIRED");
  });

  it("un cambio sin motivo no se autoriza", () => {
    const decision = authorize(
      contextFor(["COMPLIANCE_OFFICER"], "participant.disqualify", { reasonProvided: false }),
    );
    expect(decision.allowed ? null : decision.reason).toBe("REASON_REQUIRED");
  });

  it("un ajuste manual sin segunda aprobacion no se autoriza", () => {
    const decision = authorize(
      contextFor(["PROMOTION_MANAGER"], "entry.adjust.create", { secondApprovalGranted: false }),
    );
    expect(decision.allowed ? null : decision.reason).toBe("SECOND_APPROVAL_REQUIRED");
  });
});

describe("DEC-013: capacidades condicionadas por feature flag", () => {
  it("si el flag no se ha consultado, se deniega", () => {
    const decision = authorize(
      contextFor(["DRAW_OFFICER"], "draw.initiate", { featureFlagEnabled: null }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("FEATURE_FLAG_NOT_EVALUATED");
  });

  it("con el flag apagado, se deniega", () => {
    const decision = authorize(
      contextFor(["DRAW_OFFICER"], "draw.initiate", { featureFlagEnabled: false }),
    );
    expect(decision.allowed ? null : decision.reason).toBe("FEATURE_FLAG_DISABLED");
  });

  it("las capacidades de AMOE y de sorteo dependen de un flag", () => {
    const flagged: readonly CapabilityId[] = [
      "amoe.self.submit",
      "amoe.review.approve",
      "amoe.review.reject",
      "draw.authorization.create",
      "draw.initiate",
      "winner.publish",
    ];
    for (const capability of flagged) {
      expect(CAPABILITIES[capability].dependsOnFeatureFlag, capability).toBe(true);
    }
  });

  it("capacidadesForRoles acumula sin duplicar", () => {
    const effective = capabilitiesForRoles(["SUPPORT", "SUPPORT"]);
    expect(effective.size).toBe(new Set(ROLE_CAPABILITIES.SUPPORT).size);
  });
});

describe("capacidades sin rol asignado", () => {
  it("la unica capacidad que hoy no tiene ningun rol es pii.export", () => {
    const assigned = new Set<CapabilityId>();
    for (const role of ROLE_IDS) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        assigned.add(capability);
      }
    }
    const orphans = CAPABILITY_IDS.filter((id) => !assigned.has(id));

    // No es un olvido: extraer PII fuera del sistema no es tarea de ningun rol
    // mientras no exista un flujo de solicitud de datos con su procedimiento.
    // Deny-by-default significa exactamente esto: la capacidad existe, esta
    // documentada y nadie la tiene.
    expect(orphans).toStrictEqual(["pii.export"]);
  });
});
