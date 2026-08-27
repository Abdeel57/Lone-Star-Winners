/**
 * Del personal autenticado al `Principal` que entienden los servicios de
 * dominio.
 *
 * ---------------------------------------------------------------------------
 * DOS COSAS DISTINTAS QUE NO SE MEZCLAN
 * ---------------------------------------------------------------------------
 *
 * El AUTORIZADOR ya decidio si la peticion puede pasar. Este modulo construye
 * algo distinto: el `Principal` que los servicios necesitan para escribir en el
 * ledger, porque una fila de ajuste lleva `actor_admin_user_id` y un CHECK
 * exige que ese identificador exista.
 *
 * Que la capacidad se compruebe DOS veces -en el autorizador y otra vez dentro
 * del servicio- no es redundancia inutil. El autorizador protege la ruta; el
 * servicio protege la operacion, y el mismo servicio se invoca desde un job o
 * desde una consola donde no hay ruta que proteger.
 *
 * ---------------------------------------------------------------------------
 * `admin_user_id` NO ES `identity_id`
 * ---------------------------------------------------------------------------
 *
 * `identities` es quien inicia sesion; `admin_users` es la cuenta
 * administrativa. Son entidades distintas y se revocan por separado: desactivar
 * la cuenta de quien se va no borra su identidad. El ledger referencia a la
 * CUENTA, asi que hay que traducir, y si no hay cuenta -o esta desactivada- no
 * hay principal de personal.
 */

import { capabilitiesForRoles, type RoleId } from "@lsw/security";
import type { Principal } from "@lsw/sweepstakes";
import { adminUsers, type Database } from "@lsw/database";
import { and, eq } from "drizzle-orm";

export interface StaffAccount {
  readonly adminUserId: string;
  readonly status: string;
}

export interface StaffLookup {
  /** `null` = esa identidad no tiene cuenta administrativa ACTIVA. */
  findActiveAdminUser(identityId: string): Promise<StaffAccount | null>;
}

export function createStaffLookup(db: Database): StaffLookup {
  return {
    findActiveAdminUser: async (identityId: string): Promise<StaffAccount | null> => {
      const rows = await db
        .select({ id: adminUsers.id, status: adminUsers.status })
        .from(adminUsers)
        .where(
          and(
            eq(adminUsers.identityId, identityId),
            // El estado va en el `WHERE`, no en un `if` posterior: una cuenta
            // DEACTIVATED que conserve sus roles no debe poder operar, y la
            // consulta sencillamente no la alcanza.
            eq(adminUsers.status, "ACTIVE"),
          ),
        )
        .limit(1);

      const row = rows[0];
      return row === undefined ? null : { adminUserId: row.id, status: row.status };
    },
  };
}

/**
 * Construye el principal de dominio.
 *
 * Las capacidades salen de `capabilitiesForRoles` de `@lsw/security`, que es la
 * unica fuente del catalogo (DEC-027). Componer la lista a mano aqui crearia un
 * segundo catalogo, y el dia que discrepara del primero ganaria el que se
 * consultara antes.
 */
export function staffPrincipal(account: StaffAccount, roles: readonly RoleId[]): Principal {
  return {
    actor: { type: "ADMIN", adminUserId: account.adminUserId },
    scope: "STAFF",
    capabilities: [...capabilitiesForRoles(roles)],
  };
}
