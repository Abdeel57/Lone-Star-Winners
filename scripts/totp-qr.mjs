/**
 * Dibuja en la terminal el QR de un secreto TOTP (DEC-006, DEC-045).
 *
 * Lo comparten `admin-qr.mjs` (secreto de un fichero `.admin-totp*`) y
 * `admin-recover-qr.mjs` (secreto recuperado de Railway). La URI usa los
 * parametros de `packages/security/src/crypto/totp.ts`: SHA-1, 6 digitos, 30 s.
 *
 * Todo ocurre en este equipo y nada se escribe en disco: el QR ES el secreto.
 */

import QRCode from "qrcode";

import { secondsLeft, totpCode } from "./totp-code.mjs";

export const ISSUER = "Lone Star Winners";

export async function printTotpQr({ secret, label }) {
  const uri =
    `otpauth://totp/${encodeURIComponent(`${ISSUER}:${label}`)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;

  const now = Date.now();

  console.log("");
  console.log(`   Cuenta: ${ISSUER} (${label})`);
  console.log("");
  console.log(
    await QRCode.toString(uri, { type: "terminal", small: true, errorCorrectionLevel: "M" }),
  );
  console.log("   Clave para escribir a mano (tipo: basada en tiempo):");
  console.log(`   ${secret.match(/.{1,4}/gu).join(" ")}`);
  console.log("");
  console.log(
    `   Comprobacion: la app debe mostrar ${totpCode(now, secret)} (${String(secondsLeft(now))} s)`,
  );
  console.log("");
}
