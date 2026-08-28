/**
 * Codigo de segundo factor para el panel, sin telefono (DEC-006, DEC-045).
 *
 *   node scripts/admin-code.mjs
 *
 * Tambien lo lanza `CODIGO ADMIN.bat` del escritorio, que ademas lo copia al
 * portapapeles. La derivacion vive en `totp-code.mjs`.
 *
 * POR QUE EXISTE
 *   El MFA es obligatorio para todo rol administrativo y no se desactiva sin
 *   cambiar el catalogo de roles, que es una decision de arquitectura. Lo que si
 *   se puede es no depender de un telefono: el codigo lo produce el secreto,
 *   este donde este.
 *
 * QUE SACRIFICA, DICHO CLARO
 *   Un segundo factor vale por vivir en un dispositivo DISTINTO del que se usa
 *   para entrar. Aqui el secreto esta en el mismo equipo, asi que deja de ser
 *   "algo que tienes" aparte y pasa a ser una segunda cerradura en la misma
 *   puerta. Defiende de una contrasena robada a distancia; no defiende de
 *   alguien con acceso a este ordenador.
 *
 *   Es un arranque, no el destino. En cuanto el panel permita inscribir un
 *   autenticador de verdad, esta ruta deberia desaparecer.
 */

import { secondsLeft, totpCode } from "./totp-code.mjs";

const now = Date.now();

console.log("");
console.log("   CODIGO:  " + totpCode(now));
console.log("   (valido " + String(secondsLeft(now)) + " segundos mas)");
console.log("");
