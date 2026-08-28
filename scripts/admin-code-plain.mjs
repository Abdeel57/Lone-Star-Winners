/**
 * Igual que `admin-code.mjs`, pero imprime SOLO los seis digitos.
 *
 * Existe para que `CODIGO ADMIN.bat` pueda capturar el codigo en una variable y
 * copiarlo al portapapeles. Un `for /f` de cmd lee la primera palabra de la
 * salida, asi que cualquier adorno alrededor del numero lo rompe.
 */
import { totpCode } from "./totp-code.mjs";

process.stdout.write(totpCode(Date.now()) + "\n");
