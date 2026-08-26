/**
 * Matriz de autorizacion rol x capacidad, y decision de autorizacion.
 *
 * Reglas de lectura:
 *   - Deny-by-default. Lo que no aparece en la lista de un rol, ese rol no lo
 *     puede hacer. No hay comodines, no hay rol "administrador que puede todo".
 *   - Las ausencias son tan deliberadas como las presencias. Que
 *     `SECURITY_ADMIN` no tenga `pii.view.full` ni `export.download` no es un
 *     olvido: administrar cuentas y operar la promocion son trabajos distintos.
 *   - DEC-017: `COMPLIANCE_OFFICER` finaliza el snapshot y autoriza el sorteo;
 *     `DRAW_OFFICER` lo inicia. Nunca la misma persona.
 *
 * Este modulo NO decide si una promocion admite una operacion. Eso lo dicen las
 * Official Rules a traves de `PromotionRulesVersion` (DEC-012) y los feature
 * flags persistidos (DEC-013). Aqui solo se responde a "este actor, esta
 * capacidad".
 */

import { CAPABILITIES, type CapabilityId } from "./capabilities.js";
import { ROLE_IDS, type RoleId } from "./roles.js";

export const ROLE_CAPABILITIES: Readonly<Record<RoleId, readonly CapabilityId[]>> = Object.freeze({
  PARTICIPANT: [
    "session.self.read",
    "session.self.revoke",
    "participant.self.read",
    "participant.self.update",
    "entry.self.read",
    "order.self.read",
    "amoe.self.submit",
  ],

  // Atencion al participante. Ve para poder ayudar; no toca nada que cambie
  // el universo de entries.
  SUPPORT: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "promotion.read",
    "product.read",
    "participant.list",
    "participant.read",
    "pii.view.masked",
    "order.read",
    "entry.ledger.read",
    "amoe.review.read",
  ],

  // Opera la promocion. Puede proponer un ajuste manual; no puede aprobarlo.
  PROMOTION_MANAGER: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "participant.list",
    "participant.read",
    "pii.view.masked",
    "order.read",
    "order.refund.initiate",
    "entry.ledger.read",
    "entry.adjust.create",
    "amoe.review.read",
    "amoe.review.approve",
    "amoe.review.reject",
    "product.read",
    "product.write",
    "product.publish",
    "promotion.read",
    "promotion.create",
    "promotion.update",
    "promotion.activate",
    "promotion.close",
    "rules.version.read",
    "rules.version.create",
    "flag.read",
    "reconciliation.read",
  ],

  // Compliance. Aprueba, reconcilia, finaliza y autoriza. No sortea.
  COMPLIANCE_OFFICER: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "promotion.read",
    "product.read",
    "participant.list",
    "participant.read",
    "pii.view.masked",
    "pii.view.full",
    "order.read",
    "payment.webhook.read",
    "entry.ledger.read",
    "entry.adjust.approve",
    "participant.disqualify",
    "amoe.review.read",
    "amoe.review.approve",
    "amoe.review.reject",
    "rules.version.read",
    "rules.version.create",
    "rules.version.activate",
    "flag.read",
    "flag.update.legally_material",
    "reconciliation.read",
    "audit.read",
    "audit.integrity.verify",
    // Lectura, no administracion: COMPLIANCE_OFFICER no crea cuentas ni asigna
    // roles. Necesita ver quien tenia que rol para poder EVIDENCIAR ante un
    // tercero que la separacion de funciones se respeto.
    "rbac.admin.read",
    "tpa.config.read",
    "export.snapshot.read",
    "export.snapshot.create",
    "export.snapshot.validate",
    "export.finalize",
    "draw.authorization.create",
    "draw.result.read",
    "winner.workflow.read",
    "winner.status.update",
    "winner.publish",
  ],

  // Unico rol que puede iniciar un sorteo, y solo con los cinco cerrojos de
  // DEC-017. No finaliza el snapshot sobre el que sortea, ni lo genera.
  DRAW_OFFICER: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "flag.read",
    // Sin estas tres, DEC-017 seria inaplicable en la practica: no se puede
    // comprobar que un snapshot esta FINALIZED, ni bajo que version de reglas
    // se corto, sobre un objeto que no se puede leer.
    "promotion.read",
    "rules.version.read",
    "export.snapshot.read",
    "draw.initiate",
    "draw.result.read",
    "winner.workflow.read",
  ],

  // Entrega al third-party administrator. No decide que se exporta ni declara
  // que el contenido es correcto: se lo lleva.
  EXPORT_OFFICER: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "flag.read",
    "promotion.read",
    "rules.version.read",
    "reconciliation.read",
    "export.snapshot.read",
    "export.snapshot.validate",
    "export.download",
    "export.deliver",
    "tpa.config.read",
    "tpa.config.update",
  ],

  // Administra la identidad, no la promocion. Deliberadamente sin PII completo,
  // sin export, sin sorteo y sin ajustes de entries.
  SECURITY_ADMIN: [
    "session.self.read",
    "session.self.revoke",
    "dashboard.read",
    "session.read.any",
    "session.revoke.any",
    "rbac.admin.read",
    "rbac.admin.create",
    "rbac.role.assign",
    "flag.read",
    "flag.update",
    "audit.read",
    "audit.integrity.verify",
  ],

  // Actor no interactivo: jobs, webhooks verificados y verificadores de
  // integridad. Nunca se asigna a una persona (ver `roles.ts`).
  SYSTEM: [
    "system.job.run",
    "audit.integrity.verify",
    // Un job que asienta una reversal tiene que poder leer el ledger sobre el
    // que la asienta, y el reproceso de un webhook empieza por leerlo. No es
    // ensanchar el actor: es dejar de pedirle que escriba a ciegas.
    "entry.ledger.read",
    "entry.reversal.create",
    "payment.webhook.read",
    "payment.webhook.replay",
  ],
});

/**
 * Separacion de funciones.
 *
 * Un mismo actor no puede acumular las dos capacidades de una pareja, ni
 * siquiera combinando varios roles. Se comprueba al asignar roles y otra vez al
 * autorizar: si solo se comprobara al asignar, bastaria un rol anadido a mano
 * en base de datos para anular el control.
 */
export interface SeparationOfDutiesConstraint {
  readonly id: string;
  readonly capabilities: readonly [CapabilityId, CapabilityId];
  readonly source: string;
  readonly rationale: string;
}

export const SEPARATION_OF_DUTIES: readonly SeparationOfDutiesConstraint[] = Object.freeze([
  {
    id: "finalize-vs-draw",
    capabilities: ["export.finalize", "draw.initiate"],
    source: "DEC-017",
    rationale:
      "Quien declara inmutable el universo de entries no puede ser quien sortea sobre el. Si lo fuera, la eleccion del corte y la eleccion del ganador tendrian el mismo autor.",
  },
  {
    id: "propose-vs-approve-adjustment",
    capabilities: ["entry.adjust.create", "entry.adjust.approve"],
    source: "DEC-007",
    rationale:
      "Un ajuste manual que se aprueba a si mismo es una edicion del ledger con otro nombre.",
  },
  {
    id: "finalize-vs-deliver",
    capabilities: ["export.finalize", "export.deliver"],
    source: "DEC-016",
    rationale:
      "Quien declara correcto el contenido y quien se lo lleva al administrador externo deben ser personas distintas.",
  },
]);

/**
 * Cobertura de lectura: toda escritura tiene una lectura que la acompana.
 *
 * POR QUE ESTO EXISTE
 *   `HO-013`. El catalogo concedia a `PROMOTION_MANAGER` crear, editar, activar
 *   y cerrar una promocion, y NO concedia leerla. El agujero no lo detecto
 *   ninguna prueba porque todas las que habia miraban lo contrario -que nadie
 *   tuviera de mas- y ninguna miraba que nadie tuviera de menos. Deny-by-default
 *   tiene ese punto ciego: los permisos que faltan no fallan hasta que alguien
 *   intenta usarlos, y para entonces el atajo evidente es conceder algo mas
 *   ancho de lo necesario, que es como se degrada una matriz de permisos.
 *
 *   Concretamente, `backend` acabo reapuntando tests a `order.read` porque no
 *   habia nada mejor. Ese es exactamente el mecanismo del que hablo.
 *
 * QUE IMPONE
 *   Dos cosas, ambas comprobadas en `tests/security`:
 *     1. Toda capacidad de escritura esta emparejada con una de lectura, o
 *        figura en la lista cerrada de excepciones. Una capacidad de escritura
 *        nueva obliga a decidirlo a proposito.
 *     2. Ningun rol tiene la escritura sin tener su lectura.
 *
 * QUE NO IMPONE
 *   Lo contrario. Tener la lectura sin la escritura es lo normal y deseable:
 *   `SUPPORT` lee promociones y no las toca.
 */
export interface ReadCoverageRule {
  readonly write: CapabilityId;
  readonly read: CapabilityId;
}

export const CAPABILITY_READ_COVERAGE: readonly ReadCoverageRule[] = Object.freeze([
  { write: "session.self.revoke", read: "session.self.read" },
  { write: "session.revoke.any", read: "session.read.any" },
  { write: "participant.self.update", read: "participant.self.read" },
  { write: "amoe.self.submit", read: "entry.self.read" },
  { write: "pii.export", read: "pii.view.full" },
  { write: "order.refund.initiate", read: "order.read" },
  { write: "payment.webhook.replay", read: "payment.webhook.read" },
  { write: "entry.adjust.create", read: "entry.ledger.read" },
  { write: "entry.adjust.approve", read: "entry.ledger.read" },
  { write: "entry.reversal.create", read: "entry.ledger.read" },
  { write: "participant.disqualify", read: "participant.read" },
  { write: "amoe.review.approve", read: "amoe.review.read" },
  { write: "amoe.review.reject", read: "amoe.review.read" },
  { write: "product.write", read: "product.read" },
  { write: "product.publish", read: "product.read" },
  { write: "promotion.create", read: "promotion.read" },
  { write: "promotion.update", read: "promotion.read" },
  { write: "promotion.activate", read: "promotion.read" },
  { write: "promotion.close", read: "promotion.read" },
  { write: "rules.version.create", read: "rules.version.read" },
  { write: "rules.version.activate", read: "rules.version.read" },
  { write: "flag.update", read: "flag.read" },
  { write: "flag.update.legally_material", read: "flag.read" },
  { write: "export.snapshot.create", read: "export.snapshot.read" },
  { write: "export.snapshot.validate", read: "export.snapshot.read" },
  { write: "export.finalize", read: "export.snapshot.read" },
  { write: "export.download", read: "export.snapshot.read" },
  { write: "export.deliver", read: "export.snapshot.read" },
  { write: "tpa.config.update", read: "tpa.config.read" },
  // El sorteo se inicia sobre un snapshot: sin poder leerlo no hay forma de
  // comprobar el cerrojo 4 de DEC-017 (entrada inmutable verificada).
  { write: "draw.authorization.create", read: "promotion.read" },
  { write: "draw.initiate", read: "export.snapshot.read" },
  { write: "winner.status.update", read: "winner.workflow.read" },
  { write: "winner.publish", read: "winner.workflow.read" },
  { write: "rbac.admin.create", read: "rbac.admin.read" },
  { write: "rbac.role.assign", read: "rbac.admin.read" },
]);

/**
 * Capacidades de escritura sin lectura emparejada, a proposito.
 *
 * Lista CERRADA. Cada entrada tiene que poder justificarse por escrito, igual
 * que una ruta publica.
 */
export const READ_COVERAGE_EXEMPTIONS: Readonly<Record<string, string>> = Object.freeze({
  "system.job.run":
    "No opera sobre un recurso concreto: dispara trabajos del sistema. Cada trabajo lee con las capacidades que su propia tarea exija.",
});

/** Segmentos que identifican una capacidad de lectura. */
const READ_SEGMENTS: ReadonlySet<string> = new Set(["read", "list", "view", "verify"]);

export function isReadCapability(capability: CapabilityId): boolean {
  return capability.split(".").some((segment) => READ_SEGMENTS.has(segment));
}

/**
 * Lecturas que le faltan a un actor para poder usar las escrituras que tiene.
 *
 * No deniega: el punto ciego de `HO-013` no es un permiso de mas, es un
 * permiso de menos, y denegar por eso solo empeoraria las cosas. Se usa como
 * comprobacion sobre la matriz y al revisar una combinacion de roles.
 */
export function findMissingReadCoverage(roles: readonly RoleId[]): readonly ReadCoverageRule[] {
  const effective = capabilitiesForRoles(roles);
  return CAPABILITY_READ_COVERAGE.filter(
    (rule) => effective.has(rule.write) && !effective.has(rule.read),
  );
}

const ROLE_CAPABILITY_ENTRIES = ROLE_IDS.map(
  (role): readonly [RoleId, ReadonlySet<CapabilityId>] => [
    role,
    new Set<CapabilityId>(ROLE_CAPABILITIES[role]),
  ],
);

const ROLE_CAPABILITY_SETS: Readonly<Record<RoleId, ReadonlySet<CapabilityId>>> = Object.freeze(
  Object.fromEntries(ROLE_CAPABILITY_ENTRIES) as Record<RoleId, ReadonlySet<CapabilityId>>,
);

/** Capacidades efectivas de un actor con uno o varios roles. */
export function capabilitiesForRoles(roles: readonly RoleId[]): ReadonlySet<CapabilityId> {
  const effective = new Set<CapabilityId>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITY_SETS[role]) {
      effective.add(capability);
    }
  }
  return effective;
}

/** Deny-by-default: sin coincidencia explicita, no. */
export function roleHasCapability(role: RoleId, capability: CapabilityId): boolean {
  return ROLE_CAPABILITY_SETS[role].has(capability);
}

export function hasCapability(roles: readonly RoleId[], capability: CapabilityId): boolean {
  return roles.some((role) => roleHasCapability(role, capability));
}

export function findSeparationOfDutiesViolations(
  capabilities: ReadonlySet<CapabilityId>,
): readonly SeparationOfDutiesConstraint[] {
  return SEPARATION_OF_DUTIES.filter(
    (constraint) =>
      capabilities.has(constraint.capabilities[0]) && capabilities.has(constraint.capabilities[1]),
  );
}

/** Comprobacion previa a asignar una combinacion de roles a una persona. */
export function findSeparationOfDutiesViolationsForRoles(
  roles: readonly RoleId[],
): readonly SeparationOfDutiesConstraint[] {
  return findSeparationOfDutiesViolations(capabilitiesForRoles(roles));
}

/**
 * DEC-006: ventana maxima desde el ultimo MFA para operaciones sensibles.
 * Es el limite superior, no una sugerencia: el valor efectivo llega por entorno
 * (`STEP_UP_MAX_AGE_SECONDS`) y nunca puede ser mayor que este.
 */
export const STEP_UP_MAX_AGE_SECONDS_LIMIT = 300;

export type AuthorizationDenyReason =
  | "CAPABILITY_NOT_GRANTED"
  | "SEPARATION_OF_DUTIES"
  | "STEP_UP_REQUIRED"
  | "REASON_REQUIRED"
  | "SECOND_APPROVAL_REQUIRED"
  | "FEATURE_FLAG_NOT_EVALUATED"
  | "FEATURE_FLAG_DISABLED";

/**
 * Todos los campos son obligatorios a proposito. Un contexto con valores por
 * defecto invita a olvidar uno, y el olvido se traduciria en permitir. Aqui el
 * olvido no compila.
 */
export interface AuthorizationContext {
  readonly roles: readonly RoleId[];
  readonly capability: CapabilityId;
  /**
   * Segundos desde el ultimo MFA verificado, o `null` si no hay MFA reciente.
   * Lo mide el servidor; nunca llega del cliente.
   */
  readonly secondsSinceLastMfa: number | null;
  /** Valor efectivo de configuracion; se recorta a `STEP_UP_MAX_AGE_SECONDS_LIMIT`. */
  readonly stepUpMaxAgeSeconds: number;
  readonly reasonProvided: boolean;
  /** Segunda aprobacion viva, otorgada por un actor DISTINTO, dentro de su TTL. */
  readonly secondApprovalGranted: boolean;
  /**
   * Resultado de consultar el feature flag persistido (DEC-013).
   * `null` significa "no se ha consultado": se deniega. Fallar en cerrado ante
   * un flag no evaluado es la diferencia entre un control y una intencion.
   */
  readonly featureFlagEnabled: boolean | null;
}

export type AuthorizationDecision =
  | { readonly allowed: true; readonly capability: CapabilityId }
  | {
      readonly allowed: false;
      readonly capability: CapabilityId;
      readonly reason: AuthorizationDenyReason;
      readonly detail: string;
    };

export function authorize(context: AuthorizationContext): AuthorizationDecision {
  const capability = context.capability;
  const definition = CAPABILITIES[capability];
  const effective = capabilitiesForRoles(context.roles);

  if (!effective.has(capability)) {
    return deny(capability, "CAPABILITY_NOT_GRANTED", "Ningun rol del actor concede la capacidad.");
  }

  const violations = findSeparationOfDutiesViolations(effective);
  const blocking = violations.find(
    (constraint) =>
      constraint.capabilities[0] === capability || constraint.capabilities[1] === capability,
  );
  if (blocking !== undefined) {
    return deny(
      capability,
      "SEPARATION_OF_DUTIES",
      `El actor acumula ${blocking.capabilities[0]} y ${blocking.capabilities[1]} (${blocking.source}).`,
    );
  }

  if (definition.dependsOnFeatureFlag) {
    if (context.featureFlagEnabled === null) {
      return deny(
        capability,
        "FEATURE_FLAG_NOT_EVALUATED",
        "La capacidad depende de un feature flag que no se ha consultado.",
      );
    }
    if (!context.featureFlagEnabled) {
      return deny(capability, "FEATURE_FLAG_DISABLED", "El feature flag esta desactivado.");
    }
  }

  if (definition.requiresStepUp) {
    const maxAge = Math.min(context.stepUpMaxAgeSeconds, STEP_UP_MAX_AGE_SECONDS_LIMIT);
    const age = context.secondsSinceLastMfa;
    if (age === null || age < 0 || age > maxAge) {
      return deny(
        capability,
        "STEP_UP_REQUIRED",
        `Se exige MFA verificado en los ultimos ${String(maxAge)} segundos (DEC-006).`,
      );
    }
  }

  if (definition.requiresReason && !context.reasonProvided) {
    return deny(
      capability,
      "REASON_REQUIRED",
      "La accion exige un motivo, que se guarda auditado.",
    );
  }

  if (definition.requiresSecondApproval && !context.secondApprovalGranted) {
    return deny(
      capability,
      "SECOND_APPROVAL_REQUIRED",
      "La accion exige aprobacion viva de un segundo actor distinto.",
    );
  }

  return { allowed: true, capability };
}

function deny(
  capability: CapabilityId,
  reason: AuthorizationDenyReason,
  detail: string,
): AuthorizationDecision {
  return { allowed: false, capability, reason, detail };
}
