/**
 * `requireStaff`: la sesion administrativa que necesita un handler de admin.
 *
 * Vive aparte de los modulos de rutas porque lo usan cinco de ellos y porque
 * hace DOS cosas que conviene no repetir mal: consumir la resolucion de sesion
 * -que es de `session-authorizer.ts`, no de aqui- y traducirla al `Principal`
 * que entienden los servicios de dominio.
 *
 * POR QUE SE VUELVE A COMPROBAR LO QUE EL AUTORIZADOR YA COMPROBO
 *
 *   No es redundancia inutil. El autorizador protege la RUTA; esto construye el
 *   actor que va a acabar en `actor_admin_user_id` de una fila del ledger, y esa
 *   columna tiene una clave ajena. Ademas, el dia que alguien cambie la
 *   declaracion de una ruta, el handler seguira sin poder escribir sin saber que
 *   cuenta administrativa lo pide.
 */

import type { RoleId } from "@lsw/security";
import type { Principal } from "@lsw/sweepstakes";
import type { FastifyRequest } from "fastify";

import type { AppDependencies } from "../app.js";
import { createStaffLookup, staffPrincipal } from "../services/staff-principal.js";
import { ApiErrors } from "./errors.js";
import { resolveSession } from "./session-authorizer.js";

/**
 * Personal autenticado MAS lo que la sesion sabe y el `Principal` no lleva.
 *
 * `Principal` es lo que entienden los servicios de dominio de entries: actor,
 * ambito y capacidades. No lleva los ROLES ni la antiguedad del ultimo MFA, y no
 * debe llevarlos: son datos de la sesion, no del actor.
 *
 * Pero el sorteo si los necesita. `initiateDraw` de `@lsw/tpa` consulta a
 * `@lsw/security` con los roles efectivos y los segundos desde el ultimo MFA
 * -es el cerrojo 3 de DEC-017- y ni uno ni otro se pueden deducir del
 * `Principal`. Resolverlos por separado significaria consultar la sesion DOS
 * veces por peticion, y con dos consultas separadas por un `await` la segunda
 * puede ver una sesion que la primera no vio.
 */
export interface StaffContext {
  readonly principal: Principal;
  readonly roles: readonly RoleId[];
  /** Segundos desde el ultimo MFA verificado; `null` si no hay ninguno. */
  readonly secondsSinceLastMfa: number | null;
  /** Identificador de la cuenta administrativa. Es lo que referencia el ledger. */
  readonly adminUserId: string;
}

export async function requireStaff(
  dependencies: AppDependencies,
  request: FastifyRequest,
): Promise<Principal> {
  return (await requireStaffContext(dependencies, request)).principal;
}

export async function requireStaffContext(
  dependencies: AppDependencies,
  request: FastifyRequest,
): Promise<StaffContext> {
  const session = await resolveSession(request, {
    identity: dependencies.identity,
    config: dependencies.config,
  });

  if (session === null) {
    throw ApiErrors.unauthenticated();
  }

  // La audiencia de la cookie tiene que ser la de personal. Un participante con
  // una capacidad pegada a mano seguiria siendo un participante, y las
  // operaciones de administracion exigen las DOS cosas (ver `PrincipalScope`).
  if (session.scope !== "STAFF") {
    throw ApiErrors.forbidden("STAFF_SESSION_REQUIRED");
  }

  const account = await createStaffLookup(dependencies.database.db).findActiveAdminUser(
    session.identityId,
  );

  // Estado y roles se revocan en momentos distintos: desactivar la cuenta de
  // quien se va no borra sus asignaciones. Sin esta consulta, una cuenta
  // DEACTIVATED que conserve sus roles seguiria operando.
  if (account === null) {
    throw ApiErrors.forbidden("STAFF_SESSION_REQUIRED");
  }

  return {
    principal: staffPrincipal(account, session.roles),
    roles: session.roles,
    secondsSinceLastMfa: session.secondsSinceLastMfa,
    adminUserId: account.adminUserId,
  };
}
