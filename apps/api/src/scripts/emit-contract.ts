/**
 * Genera los artefactos de contrato:
 *
 *   openapi/openapi.json ......... spec OpenAPI 3.1 (DEC-014), que `frontend`
 *                                  consume con `openapi-typescript`.
 *   openapi/route-manifest.json .. superficie HTTP con el permiso exigido por
 *                                  cada ruta (DEC-015), que `security` compara
 *                                  contra `docs/API_CONTRACT.md` en CI.
 *
 * Ambos se generan desde el registro de rutas, no a mano. Ambos son
 * deterministas: dos ejecuciones sobre el mismo codigo producen bytes
 * identicos, para que un cambio en el diff signifique siempre un cambio real
 * de contrato.
 *
 * NO necesita base de datos ni variables de entorno reales: construye las
 * definiciones de ruta, que son datos puros. Un generador de contrato que
 * exigiera una base de datos viva no se podria ejecutar en CI.
 *
 * POR QUE EL MANIFIESTO PASA POR PRETTIER Y LA SPEC NO
 *
 *   `route-manifest.json` NO esta en `.prettierignore`: `format:check` lo
 *   revisa y `format` lo reescribe. Si el emisor dejara el `JSON.stringify` en
 *   crudo, cada ejecucion escribiria los arrays expandidos, Prettier los
 *   volveria a compactar, y `contract:check` -que es `contract:emit` seguido de
 *   `git diff --exit-code`- fallaria SIEMPRE, aunque el contrato no hubiera
 *   cambiado. Un check que siempre falla no lo mira nadie, y el dia que
 *   detecte una divergencia real no avisa.
 *
 *   Asi que el emisor escribe ya el formato que produce Prettier, y lo hace
 *   leyendo la MISMA configuracion del repositorio en vez de imitarla: una
 *   copia de `printWidth` aqui seria una segunda fuente de verdad de formato,
 *   que es la misma clase de error que este comentario describe.
 *
 *   `openapi.json` si esta en `.prettierignore` (DEC-014) y este script es su
 *   unico escritor, asi que conserva su serializador propio: claves ordenadas y
 *   `LF` explicito, que es lo que lo hace comparable byte a byte.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { collectContractRouteDefinitions, type AppDependencies } from "../app.js";
import { buildOpenApiDocument, serializeOpenApiDocument } from "../http/openapi.js";
import { buildRouteManifest } from "../http/route-registry.js";
import { OPENAPI_DOCUMENT_VERSION } from "../routes/meta.js";
import { CONTRACT_GENERATION_CONFIG } from "../config/contract-config.js";

const OUTPUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "openapi",
);

/** Un solo nombre: se escribe ahi y se resuelve la config de Prettier para ahi. */
const MANIFEST_FILENAME = "route-manifest.json";

/**
 * El manifiesto, formateado como lo dejaria `prettier --write`.
 *
 * La configuracion se resuelve PARA LA RUTA del fichero, no en abstracto:
 * `prettier.config.mjs` tiene un `override` para `*.json`, y resolverla contra
 * otra ruta daria otro ancho de linea.
 *
 * `editorconfig: true` no es opcional: la CLI de Prettier lo activa por
 * defecto, asi que sin el, este emisor y `format:check` podrian discrepar. En
 * este repositorio `.editorconfig` fija `end_of_line = lf`, que es justo lo que
 * no se puede perder en una maquina Windows (DEC-026).
 *
 * Sigue siendo determinista: la salida es funcion de unos datos ya ordenados
 * mas la configuracion versionada del repositorio.
 */
async function formatManifest(manifest: unknown): Promise<string> {
  const filepath = path.join(OUTPUT_DIR, MANIFEST_FILENAME);
  const options = await resolveConfig(filepath, { editorconfig: true });
  return format(`${JSON.stringify(manifest, null, 2)}\n`, {
    ...(options ?? {}),
    filepath,
    parser: "json",
  });
}

async function main(): Promise<void> {
  // Las definiciones de ruta no consultan la base de datos: solo la capturan
  // para que sus handlers puedan usarla en tiempo de ejecucion.
  const dependencies = {
    config: CONTRACT_GENERATION_CONFIG,
    database: undefined,
    paymentProvider: undefined,
  } as unknown as AppDependencies;

  const routes = collectContractRouteDefinitions(dependencies);

  const document = buildOpenApiDocument(routes, {
    title: "Lone Star Winners API",
    version: OPENAPI_DOCUMENT_VERSION,
    description:
      "Plataforma bilingue de e-commerce y sweepstakes. Las promotional entries se generan conforme a las Official Rules; no se venden boletos.",
    serverUrl: CONTRACT_GENERATION_CONFIG.http.publicUrl,
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });

  writeFileSync(path.join(OUTPUT_DIR, "openapi.json"), serializeOpenApiDocument(document), "utf8");

  const manifest = {
    generated_from: "apps/api/src/http/route-registry.ts",
    contract_version: OPENAPI_DOCUMENT_VERSION,
    routes: buildRouteManifest(routes),
  };
  writeFileSync(path.join(OUTPUT_DIR, MANIFEST_FILENAME), await formatManifest(manifest), "utf8");

  console.error(`[contract] ${String(routes.length)} rutas escritas en ${OUTPUT_DIR}`);
}

await main();
