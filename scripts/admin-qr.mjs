/**
 * QR para llevar el segundo factor del panel a una app de autenticacion
 * (Google Authenticator, Microsoft Authenticator, 1Password...) (DEC-006, DEC-045).
 *
 *   node scripts/admin-qr.mjs
 *   $env:LSW_TOTP_FILE = ".admin-totp-aprobacion"; node scripts/admin-qr.mjs
 *
 * QUE HACE
 *   Lee el mismo secreto que `admin-code.mjs` y lo dibuja como QR en la
 *   terminal (`totp-qr.mjs`). Todo ocurre en este equipo: el secreto no sale a
 *   ningun servicio, y por eso no se usa un generador online.
 *
 *   Si el fichero se perdio, `admin-recover-qr.mjs` saca el mismo QR de Railway.
 *
 * CUIDADO
 *   El QR ES el secreto. Quien lo fotografie genera codigos para siempre. Se
 *   escanea en persona y se cierra la terminal; no se envia por chat ni correo,
 *   y no se guarda como imagen.
 */

import { readSecret } from "./totp-code.mjs";
import { printTotpQr } from "./totp-qr.mjs";

const file = process.env.LSW_TOTP_FILE ?? ".admin-totp";

// Etiqueta visible en la app. Por defecto sale del nombre del fichero, para que
// las cuentas de operacion y aprobacion no se confundan en el telefono.
const label = process.env.LSW_QR_LABEL ?? (file.replace(/^\.admin-totp[-._]?/u, "") || "admin");

await printTotpQr({ secret: readSecret(), label });

console.log(
  "   El QR es el secreto. No lo fotografies ni lo envies. Cierra esta ventana al terminar.",
);
console.log("");
