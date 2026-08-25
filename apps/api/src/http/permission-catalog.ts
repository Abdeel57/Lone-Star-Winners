/**
 * Adaptador de UN SOLO PUNTO hacia el catalogo de autorizacion.
 *
 * DEC-027 (resuelve `HO-007`): el catalogo canonico de roles y capacidades vive
 * en **`packages/security`**. `packages/database` lo importa para la semilla y
 * mantiene un test de paridad; `apps/api` lo consume a traves de este archivo.
 *
 * POR QUE `apps/api` NO IMPORTA DE `@lsw/security` DIRECTAMENTE
 *
 *   Porque la pregunta que hace la API no es "que capacidades existen" sino
 *   "que capacidades existen Y ESTAN SEMBRADAS". Un permiso que el catalogo
 *   declara pero que la migracion no ha insertado no se le puede conceder a
 *   nadie: una ruta que lo exigiera devolveria 403 para siempre, sin que nada
 *   lo delatara. Al pasar por `@lsw/database`, la unica lista que ve el
 *   registro de rutas es la que el test de paridad compara contra el SQL.
 *
 *   Ese fue tambien el motivo original de este archivo: cuando existian dos
 *   catalogos incompatibles, resolver el conflicto tenia que costar un import,
 *   no una revision de cada declaracion de ruta. Costo exactamente eso.
 *
 * VOCABULARIO
 *   `PermissionKey` es un alias local de `CapabilityId`, y una capacidad se
 *   identifica como `dominio.recurso.accion`. Los metadatos que trae cada una
 *   -step-up, motivo obligatorio, segunda aprobacion, dependencia de feature
 *   flag y dependencia legal- los usa el registro de rutas y el generador de
 *   OpenAPI; no se reimplementan aqui.
 */

export {
  getPermission,
  isPermissionKey,
  PERMISSIONS,
  PERMISSION_KEYS,
  STEP_UP_PERMISSION_KEYS,
} from "@lsw/database";
export type { PermissionKey, PermissionDefinition } from "@lsw/database";
