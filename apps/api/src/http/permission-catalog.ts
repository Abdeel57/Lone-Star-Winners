/**
 * Adaptador de UN SOLO PUNTO hacia el catalogo de permisos.
 *
 * CONFLICTO ABIERTO, LEER ANTES DE TOCAR NADA
 *
 *   Existen hoy DOS catalogos de autorizacion en el repositorio, creados en
 *   paralelo por dos agentes que no se veian:
 *
 *     A) `packages/database/src/domain/permissions.ts` (backend, este hito),
 *        con claves tipo `promotion.read` y roles `SUPER_ADMIN`,
 *        `OPERATIONS_ADMIN`, `CUSTOMER_SUPPORT`, `COMPLIANCE_OFFICER`,
 *        `DRAW_OFFICER`, `READ_ONLY_AUDITOR`. Es el que esta SEMBRADO en la
 *        migracion `0001_identity_and_rbac.sql`.
 *
 *     B) `packages/security/src/capabilities.ts` y `roles.ts` (security),
 *        con claves tipo `entry.ledger.read` y roles `PARTICIPANT`,
 *        `SUPPORT`, `PROMOTION_MANAGER`, `COMPLIANCE_OFFICER`,
 *        `DRAW_OFFICER`, `EXPORT_OFFICER`, `SECURITY_ADMIN`, `SYSTEM`.
 *
 *   Solo `COMPLIANCE_OFFICER` y `DRAW_OFFICER` coinciden. Esto es exactamente
 *   la situacion de "dos fuentes de verdad" que prohibe `CLAUDE.md` seccion 4,
 *   y no se resuelve unilateralmente: necesita un `DEC-xxx`.
 *
 *   Recomendacion de `backend` al Team Lead: **gana el catalogo de
 *   `packages/security`.** La regla 4 de `docs/DECISIONS.md` da a `security` la
 *   revision explicita de la autorizacion, y sus metadatos ya cubren
 *   `requiresSecondApproval`, que el catalogo de backend no modela.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 *
 *   Para que resolver el conflicto sea cambiar UN import y anadir UNA
 *   migracion de resiembra, en vez de tocar el registro de rutas, el generador
 *   de OpenAPI y cada declaracion de ruta. Todo el resto de `apps/api` importa
 *   de aqui y no del catalogo directamente.
 */

export {
  getPermission,
  isPermissionKey,
  PERMISSIONS,
  STEP_UP_PERMISSION_KEYS,
} from "@lsw/database";
export type { PermissionKey, PermissionDefinition } from "@lsw/database";
