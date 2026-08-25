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
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function main(): void {
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
  writeFileSync(
    path.join(OUTPUT_DIR, "route-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.error(`[contract] ${String(routes.length)} rutas escritas en ${OUTPUT_DIR}`);
}

main();
