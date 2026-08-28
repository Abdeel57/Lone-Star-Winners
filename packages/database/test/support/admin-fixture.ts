/**
 * Cuenta administrativa de PRUEBA. Vive en test/ y NO en src/testing a proposito:
 * tsconfig.build.json compila src/**, files publica dist/, y una fabrica de
 * administradores ACTIVE no debe viajar dentro del artefacto del que depende la
 * API en produccion aunque el mapa de exports la deje inalcanzable.
 *
 * Cuenta administrativa de PRUEBA, en una sola forma para todos los tests de
 * integracion. Antes habia dos ad hoc (`createAdmin`, `createAdminUser`) y
 * tres copias mas en `beforeAll`, y cada una fallaba a su manera contra los
 * CHECK reales de `admin_users` (migracion 0001, lineas 174-181):
 *
 *   admin_users_full_name_length          length(full_name) entre 1 y 160
 *   admin_users_active_requires_mfa       status <> 'ACTIVE' OR mfa_enrolled_at IS NOT NULL
 *   admin_users_deactivated_consistency   (status = 'DEACTIVATED') = (deactivated_at IS NOT NULL)
 *
 * LO QUE ESTE HELPER GARANTIZA Y LO QUE NO
 *   Un admin ACTIVE sale con `mfa_enrolled_at = now()`, que es lo que el CHECK
 *   exige. El CHECK mira SOLO esa columna: no exige una fila en
 *   `identity_mfa_factors`. Por tanto este fixture vale para pruebas de ESQUEMA
 *   (GRANTs, triggers, transiciones) y NO para nada que ejerza el login:
 *   `resolveSession` y `/auth/mfa/verify` buscan un factor ACTIVE de verdad, y
 *   un admin con la columna rellena y sin factor pasa el CHECK y luego no puede
 *   autenticarse. Si una prueba necesita autenticar, que inserte ademas el
 *   factor (`identity_mfa_factors` con status 'ACTIVE', `secret_ciphertext` y
 *   `confirmed_at`); no lo hace este helper a proposito, para que nadie lo
 *   reutilice a ciegas creyendo que produce una cuenta operativa.
 *
 * ROLES
 *   Los ocho `role_key` vivos tras la migracion 0004 (espejo de
 *   `packages/security/src/roles.ts`): PARTICIPANT, SUPPORT, PROMOTION_MANAGER,
 *   COMPLIANCE_OFFICER, DRAW_OFFICER, EXPORT_OFFICER, SECURITY_ADMIN, SYSTEM.
 *   `READ_ONLY_AUDITOR` y `CUSTOMER_SUPPORT` existieron en 0001 y 0004 los
 *   borro. La separacion de funciones (DEC-007, DEC-016, DEC-017) la impone un
 *   trigger: pedir aqui dos roles incompatibles falla como debe.
 */

import { sql } from "drizzle-orm";

import type { Database } from "../../src/client.js";

export const LIVE_ADMIN_ROLE_KEYS = [
  "PARTICIPANT",
  "SUPPORT",
  "PROMOTION_MANAGER",
  "COMPLIANCE_OFFICER",
  "DRAW_OFFICER",
  "EXPORT_OFFICER",
  "SECURITY_ADMIN",
  "SYSTEM",
] as const;

export type LiveAdminRoleKey = (typeof LIVE_ADMIN_ROLE_KEYS)[number];

export interface CreateTestAdminOptions {
  /** Etiqueta unica dentro del test; forma el correo `<label>@example.invalid` y el nombre. */
  readonly label: string;
  /**
   * Estado de la cuenta. `ACTIVE` (por defecto) rellena `mfa_enrolled_at`;
   * `INVITED` no; `DEACTIVATED` rellena `deactivated_at` (y `mfa_enrolled_at`,
   * porque una cuenta desactivada fue activa antes), que es lo que exige el
   * si-y-solo-si de `admin_users_deactivated_consistency`.
   */
  readonly status?: "ACTIVE" | "INVITED" | "DEACTIVATED";
  /** Roles a asignar en `admin_user_roles`, en orden. */
  readonly roles?: readonly LiveAdminRoleKey[];
  /** Nombre completo; por defecto la etiqueta. Debe medir entre 1 y 160. */
  readonly fullName?: string;
}

export interface TestAdmin {
  readonly identityId: string;
  readonly adminUserId: string;
}

async function firstId(db: Database, query: ReturnType<typeof sql>): Promise<string> {
  const result = await db.execute<{ id: string }>(query);
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("La consulta del fixture no devolvio ningun id.");
  }
  return id;
}

/**
 * Crea identidad + cuenta administrativa (+ roles) con la conexion que se le
 * pasa. Con el rol `app` funciona: 0001 concede SELECT, INSERT, UPDATE sobre
 * `admin_users` y `admin_user_roles` a `lsw_app`.
 */
export async function createTestAdmin(
  db: Database,
  options: CreateTestAdminOptions,
): Promise<TestAdmin> {
  const status = options.status ?? "ACTIVE";
  const fullName = options.fullName ?? options.label;
  const email = `${options.label}@example.invalid`;

  const identityId = await firstId(
    db,
    sql`INSERT INTO identities (email, status) VALUES (${email}, 'ACTIVE') RETURNING id`,
  );

  const adminUserId =
    status === "DEACTIVATED"
      ? await firstId(
          db,
          sql`INSERT INTO admin_users (identity_id, full_name, status, mfa_enrolled_at, deactivated_at)
              VALUES (${identityId}, ${fullName}, DEACTIVATED, now(), now()) RETURNING id`,
        )
      : status === "ACTIVE"
        ? await firstId(
            db,
            sql`INSERT INTO admin_users (identity_id, full_name, status, mfa_enrolled_at)
              VALUES (${identityId}, ${fullName}, 'ACTIVE', now()) RETURNING id`,
          )
        : await firstId(
            db,
            sql`INSERT INTO admin_users (identity_id, full_name, status)
              VALUES (${identityId}, ${fullName}, 'INVITED') RETURNING id`,
          );

  for (const roleKey of options.roles ?? []) {
    await db.execute(
      sql`INSERT INTO admin_user_roles (admin_user_id, role_key) VALUES (${adminUserId}, ${roleKey})`,
    );
  }

  return { identityId, adminUserId };
}
