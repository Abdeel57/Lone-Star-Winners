/**
 * Catalogo canonico de permisos y roles administrativos.
 *
 * Esta lista es la contraparte en TypeScript de la semilla de
 * `drizzle/0001_identity_and_rbac.sql`. `test/rbac-parity.test.ts` compara
 * ambas: si divergen, una ruta podria exigir un permiso que no existe en la
 * base de datos, y el registro deny-by-default de DEC-015 se quedaria sin
 * referencia contra la que validar.
 *
 * CONFLICTO ABIERTO CON `packages/security`
 *   `security-integration` ha creado en paralelo `packages/security/src/
 *   capabilities.ts` y `roles.ts`, con otro vocabulario: capacidades tipo
 *   `entry.ledger.read` y roles `PROMOTION_MANAGER`, `EXPORT_OFFICER`,
 *   `SECURITY_ADMIN`, `SYSTEM`. Solo `COMPLIANCE_OFFICER` y `DRAW_OFFICER`
 *   coinciden con los de aqui.
 *
 *   Son DOS FUENTES DE VERDAD para lo mismo, que es lo que prohibe `CLAUDE.md`
 *   seccion 4. No se resuelve unilateralmente: necesita un `DEC-xxx`.
 *   Recomendacion de `backend`: gana el catalogo de `packages/security`, y
 *   este archivo pasa a re-exportarlo mas una migracion de resiembra. Ver
 *   `apps/api/src/http/permission-catalog.ts`, que existe justamente para que
 *   ese cambio sea de un solo import.
 *
 * POR QUE, MIENTRAS TANTO, VIVE AQUI
 *   Porque es donde se persiste y se siembra: la migracion `0001` lo inserta
 *   en `admin_permissions`, y `apps/api` necesita que el permiso que declara
 *   una ruta exista de verdad en la base de datos.
 *
 * POR QUE NO HAY UN `isAdmin`
 *   Con un booleano, "puede ver el panel" y "puede ejecutar el sorteo" serian
 *   el mismo privilegio. Un permiso es una CAPACIDAD concreta, no un nivel.
 */

export interface PermissionDefinition {
  readonly key: string;
  readonly description: string;
  readonly isSensitive: boolean;
  /** DEC-006: exige re-autenticacion con MFA reciente (ventana <= 5 min). */
  readonly requiresStepUp: boolean;
}

export const PERMISSIONS = [
  {
    key: "dashboard.read",
    description: "View operational dashboard aggregates.",
    isSensitive: false,
    requiresStepUp: false,
  },

  {
    key: "promotion.read",
    description: "View promotions and their configuration.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "promotion.write",
    description: "Create and edit draft promotions.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "promotion.schedule",
    description: "Move a promotion from DRAFT to SCHEDULED.",
    isSensitive: true,
    requiresStepUp: false,
  },
  {
    key: "promotion.activate",
    description:
      "Activate a promotion. Blocked while required rules keys are unresolved (DEC-012).",
    isSensitive: true,
    requiresStepUp: true,
  },
  {
    key: "promotion.close",
    description: "Close an active promotion.",
    isSensitive: true,
    requiresStepUp: false,
  },

  {
    key: "rules_version.read",
    description: "View promotion rules versions.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "rules_version.write",
    description: "Create and edit DRAFT rules versions.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "rules_version.activate",
    description: "Activate a rules version, making it legally operative.",
    isSensitive: true,
    requiresStepUp: true,
  },

  {
    key: "product.read",
    description: "View catalog products and variants.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "product.write",
    description: "Create and edit catalog products and variants.",
    isSensitive: false,
    requiresStepUp: false,
  },

  {
    key: "order.read",
    description: "View orders and their entry calculation trace.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "order.refund",
    description: "Issue a refund against an order.",
    isSensitive: true,
    requiresStepUp: false,
  },

  {
    key: "participant.read",
    description: "View participant records without personal data.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "participant.read_pii",
    description: "View participant personal data.",
    isSensitive: true,
    requiresStepUp: false,
  },
  {
    key: "participant.disqualify",
    description: "Disqualify a participant, reversing their eligible entries.",
    isSensitive: true,
    requiresStepUp: true,
  },

  {
    key: "entry.read",
    description: "Read the entry ledger and derived balances.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "entry.adjust_request",
    description: "Request a manual entry adjustment.",
    isSensitive: true,
    requiresStepUp: false,
  },
  {
    key: "entry.adjust_approve",
    description: "Approve a manual entry adjustment and post it to the ledger.",
    isSensitive: true,
    requiresStepUp: true,
  },

  {
    key: "amoe.read",
    description: "View AMOE submissions.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "amoe.review",
    description: "Approve or reject AMOE submissions.",
    isSensitive: true,
    requiresStepUp: false,
  },

  {
    key: "feature_flag.read",
    description: "View feature flag state.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "feature_flag.write",
    description: "Change a feature flag, including legally material ones.",
    isSensitive: true,
    requiresStepUp: true,
  },

  {
    key: "audit.read",
    description: "Read audit events and integrity check results.",
    isSensitive: false,
    requiresStepUp: false,
  },

  {
    key: "export.prepare",
    description: "Prepare an export snapshot of the eligible universe.",
    isSensitive: true,
    requiresStepUp: false,
  },
  {
    key: "export.finalize",
    description: "Finalize an export snapshot. Irreversible (DEC-016).",
    isSensitive: true,
    requiresStepUp: true,
  },
  {
    key: "export.download",
    description: "Download a finalized export snapshot.",
    isSensitive: true,
    requiresStepUp: true,
  },

  {
    key: "draw.authorize",
    description: "Create a DrawAuthorization for a promotion (DEC-017 lock 2).",
    isSensitive: true,
    requiresStepUp: true,
  },
  {
    key: "draw.execute",
    description: "Initiate an internal draw (DEC-017 lock 3).",
    isSensitive: true,
    requiresStepUp: true,
  },

  {
    key: "admin_user.read",
    description: "View administrative accounts.",
    isSensitive: false,
    requiresStepUp: false,
  },
  {
    key: "admin_user.write",
    description: "Create, suspend or deactivate administrative accounts.",
    isSensitive: true,
    requiresStepUp: true,
  },
  {
    key: "admin_role.assign",
    description: "Grant or revoke administrative roles.",
    isSensitive: true,
    requiresStepUp: true,
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map(
  (permission) => permission.key,
);

const PERMISSION_INDEX = new Map<string, PermissionDefinition>(
  PERMISSIONS.map((permission) => [permission.key, permission]),
);

export function isPermissionKey(candidate: string): candidate is PermissionKey {
  return PERMISSION_INDEX.has(candidate);
}

export function getPermission(key: PermissionKey): PermissionDefinition {
  const found = PERMISSION_INDEX.get(key);
  if (found === undefined) {
    throw new Error(`Permiso desconocido: ${key}`);
  }
  return found;
}

/** DEC-006: operaciones que exigen step-up authentication. */
export const STEP_UP_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.filter(
  (permission) => permission.requiresStepUp,
).map((permission) => permission.key);

export const ADMIN_ROLE_KEYS = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "CUSTOMER_SUPPORT",
  "COMPLIANCE_OFFICER",
  "DRAW_OFFICER",
  "READ_ONLY_AUDITOR",
] as const;

export type AdminRoleKey = (typeof ADMIN_ROLE_KEYS)[number];

/**
 * DEC-017 cerrojo 3: pares de roles que una misma persona no puede acumular.
 * Se persiste en `admin_role_conflicts` y lo impone un trigger, porque una
 * regla que solo vive en el codigo de la aplicacion sobrevive hasta el primer
 * script de mantenimiento que asigne roles a mano.
 */
export const ADMIN_ROLE_CONFLICTS: readonly (readonly [AdminRoleKey, AdminRoleKey])[] = [
  ["COMPLIANCE_OFFICER", "DRAW_OFFICER"],
];
