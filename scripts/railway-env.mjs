#!/usr/bin/env node
/**
 * Genera el bloque de variables de entorno para Railway (DEC-043).
 *
 *   node scripts/railway-env.mjs
 *
 * Imprime dos bloques listos para pegar en el "Raw Editor" de variables de
 * Railway, uno por servicio. Los secretos se generan aqui, en tu maquina, y
 * NO se escriben en ningun archivo: van a la salida estandar y de ahi al
 * gestor de variables de Railway. El repositorio nunca los ve (principios 19
 * y 20 de CLAUDE.md).
 *
 * Todo lo que aparece como `${{...}}` es una referencia de Railway y debe
 * pegarse TAL CUAL: Railway la resuelve al desplegar. No la sustituyas a mano.
 *
 * Si lo ejecutas dos veces obtendras secretos distintos. Eso es correcto para
 * la primera instalacion; para rotarlos despues, ver la nota del final.
 */

import { randomBytes } from "node:crypto";

/**
 * base64url: solo `A-Z a-z 0-9 _ -`. Se elige justamente porque estas
 * contrasenas se incrustan dentro de una URL de conexion de PostgreSQL, y un
 * `+`, `/` o `=` obligaria a codificarlas para que la URL siguiera siendo
 * valida. Un secreto que hay que escapar es un secreto que alguien acabara
 * pegando mal.
 */
/**
 * `apps/api/src/config/env.ts` rechaza en produccion cualquier secreto que
 * contenga un marcador de la plantilla (FAKE, CHANGE_ME, REPLACE, EJEMPLO,
 * EXAMPLE), porque delata a alguien que copio `.env.example` y no lo relleno.
 * Un valor aleatorio puede contener "FAKE" por pura casualidad; es raro, pero
 * el fallo seria un arranque rechazado con un mensaje que acusa de algo que no
 * ha pasado. Sale mas barato descartarlo y volver a tirar.
 */
const PLACEHOLDER_MARKERS = /FAKE|CHANGE_ME|REPLACE|EJEMPLO|EXAMPLE/i;

const secret = (bytes = 32) => {
  for (;;) {
    const candidate = randomBytes(bytes).toString("base64url");
    if (!PLACEHOLDER_MARKERS.test(candidate)) {
      return candidate;
    }
  }
};

const sessionSecret = secret(48);
const appPassword = secret(24);
const migratorPassword = secret(24);
const readonlyPassword = secret(24);

const api = `NODE_ENV=production
TZ=UTC
LOG_LEVEL=info

PORT=8080
API_HOST=::
API_PORT=8080
API_PUBLIC_URL=https://\${{RAILWAY_PUBLIC_DOMAIN}}
API_BODY_LIMIT_BYTES=1048576
API_CORS_ALLOWED_ORIGINS=https://\${{web.RAILWAY_PUBLIC_DOMAIN}}
API_REQUEST_ID_HEADER=x-request-id
API_RATE_LIMIT_WINDOW_SECONDS=60
API_RATE_LIMIT_MAX_REQUESTS=120

DATABASE_NETWORK=private
DATABASE_SSL_MODE=disable
DATABASE_URL_APP=postgresql://lsw_app:\${{LSW_DB_APP_PASSWORD}}@\${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/\${{Postgres.PGDATABASE}}
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=15000

DATABASE_URL_SUPERUSER=\${{Postgres.DATABASE_URL}}
LSW_DB_APP_PASSWORD=${appPassword}
LSW_DB_MIGRATOR_PASSWORD=${migratorPassword}
LSW_DB_READONLY_PASSWORD=${readonlyPassword}

SESSION_SECRET=${sessionSecret}
SESSION_COOKIE_NAME=lsw_session
SESSION_COOKIE_DOMAIN=\${{web.RAILWAY_PUBLIC_DOMAIN}}
SESSION_COOKIE_SECURE=true
SESSION_TTL_MINUTES=1440
ADMIN_SESSION_TTL_MINUTES=60
ADMIN_SESSION_IDLE_TIMEOUT_MINUTES=15
STEP_UP_MAX_AGE_SECONDS=300

PAYMENT_PROVIDER=none
DEFAULT_CURRENCY=USD`;

const web = `NODE_ENV=production
TZ=UTC
PORT=8080
API_BASE_URL=http://\${{api.RAILWAY_PRIVATE_DOMAIN}}:8080/api/v1
WEB_ENABLE_API_MOCKS=false`;

const rule = "=".repeat(74);

process.stdout.write(`${rule}
VARIABLES PARA RAILWAY - Lone Star Winners (DEC-043)
${rule}

CONTIENE SECRETOS RECIEN GENERADOS. No pegues esta salida en un chat, un
issue ni un commit. Solo en el gestor de variables de Railway.

Los nombres de servicio importan: este bloque asume que has llamado a los
servicios exactamente "api", "web" y "Postgres". Si usas otros nombres,
ajusta las referencias \${{...}} en consecuencia.

${rule}
SERVICIO "api"  ->  Variables  ->  Raw Editor  ->  pegar todo esto
${rule}

${api}

${rule}
SERVICIO "web"  ->  Variables  ->  Raw Editor  ->  pegar todo esto
${rule}

${web}

${rule}

NOTA SOBRE ROTACION
Volver a ejecutar este script genera secretos nuevos. Si ya habias
desplegado, cambiar LSW_DB_APP_PASSWORD aqui NO basta: la contrasena del rol
en PostgreSQL solo se actualiza cuando vuelve a correr \`db:bootstrap\`, que
sucede en el siguiente despliegue de "api". Cambia la variable y redespliega;
entre ambos momentos la API no podra conectarse.

SESSION_SECRET es distinto: rotarlo invalida todas las sesiones abiertas.
Hoy no hay sesiones implementadas, asi que es inocuo; cuando las haya, no lo
sera.
`);
