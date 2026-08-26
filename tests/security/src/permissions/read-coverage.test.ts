/**
 * INVARIANTE de `HO-013`: nadie tiene una escritura sin la lectura que la
 * acompana.
 *
 * QUE PASO
 *   `PROMOTION_MANAGER` podia crear, editar, activar y cerrar una promocion, y
 *   no podia leerla. El catalogo tampoco tenia ninguna capacidad de catalogo de
 *   producto, pese a que las notas del rol decian que lo operaba. `backend` lo
 *   descubrio integrando, y tuvo que reapuntar tests a `order.read` por no haber
 *   nada mejor.
 *
 * POR QUE NINGUNA PRUEBA LO VIO
 *   Porque todas miraban en una sola direccion. `authorization-matrix.test.ts`
 *   comprueba con detalle que nadie tenga DE MAS -deny-by-default, separacion de
 *   funciones, capacidades huerfanas- y no habia ni una que comprobara que
 *   alguien tuviera DE MENOS.
 *
 *   La consecuencia de un permiso que falta no es un fallo limpio: es que el
 *   siguiente que se tropiece con el 403 usara "el que haya a mano", y una
 *   matriz de permisos se degrada asi, no de golpe.
 */

import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  CAPABILITY_IDS,
  CAPABILITY_READ_COVERAGE,
  findMissingReadCoverage,
  isReadCapability,
  READ_COVERAGE_EXEMPTIONS,
  ROLE_IDS,
  hasCapability,
  type CapabilityId,
} from "@lsw/security";

describe("cobertura de lectura: coherencia de las propias reglas", () => {
  it("todas las capacidades emparejadas existen", () => {
    const known = new Set<string>(CAPABILITY_IDS);
    for (const rule of CAPABILITY_READ_COVERAGE) {
      expect(known.has(rule.write), `escritura inexistente: ${rule.write}`).toBe(true);
      expect(known.has(rule.read), `lectura inexistente: ${rule.read}`).toBe(true);
    }
  });

  it("el lado marcado como lectura es de verdad una lectura", () => {
    for (const rule of CAPABILITY_READ_COVERAGE) {
      expect(isReadCapability(rule.read), `${rule.read} no parece una lectura`).toBe(true);
    }
  });

  it("el lado marcado como escritura no es una lectura", () => {
    for (const rule of CAPABILITY_READ_COVERAGE) {
      expect(isReadCapability(rule.write), `${rule.write} parece una lectura`).toBe(false);
    }
  });

  it("no hay una escritura emparejada dos veces con lecturas distintas", () => {
    const byWrite = new Map<string, string>();
    for (const rule of CAPABILITY_READ_COVERAGE) {
      const previous = byWrite.get(rule.write);
      expect(previous === undefined || previous === rule.read, rule.write).toBe(true);
      byWrite.set(rule.write, rule.read);
    }
  });

  it("las exenciones apuntan a capacidades reales y estan justificadas", () => {
    const known = new Set<string>(CAPABILITY_IDS);
    for (const [capability, reason] of Object.entries(READ_COVERAGE_EXEMPTIONS)) {
      expect(known.has(capability), `exencion sobre algo inexistente: ${capability}`).toBe(true);
      expect(reason.length, `exencion sin justificar: ${capability}`).toBeGreaterThan(40);
    }
  });
});

describe("toda escritura del catalogo esta clasificada", () => {
  it("no queda ninguna capacidad de escritura sin lectura emparejada ni exencion", () => {
    const covered = new Set<string>(CAPABILITY_READ_COVERAGE.map((rule) => rule.write));
    const exempt = new Set(Object.keys(READ_COVERAGE_EXEMPTIONS));

    const unclassified = Object.values(CAPABILITIES)
      .map((capability) => capability.id)
      .filter((id) => !isReadCapability(id as CapabilityId))
      .filter((id) => !covered.has(id) && !exempt.has(id));

    expect(
      unclassified,
      "Capacidades de escritura sin lectura emparejada:\n" +
        unclassified.join("\n") +
        "\n\nAnadela a CAPABILITY_READ_COVERAGE, o a READ_COVERAGE_EXEMPTIONS con " +
        "su motivo. Lo que no puede es quedarse sin decidir: ese es el agujero de HO-013.",
    ).toStrictEqual([]);
  });
});

describe("HO-013: ningun rol escribe a ciegas", () => {
  it("ningun rol tiene una escritura sin su lectura", () => {
    const offences: string[] = [];
    for (const role of ROLE_IDS) {
      for (const rule of findMissingReadCoverage([role])) {
        offences.push(`${role}: tiene ${rule.write} y NO tiene ${rule.read}`);
      }
    }
    expect(offences, offences.join("\n")).toStrictEqual([]);
  });

  it("PROMOTION_MANAGER puede leer lo que administra", () => {
    // El caso literal del handoff. Se deja escrito con nombre y apellidos para
    // que una regresion se lea como lo que es, y no como un contador que sube.
    const required: readonly CapabilityId[] = [
      "promotion.read",
      "rules.version.read",
      "product.read",
      "product.write",
      "product.publish",
      "dashboard.read",
    ];
    for (const capability of required) {
      expect(hasCapability(["PROMOTION_MANAGER"], capability), capability).toBe(true);
    }
  });

  it("DRAW_OFFICER puede leer el snapshot sobre el que sortea (DEC-017, cerrojo 4)", () => {
    // Sin esto, "el sorteo opera solo sobre un ExportSnapshot FINALIZED" seria
    // una frase que el rol encargado no puede ni comprobar.
    expect(hasCapability(["DRAW_OFFICER"], "export.snapshot.read")).toBe(true);
    expect(hasCapability(["DRAW_OFFICER"], "rules.version.read")).toBe(true);
    // Y sigue sin poder finalizarlo.
    expect(hasCapability(["DRAW_OFFICER"], "export.finalize")).toBe(false);
    expect(hasCapability(["DRAW_OFFICER"], "export.snapshot.create")).toBe(false);
  });

  it("SECURITY_ADMIN ve las sesiones y las cuentas que administra, y nada mas", () => {
    expect(hasCapability(["SECURITY_ADMIN"], "session.read.any")).toBe(true);
    expect(hasCapability(["SECURITY_ADMIN"], "rbac.admin.read")).toBe(true);
    // Las ausencias deliberadas de siempre siguen ahi.
    for (const forbidden of [
      "pii.view.full",
      "export.download",
      "export.finalize",
      "draw.initiate",
      "entry.adjust.create",
      "entry.adjust.approve",
    ] as const) {
      expect(hasCapability(["SECURITY_ADMIN"], forbidden), forbidden).toBe(false);
    }
  });

  it("las lecturas nuevas no convierten a SUPPORT en operador", () => {
    for (const granted of ["dashboard.read", "promotion.read", "product.read"] as const) {
      expect(hasCapability(["SUPPORT"], granted), granted).toBe(true);
    }
    for (const forbidden of [
      "product.write",
      "product.publish",
      "promotion.create",
      "promotion.activate",
      "rules.version.read",
      "export.snapshot.read",
      "rbac.admin.read",
      "session.read.any",
      "tpa.config.read",
      "payment.webhook.read",
    ] as const) {
      expect(hasCapability(["SUPPORT"], forbidden), forbidden).toBe(false);
    }
  });

  it("un participante no recibe ninguna de las lecturas nuevas", () => {
    for (const forbidden of [
      "dashboard.read",
      "promotion.read",
      "product.read",
      "rules.version.read",
      "export.snapshot.read",
      "rbac.admin.read",
      "session.read.any",
      "tpa.config.read",
      "payment.webhook.read",
    ] as const) {
      expect(hasCapability(["PARTICIPANT"], forbidden), forbidden).toBe(false);
    }
  });

  it("combinar roles tampoco deja huecos de lectura", () => {
    expect(findMissingReadCoverage(["SUPPORT", "PROMOTION_MANAGER"])).toStrictEqual([]);
    expect(findMissingReadCoverage([...ROLE_IDS])).toStrictEqual([]);
  });
});

describe("las lecturas nuevas no ensanchan a nadie de mas", () => {
  it("el rol mas amplio sigue sin poder hacer lo que no le toca", () => {
    // Un contador de capacidades no dice nada: lo que importa es QUE capacidades.
    // COMPLIANCE_OFFICER es el rol mas ancho del catalogo, y las lecturas nuevas
    // no le han abierto ninguna de las tres puertas que DEC-016 y DEC-017 le
    // cierran a proposito.
    for (const forbidden of [
      "draw.initiate",
      "export.download",
      "export.deliver",
      "rbac.role.assign",
      "rbac.admin.create",
      "entry.adjust.create",
    ] as const) {
      expect(hasCapability(["COMPLIANCE_OFFICER"], forbidden), forbidden).toBe(false);
    }
  });

  it("ningun rol tiene todas las lecturas nuevas a la vez", () => {
    const nuevas: readonly CapabilityId[] = [
      "dashboard.read",
      "promotion.read",
      "product.read",
      "rules.version.read",
      "export.snapshot.read",
      "rbac.admin.read",
      "session.read.any",
      "tpa.config.read",
      "payment.webhook.read",
    ];
    for (const role of ROLE_IDS) {
      const todas = nuevas.every((capability) => hasCapability([role], capability));
      expect(todas, `${role} concentra las nueve lecturas nuevas`).toBe(false);
    }
  });

  it("las lecturas de configuracion no emiten AuditEvent y las de datos si", () => {
    // Una lectura de configuracion es de alto volumen y no revela nada de nadie:
    // auditarla solo ensena a ignorar la traza. Una lectura que toca PII o
    // evidencia, si.
    expect(CAPABILITIES["dashboard.read"].emitsAuditEvent).toBe(false);
    expect(CAPABILITIES["promotion.read"].emitsAuditEvent).toBe(false);
    expect(CAPABILITIES["product.read"].emitsAuditEvent).toBe(false);

    expect(CAPABILITIES["rules.version.read"].emitsAuditEvent).toBe(true);
    expect(CAPABILITIES["export.snapshot.read"].emitsAuditEvent).toBe(true);
    expect(CAPABILITIES["rbac.admin.read"].emitsAuditEvent).toBe(true);
    expect(CAPABILITIES["session.read.any"].emitsAuditEvent).toBe(true);
    expect(CAPABILITIES["tpa.config.read"].emitsAuditEvent).toBe(true);
    expect(CAPABILITIES["payment.webhook.read"].emitsAuditEvent).toBe(true);
  });

  it("las lecturas que exponen datos personales estan marcadas como tal", () => {
    expect(CAPABILITIES["rbac.admin.read"].touchesPii).toBe(true);
    expect(CAPABILITIES["session.read.any"].touchesPii).toBe(true);
    // Y las de configuracion no lo estan, porque no lo son.
    expect(CAPABILITIES["promotion.read"].touchesPii).toBe(false);
    expect(CAPABILITIES["product.read"].touchesPii).toBe(false);
    expect(CAPABILITIES["dashboard.read"].touchesPii).toBe(false);
  });

  it("tpa.config.read no puede convertirse en una via para leer credenciales", () => {
    // El control real es que el handler no las devuelva. Lo que se fija aqui es
    // que la intencion queda escrita en el catalogo y se lee en la revision.
    expect(CAPABILITIES["tpa.config.read"].notes).toContain("credenciales");
  });
});
