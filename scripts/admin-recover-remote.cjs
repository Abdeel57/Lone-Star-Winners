/**
 * Parte REMOTA de `admin-recover-qr.mjs`. No se ejecuta en local.
 *
 * Corre dentro del contenedor del servicio `api` de Railway, que es el unico
 * sitio con red hasta Postgres (la base no tiene endpoint publico, DEC-043) y
 * con `MFA_SECRET_ENCRYPTION_KEY`. Llega por stdin, asi que es CommonJS y no
 * puede importar nada del repositorio local: usa `pg` y `@lsw/security` ya
 * compilados dentro del contenedor.
 *
 * SOLO LEE
 *   Un SELECT sobre los factores ACTIVE del personal. No modifica filas, no
 *   crea sesiones y no escribe en disco. Imprime una linea JSON por cuenta con
 *   el secreto descifrado, que el lado local convierte en QR.
 */

(async () => {
  const { createRequire } = require("node:module");
  const { existsSync } = require("node:fs");
  const { join } = require("node:path");
  const { pathToFileURL } = require("node:url");

  // Railpack deja el monorepo en /app; si una sesion arranca en otro sitio,
  // se prueba el directorio actual.
  const root = ["/app", process.cwd()].find((dir) =>
    existsSync(join(dir, "packages/security/dist/index.js")),
  );

  if (root === undefined) {
    throw new Error("no encuentro packages/security/dist en el contenedor");
  }

  const { Client } = createRequire(join(root, "packages/database/package.json"))("pg");
  const security = await import(pathToFileURL(join(root, "packages/security/dist/index.js")).href);

  for (const name of ["DATABASE_URL_APP", "MFA_SECRET_ENCRYPTION_KEY"]) {
    if (!process.env[name]) {
      throw new Error(`falta ${name} en el entorno del contenedor`);
    }
  }

  const key = security.decodeSecretBoxKey(process.env.MFA_SECRET_ENCRYPTION_KEY);
  const client = new Client({ connectionString: process.env.DATABASE_URL_APP });

  await client.connect();

  try {
    const { rows } = await client.query(
      `SELECT i.email, a.full_name, f.secret_ciphertext
         FROM identity_mfa_factors f
         JOIN identities i ON i.id = f.identity_id
         JOIN admin_users a ON a.identity_id = i.id
        WHERE f.status = 'ACTIVE' AND f.factor_type = 'TOTP'
        ORDER BY i.email`,
    );

    for (const row of rows) {
      process.stdout.write(
        JSON.stringify({
          email: row.email,
          fullName: row.full_name,
          secret: security.decryptSecret(row.secret_ciphertext, key),
        }) + "\n",
      );
    }
  } finally {
    await client.end();
  }
})().catch((error) => {
  process.stderr.write(`[recuperar] ${error.message}\n`);
  process.exit(1);
});
