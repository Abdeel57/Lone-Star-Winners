/**
 * Roles de Lone Star Winners.
 *
 * Los roles son DATOS, no ramas de codigo. Ningun `if (user.isAdmin)` debe
 * existir en el repositorio: la pregunta siempre es si el actor tiene una
 * capacidad concreta (ver `permissions.ts`).
 *
 * DEC-006: un unico sistema de identidad para participantes y personal. Un
 * administrador no es otra aplicacion: es el mismo usuario con otro rol, otro
 * scope de cookie y una politica de sesion mas estricta.
 *
 * DEC-022: aqui no hay texto visible para el usuario. Solo claves estables de
 * i18n; el copy en ingles y espanol pertenece a `frontend`.
 */

/** Identificadores de rol. Estables: se persisten y aparecen en auditoria. */
export const ROLE_IDS = [
  "PARTICIPANT",
  "SUPPORT",
  "PROMOTION_MANAGER",
  "COMPLIANCE_OFFICER",
  "DRAW_OFFICER",
  "EXPORT_OFFICER",
  "SECURITY_ADMIN",
  "SYSTEM",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/**
 * `PARTICIPANT` es el publico; `STAFF` opera la promocion; `SYSTEM` es el actor
 * no interactivo (jobs, webhooks) y no se asigna nunca a una persona.
 */
export type RoleKind = "PARTICIPANT" | "STAFF" | "SYSTEM";

export interface RoleDefinition {
  readonly id: RoleId;
  readonly kind: RoleKind;
  /** DEC-006: MFA/TOTP obligatorio para todo rol administrativo. */
  readonly requiresMfa: boolean;
  /**
   * `false` para `SYSTEM`: si una persona pudiera actuar como el sistema, la
   * auditoria dejaria de distinguir un job de un humano, que es justamente la
   * distincion que un tercero necesita poder hacer.
   */
  readonly assignableToHuman: boolean;
  /** Clave i18n del nombre del rol. El copy vive en `messages/*.json`. */
  readonly labelKey: string;
  /** Nota interna para auditoria y revision. No se muestra a nadie. */
  readonly notes: string;
}

export const ROLES: Readonly<Record<RoleId, RoleDefinition>> = Object.freeze({
  PARTICIPANT: {
    id: "PARTICIPANT",
    kind: "PARTICIPANT",
    requiresMfa: false,
    assignableToHuman: true,
    labelKey: "role.participant",
    notes: "Solo sus propios datos. Nunca ve el ledger ni el PII de otro participante.",
  },
  SUPPORT: {
    id: "SUPPORT",
    kind: "STAFF",
    requiresMfa: true,
    assignableToHuman: true,
    labelKey: "role.support",
    notes:
      "Atencion al participante. Lectura con PII enmascarado. No ajusta entries, no descalifica, no finaliza exports, no sortea.",
  },
  PROMOTION_MANAGER: {
    id: "PROMOTION_MANAGER",
    kind: "STAFF",
    requiresMfa: true,
    assignableToHuman: true,
    labelKey: "role.promotion_manager",
    notes:
      "Opera promociones, catalogo y versiones de reglas. Puede PROPONER un ajuste manual, nunca aprobarlo.",
  },
  COMPLIANCE_OFFICER: {
    id: "COMPLIANCE_OFFICER",
    kind: "STAFF",
    requiresMfa: true,
    assignableToHuman: true,
    labelKey: "role.compliance_officer",
    notes:
      "Auditoria, reconciliacion, aprobacion de ajustes, finalizacion de snapshots y autorizacion de sorteo. DEC-017: NO puede iniciar el sorteo que autoriza.",
  },
  DRAW_OFFICER: {
    id: "DRAW_OFFICER",
    kind: "STAFF",
    requiresMfa: true,
    assignableToHuman: true,
    labelKey: "role.draw_officer",
    notes:
      "Unico rol que puede iniciar un sorteo interno, y solo con los cinco cerrojos de DEC-017. NO puede finalizar el snapshot sobre el que sortea.",
  },
  EXPORT_OFFICER: {
    id: "EXPORT_OFFICER",
    kind: "STAFF",
    requiresMfa: true,
    assignableToHuman: true,
    labelKey: "role.export_officer",
    notes:
      "Descarga y entrega al third-party administrator. NO finaliza el snapshot: quien lo declara correcto y quien se lo lleva son personas distintas.",
  },
  SECURITY_ADMIN: {
    id: "SECURITY_ADMIN",
    kind: "STAFF",
    requiresMfa: true,
    assignableToHuman: true,
    labelKey: "role.security_admin",
    notes:
      "Administra cuentas, roles y sesiones, y lee la auditoria. Deliberadamente SIN capacidades operativas: no ve PII completo, no exporta, no sortea, no ajusta entries.",
  },
  SYSTEM: {
    id: "SYSTEM",
    kind: "SYSTEM",
    requiresMfa: false,
    assignableToHuman: false,
    labelKey: "role.system",
    notes:
      "Jobs, webhooks y verificadores de integridad. Sus acciones se auditan con actor_type=SYSTEM.",
  },
});

/**
 * Acceso al catalogo por identificador tipado.
 *
 * Existe por la misma razon que `getCapability`: los consumidores
 * (`packages/database`, `apps/api`) necesitan resolver un rol a su definicion
 * sin escribir `ROLES[algo]` en su propio codigo. Un acceso indexado con una
 * clave que viene de fuera es la forma habitual de acabar leyendo
 * `ROLES["constructor"]`; concentrarlo aqui deja un unico sitio que auditar.
 */
export function getRole(id: RoleId): RoleDefinition {
  return ROLES[id];
}

export function isRoleId(value: string): value is RoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}

/** Roles de personal: los que exigen MFA y politica de sesion estricta. */
export const STAFF_ROLE_IDS: readonly RoleId[] = ROLE_IDS.filter(
  (id) => ROLES[id].kind === "STAFF",
);
