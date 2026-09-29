/**
 * Recupera el QR del segundo factor desde Railway cuando se perdio el fichero
 * `.admin-totp*` (DEC-006, DEC-045, DEC-043).
 *
 *   railway login
 *   railway link
 *   node scripts/admin-recover-qr.mjs
 *
 * POR QUE FUNCIONA
 *   El secreto TOTP no vive solo en el fichero local: `db:create-admin` lo guardo
 *   cifrado en `identity_mfa_factors`, y la clave para descifrarlo es la variable
 *   `MFA_SECRET_ENCRYPTION_KEY` del servicio `api`. Con acceso a Railway se
 *   obtiene exactamente el mismo secreto; la cuenta no cambia.
 *
 * COMO
 *   Postgres no tiene endpoint publico, asi que no se conecta desde aqui. Se
 *   abre `railway ssh` al servicio `api` y se le pasa por stdin
 *   `admin-recover-remote.cjs`, que lee y descifra alli dentro. Por el tunel
 *   vuelve una linea por cuenta, y este lado la dibuja como QR sin escribirla en
 *   disco.
 *
 *   `LSW_RAILWAY_SERVICE` y `LSW_RAILWAY_ENVIRONMENT` eligen otro servicio o
 *   entorno que el enlazado con `railway link`.
 *
 * CUIDADO
 *   Quien tenga acceso a Railway puede hacer esto: esa cuenta de Railway protege
 *   el panel tanto como la contrasena. Y el QR ES el secreto: no se fotografia
 *   ni se envia.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { printTotpQr } from "./totp-qr.mjs";

const remoteScript = readFileSync(new URL("./admin-recover-remote.cjs", import.meta.url), "utf8");

const args = ["ssh", "--service", process.env.LSW_RAILWAY_SERVICE ?? "api"];

if (process.env.LSW_RAILWAY_ENVIRONMENT !== undefined) {
  args.push("--environment", process.env.LSW_RAILWAY_ENVIRONMENT);
}

args.push("node");

const result = spawnSync("railway", args, {
  input: remoteScript,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "inherit"],
  // En Windows `railway` es un .cmd de npm, que solo se resuelve con shell. Los
  // argumentos son fijos o nombres de servicio, sin nada que cmd interprete.
  shell: process.platform === "win32",
  timeout: 120_000,
});

if (result.error !== undefined) {
  console.error("[recuperar] No se pudo ejecutar railway:", result.error.message);
  process.exit(1);
}

const accounts = result.stdout
  .split(/\r?\n/u)
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line));

if (result.status !== 0 || accounts.length === 0) {
  console.error("");
  console.error(`[recuperar] No llego ninguna cuenta (codigo de salida ${String(result.status)}).`);
  console.error("  - Comprueba `railway whoami` y `railway link` (proyecto y entorno correctos).");
  console.error("  - El servicio debe llamarse `api`, o indicalo con LSW_RAILWAY_SERVICE.");
  process.exit(1);
}

for (const account of accounts) {
  await printTotpQr({ secret: account.secret, label: account.email });
  console.log(`   Nombre en el panel: ${account.fullName}`);
  console.log("");
}

console.log(
  "   El QR es el secreto. No lo fotografies ni lo envies. Cierra esta ventana al terminar.",
);
console.log("");
