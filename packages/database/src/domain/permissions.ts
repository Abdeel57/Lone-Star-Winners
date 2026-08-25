/**
 * Proyeccion PERSISTIBLE del catalogo de autorizacion.
 *
 * DEC-027: el catalogo canonico de roles y capacidades vive en
 * `packages/security`. Este modulo NO lo define: lo importa y lo traduce a las
 * filas que siembra la migracion `0004_rbac_catalog_unification.sql`.
 *
 * POR QUE ESTE ARCHIVO SIGUE EXISTIENDO
 *
 *   Porque hay dos representaciones inevitables del mismo vocabulario: la de
 *   `@lsw/security`, que es una libreria de decision sin estado, y las filas
 *   de `admin_permissions` / `admin_roles`, que son lo que la base de datos
 *   impone con claves ajenas. Traducir de una a otra en un solo sitio, de
 *   forma derivada, es lo que permite que `test/parity.test.ts` compare el SQL
 *   con el catalogo y falle si divergen.
 *
 *   Ninguna constante de este archivo esta escrita a mano. Todo se DERIVA. Un
 *   permiso nuevo en `packages/security` aparece aqui solo; lo unico que hay
 *   que escribir es la migracion, y el test de paridad avisa si falta.
 *
 * QUE SE CONSERVA DEL DISENO ANTERIOR DE `backend` (DEC-027 lo adopta)
 *
 *   1. Ningun rol acumula "finalizar el export" y "sortear". En el catalogo de
 *      `security` esto es aun mas fuerte que antes: NO EXISTE un rol
 *      `SUPER_ADMIN`. El rol que administra cuentas (`SECURITY_ADMIN`) no
 *      tiene `export.finalize`, ni `draw.authorization.create`, ni
 *      `draw.initiate`. La prueba correspondiente sigue en el test de paridad.
 *   2. La incompatibilidad entre roles se persiste como DATO y la impone un
 *      trigger, no el codigo de la aplicacion.
 *   3. `COMPLIANCE_OFFICER`, no `COMPLIANCE_REVIEWER`.
 *
 * POR QUE NO HAY UN `isAdmin`
 *   Con un booleano, "puede ver el panel" y "puede ejecutar el sorteo" serian
 *   el mismo privilegio. Un permiso es una CAPACIDAD concreta, no un nivel.
 */

import {
  CAPABILITIES,
  CAPABILITY_IDS,
  ROLES,
  ROLE_CAPABILITIES,
  ROLE_IDS,
  SEPARATION_OF_DUTIES,
  isCapabilityId,
  type CapabilityDefinition,
  type CapabilityId,
  type RoleDefinition,
  type RoleId,
} from "@lsw/security";

/**
 * Nombres locales. El vocabulario del dominio es el de `@lsw/security`; estos
 * alias existen para que el resto de `@lsw/database` y de `apps/api` no tenga
 * que cambiar de palabra al hablar de lo mismo.
 */
export type PermissionKey = CapabilityId;
export type PermissionDefinition = CapabilityDefinition;
export type AdminRoleKey = RoleId;
export type AdminRoleDefinition = RoleDefinition;

export { CAPABILITIES, ROLES, ROLE_CAPABILITIES, SEPARATION_OF_DUTIES };

/** Fila de `admin_permissions`, tal y como la siembra la migracion `0004`. */
export interface PermissionSeedRow {
  readonly key: PermissionKey;
  readonly domain: string;
  readonly sensitivity: "ROUTINE" | "SENSITIVE" | "CRITICAL";
  readonly description: string;
  readonly requiresStepUp: boolean;
  readonly requiresReason: boolean;
  readonly requiresSecondApproval: boolean;
  readonly emitsAuditEvent: boolean;
  readonly touchesPii: boolean;
  readonly dependsOnFeatureFlag: boolean;
  readonly legalDependency: string | null;
}

/** Fila de `admin_roles`. */
export interface AdminRoleSeedRow {
  readonly key: AdminRoleKey;
  readonly kind: "PARTICIPANT" | "STAFF" | "SYSTEM";
  readonly requiresMfa: boolean;
  readonly assignableToHuman: boolean;
  readonly labelKey: string;
  readonly description: string;
}

/** Fila de `admin_role_conflicts`. */
export interface AdminRoleConflictRow {
  readonly roleKeyA: AdminRoleKey;
  readonly roleKeyB: AdminRoleKey;
  readonly reason: string;
}

export const PERMISSIONS: readonly PermissionSeedRow[] = CAPABILITY_IDS.map(
  (id): PermissionSeedRow => {
    const capability = CAPABILITIES[id];
    return {
      key: id,
      domain: capability.domain,
      sensitivity: capability.sensitivity,
      description: capability.notes,
      requiresStepUp: capability.requiresStepUp,
      requiresReason: capability.requiresReason,
      requiresSecondApproval: capability.requiresSecondApproval,
      emitsAuditEvent: capability.emitsAuditEvent,
      touchesPii: capability.touchesPii,
      dependsOnFeatureFlag: capability.dependsOnFeatureFlag,
      legalDependency: capability.legalDependency,
    };
  },
);

export const PERMISSION_KEYS: readonly PermissionKey[] = CAPABILITY_IDS;

export function isPermissionKey(candidate: string): candidate is PermissionKey {
  return isCapabilityId(candidate);
}

export function getPermission(key: PermissionKey): PermissionDefinition {
  return CAPABILITIES[key];
}

/** DEC-006: operaciones que exigen step-up authentication. */
export const STEP_UP_PERMISSION_KEYS: readonly PermissionKey[] = CAPABILITY_IDS.filter(
  (id) => CAPABILITIES[id].requiresStepUp,
);

export const ADMIN_ROLE_KEYS: readonly AdminRoleKey[] = ROLE_IDS;

export const ADMIN_ROLES: readonly AdminRoleSeedRow[] = ROLE_IDS.map((id): AdminRoleSeedRow => {
  const role = ROLES[id];
  return {
    key: id,
    kind: role.kind,
    requiresMfa: role.requiresMfa,
    assignableToHuman: role.assignableToHuman,
    labelKey: role.labelKey,
    description: role.notes,
  };
});

/** Pares `(rol, capacidad)` de `admin_role_permissions`, en orden estable. */
export const ADMIN_ROLE_PERMISSIONS: readonly (readonly [AdminRoleKey, PermissionKey])[] =
  ROLE_IDS.flatMap((role) =>
    ROLE_CAPABILITIES[role].map((capability): readonly [AdminRoleKey, PermissionKey] => [
      role,
      capability,
    ]),
  );

/**
 * DEC-017 cerrojo 3: pares de ROLES que una misma persona no puede acumular.
 *
 * `packages/security` declara la separacion de funciones en terminos de
 * CAPACIDADES, que es el nivel correcto para decidir en tiempo de ejecucion.
 * La base de datos, en cambio, solo ve roles al asignarlos. Esta funcion
 * traduce lo uno en lo otro: para cada restriccion, todo par de roles tal que
 * uno concede la primera capacidad y el otro la segunda.
 *
 * La derivacion importa. Escribir los pares a mano significaria que anadir a
 * un rol una capacidad conflictiva no produciria ningun conflicto nuevo, y el
 * control se degradaria en silencio.
 */
function deriveRoleConflicts(): readonly AdminRoleConflictRow[] {
  const byPair = new Map<string, { pair: readonly [RoleId, RoleId]; reasons: string[] }>();

  for (const constraint of SEPARATION_OF_DUTIES) {
    const [capabilityA, capabilityB] = constraint.capabilities;

    const rolesWithA = ROLE_IDS.filter((role) => ROLE_CAPABILITIES[role].includes(capabilityA));
    const rolesWithB = ROLE_IDS.filter((role) => ROLE_CAPABILITIES[role].includes(capabilityB));

    for (const roleA of rolesWithA) {
      for (const roleB of rolesWithB) {
        if (roleA === roleB) {
          // Un solo rol que concede ambas capacidades no es un conflicto ENTRE
          // roles: es un error del propio catalogo, y lo detecta el test de
          // paridad, no esta funcion.
          continue;
        }

        const pair: readonly [RoleId, RoleId] = roleA < roleB ? [roleA, roleB] : [roleB, roleA];
        const key = `${pair[0]}|${pair[1]}`;
        const reason = `${constraint.source}: ${constraint.rationale}`;

        const existing = byPair.get(key);
        if (existing === undefined) {
          byPair.set(key, { pair, reasons: [reason] });
        } else if (!existing.reasons.includes(reason)) {
          existing.reasons.push(reason);
        }
      }
    }
  }

  return [...byPair.values()]
    .map((entry): AdminRoleConflictRow => ({
      roleKeyA: entry.pair[0],
      roleKeyB: entry.pair[1],
      reason: entry.reasons.join(" "),
    }))
    .sort((a, b) =>
      a.roleKeyA === b.roleKeyA
        ? a.roleKeyB.localeCompare(b.roleKeyB)
        : a.roleKeyA.localeCompare(b.roleKeyA),
    );
}

export const ADMIN_ROLE_CONFLICTS: readonly AdminRoleConflictRow[] = deriveRoleConflicts();

/**
 * Roles que pueden asignarse a una cuenta de `admin_users`.
 *
 * `PARTICIPANT` queda fuera porque DEC-028 separa participantes de personal, y
 * `SYSTEM` porque si una persona pudiera actuar como el sistema la auditoria
 * dejaria de distinguir un job de un humano. La base de datos lo impone con
 * una clave ajena compuesta contra `admin_roles (key, staff_assignable)`; esta
 * constante es la misma regla para el lado TypeScript.
 */
export const STAFF_ASSIGNABLE_ROLE_KEYS: readonly AdminRoleKey[] = ROLE_IDS.filter(
  (id) => ROLES[id].kind === "STAFF" && ROLES[id].assignableToHuman,
);

export function isStaffAssignableRole(candidate: string): candidate is AdminRoleKey {
  return (STAFF_ASSIGNABLE_ROLE_KEYS as readonly string[]).includes(candidate);
}
