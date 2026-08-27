/**
 * Alta del primer administrador (DEC-006, DEC-045).
 *
 *   pnpm --filter @lsw/database db:create-admin            # paso 1
 *   pnpm --filter @lsw/database db:create-admin --confirm  # paso 2
 *
 * POR QUE EXISTE ESTE SCRIPT
 *   Arranque en frio de la identidad, el mismo problema que `db:bootstrap`
 *   resolvia para los roles de PostgreSQL: el panel de administracion se
 *   gestiona desde el panel, y para entrar hace falta una cuenta que solo el
 *   panel sabe crear. Alguien tiene que romper el circulo desde fuera.
 *
 * POR QUE SON DOS PASOS Y NO UNO
 *   El paso 1 crea la cuenta con el factor MFA en PENDING y muestra la URI de
 *   aprovisionamiento. El paso 2 exige un codigo valido del autenticador y solo
 *   entonces marca el factor ACTIVE y la cuenta ACTIVE.
 *
 *   Hacerlo en un solo paso crearia una cuenta administrativa activa con un
 *   segundo factor que nadie ha comprobado que funcione. Si el operador copia
 *   mal el secreto, el resultado es una cuenta que no puede entrar y que
 *   tampoco puede arreglarse desde el panel, porque para entrar al panel hace
 *   falta esa cuenta. El paso 2 es lo que garantiza que el autenticador
 *   funciona ANTES de depender de el.
 *
 * QUE NO HACE
 *   No concede roles distintos del que se le pida, no crea participantes y no
 *   toca el ledger. Es un cerrojo de arranque, no una herramienta de
 *   administracion: en cuanto exista el panel, las altas se hacen alli, con
 *   auditoria y con `granted_by_admin_user_id` relleno, que aqui es null a
 *   proposito porque no hay ningun administrador previo que conceda nada.
 */

import {
  hashPassword,
  encryptSecret,
  decryptSecret,
  decodeSecretBoxKey,
  generateTotpSecret,
  totpProvisioningUri,
  verifyTotp,
} from "@lsw/security";
import { eq, and } from "drizzle-orm";

import { createDatabaseHandle } from "../client.js";
import * as schema from "../schema/index.js";

const { identities, adminUsers, adminUserRoles, identityCredentials, identityMfaFactors } = schema;

const ISSUER = "Lone Star Winners";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    console.error(`[admin] Falta ${name}.`);
    process.exit(1);
  }

  return value;
}

async function main(): Promise<void> {
  const confirming = process.argv.includes("--confirm");

  const connectionString = requireEnv("DATABASE_URL_APP");
  const sslMode = requireEnv("DATABASE_SSL_MODE");
  const email = requireEnv("LSW_ADMIN_EMAIL").trim().toLowerCase();
  const encryptionKey = decodeSecretBoxKey(requireEnv("MFA_SECRET_ENCRYPTION_KEY"));

  const handle = createDatabaseHandle({
    role: "app",
    connectionString,
    maxConnections: 1,
    statementTimeoutMs: 30_000,
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode === "verify-full" },
    applicationName: "lsw-create-admin",
  });

  const db = handle.db;

  try {
    if (confirming) {
      const code = requireEnv("LSW_ADMIN_MFA_CODE");

      const found = await db
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.emailNormalized, email))
        .limit(1);

      const identityId = found[0]?.id;

      if (identityId === undefined) {
        console.error(`[admin] No existe ninguna identidad con ${email}. Corre antes el paso 1.`);
        process.exit(1);
      }

      const factors = await db
        .select()
        .from(identityMfaFactors)
        .where(
          and(
            eq(identityMfaFactors.identityId, identityId),
            eq(identityMfaFactors.status, "PENDING"),
          ),
        )
        .limit(1);

      const factor = factors[0];

      if (factor === undefined) {
        console.error("[admin] No hay ningun factor MFA pendiente para esa cuenta.");
        process.exit(1);
      }

      const secret = decryptSecret(factor.secretCiphertext, encryptionKey);
      const now = new Date();

      const result = verifyTotp({
        code,
        secretBase32: secret,
        nowMillis: now.getTime(),
        lastUsedCounter: null,
      });

      if (!result.valid || result.counter === null) {
        console.error(
          "[admin] Codigo invalido. Comprueba que el reloj del telefono este en hora y vuelve a intentarlo.",
        );
        process.exit(1);
      }

      await db
        .update(identityMfaFactors)
        .set({
          status: "ACTIVE",
          confirmedAt: now,
          lastUsedCounter: BigInt(result.counter),
        })
        .where(eq(identityMfaFactors.id, factor.id));

      // Solo AHORA la cuenta pasa a ACTIVE. El CHECK de `admin_users` exige
      // `mfa_enrolled_at` para ese estado, asi que el orden no es opcional.
      await db
        .update(adminUsers)
        .set({ status: "ACTIVE", mfaEnrolledAt: now })
        .where(eq(adminUsers.identityId, identityId));

      console.error(`[admin] Listo. ${email} ya puede iniciar sesion.`);
      return;
    }

    // ----- Paso 1 -----
    const password = requireEnv("LSW_ADMIN_PASSWORD");
    const fullName = requireEnv("LSW_ADMIN_NAME");
    const roleKey = requireEnv("LSW_ADMIN_ROLE");

    const existing = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.emailNormalized, email))
      .limit(1);

    if (existing[0] !== undefined) {
      console.error(`[admin] Ya existe una identidad con ${email}. Este script no la modifica.`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    const secret = generateTotpSecret();

    const [identity] = await db
      .insert(identities)
      // La cuenta la crea un operador con acceso a la base de datos, asi que el
      // correo se da por verificado: no hay a quien mandarle un enlace todavia.
      .values({ email, status: "ACTIVE", emailVerifiedAt: new Date() })
      .returning({ id: identities.id });

    if (identity === undefined) {
      throw new Error("identity_insert_returned_no_row");
    }

    await db.insert(identityCredentials).values({ identityId: identity.id, passwordHash });

    await db.insert(identityMfaFactors).values({
      identityId: identity.id,
      secretCiphertext: encryptSecret(secret, encryptionKey),
      status: "PENDING",
      label: "alta inicial",
    });

    const [adminUser] = await db
      .insert(adminUsers)
      // INVITED, no ACTIVE: sin MFA confirmado no hay cuenta administrativa
      // utilizable, y el CHECK de la tabla lo impone.
      .values({ identityId: identity.id, fullName, status: "INVITED" })
      .returning({ id: adminUsers.id });

    if (adminUser === undefined) {
      throw new Error("admin_user_insert_returned_no_row");
    }

    await db.insert(adminUserRoles).values({
      adminUserId: adminUser.id,
      roleKey,
      // Null a proposito: no hay administrador previo que conceda este rol. Es
      // la marca de que esta concesion viene del arranque en frio y no del
      // flujo normal con auditoria.
      grantedByAdminUserId: null,
      grantReason: "alta inicial por CLI (arranque en frio de identidad)",
    });

    const uri = totpProvisioningUri(secret, email, ISSUER);

    console.error("");
    console.error("[admin] Cuenta creada en estado INVITED. Falta confirmar el segundo factor.");
    console.error("");
    console.error(
      "  1. Anade esta URI a tu app de autenticacion (Google Authenticator, 1Password,",
    );
    console.error(
      "     Authy...). La mayoria admite pegarla directamente o generar un QR con ella:",
    );
    console.error("");
    console.error(`     ${uri}`);
    console.error("");
    console.error("  2. Cuando la app muestre un codigo de 6 digitos, ejecuta:");
    console.error("");
    console.error(
      "     LSW_ADMIN_MFA_CODE=<codigo> pnpm --filter @lsw/database db:create-admin --confirm",
    );
    console.error("");
    console.error("  Esa URI contiene el secreto en claro. No la guardes ni la pegues en un chat.");
    console.error("");
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("[admin] fallo:", error);
  process.exit(1);
});
