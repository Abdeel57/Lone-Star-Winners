/**
 * Lectura de la superficie HTTP real de `apps/api`.
 *
 * POR QUE SE LEE EL MANIFIESTO Y NO SE IMPORTA `apps/api`
 *
 *   Porque estos tests tienen que poder correr cuando `apps/api` esta a medio
 *   escribir. Importar su codigo ataria el gate de seguridad al estado de
 *   compilacion de otro paquete, y un gate que no corre no es un gate. El
 *   manifiesto es ademas exactamente lo que la cabecera de
 *   `apps/api/src/http/route-registry.ts` designa para esto:
 *
 *     "Es lo que `security` compara contra `docs/API_CONTRACT.md`".
 *
 * EL PROBLEMA OBVIO DE LEER UN ARTEFACTO GENERADO
 *
 *   Que puede estar desactualizado. Un manifiesto viejo convertiria el test de
 *   matriz en un gate que aprueba rutas que ya no existen e ignora las que si.
 *   Es el mismo modo de fallo que `HO-014`: verde por ausencia.
 *
 *   Por eso `scanDeclaredOperationIds()` no se fia: recorre las FUENTES de
 *   `apps/api` buscando declaraciones de ruta, y el test de matriz exige que el
 *   manifiesto las contenga todas. El manifiesto puede ir por detras en los
 *   detalles, pero no puede DESCONOCER una ruta.
 */

import { listRepoTextFiles, readRepoFile, repoPathExists, repoRoot } from "./repo.js";
import { join } from "node:path";

export const ROUTE_MANIFEST_PATH = "apps/api/openapi/route-manifest.json";
export const API_SOURCE_DIR = "apps/api/src";

export interface RouteManifestEntry {
  readonly method: string;
  readonly path: string;
  readonly operation_id: string;
  /**
   * `PUBLIC`, `PARTICIPANT`, `PARTICIPANT_SELF` o el identificador de una
   * capacidad del catalogo de `@lsw/security`.
   */
  readonly authorization: string;
  readonly requires_step_up: boolean;
  readonly tags: readonly string[];
  readonly summary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Valida la forma del manifiesto en vez de confiar en ella.
 *
 * Lo produce otro agente y puede cambiar. Un `as RouteManifestEntry[]` a secas
 * convertiria un cambio de formato en `undefined` recorriendo la matriz, y la
 * matriz pasaria sin comprobar nada.
 */
export function readRouteManifest(): readonly RouteManifestEntry[] {
  const parsed: unknown = JSON.parse(readRepoFile(ROUTE_MANIFEST_PATH));
  if (!isRecord(parsed) || !Array.isArray(parsed.routes)) {
    throw new Error(`${ROUTE_MANIFEST_PATH}: falta el array \`routes\`.`);
  }

  return parsed.routes.map((entry: unknown, index): RouteManifestEntry => {
    if (!isRecord(entry)) {
      throw new Error(`${ROUTE_MANIFEST_PATH}: la entrada ${String(index)} no es un objeto.`);
    }
    const { method, path, operation_id, authorization, requires_step_up, summary } = entry;

    if (
      typeof method !== "string" ||
      typeof path !== "string" ||
      typeof operation_id !== "string" ||
      typeof authorization !== "string" ||
      typeof requires_step_up !== "boolean"
    ) {
      throw new Error(
        `${ROUTE_MANIFEST_PATH}: la entrada ${String(index)} no tiene la forma esperada. ` +
          "Si el formato ha cambiado, hay que actualizar tests/security a proposito, no ignorarlo.",
      );
    }

    return {
      method: method.toUpperCase(),
      path,
      operation_id,
      authorization,
      requires_step_up,
      tags: asStringArray(entry.tags),
      summary: typeof summary === "string" ? summary : "",
    };
  });
}

/**
 * `operationId` declarados en las fuentes de `apps/api`.
 *
 * Solo coincide con literales de cadena, que es como se declara una ruta. Las
 * apariciones del identificador como TIPO (`readonly operationId: string`) o
 * como acceso (`definition.operationId`) no llevan comillas y no se cuentan.
 */
const OPERATION_ID_DECLARATION = /\boperationId\s*:\s*["']([A-Za-z0-9_$]+)["']/gu;

const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/u;

export function scanDeclaredOperationIds(): readonly string[] {
  if (!repoPathExists(API_SOURCE_DIR)) {
    return [];
  }
  const found = new Set<string>();
  for (const file of listRepoTextFiles(join(repoRoot(), API_SOURCE_DIR))) {
    if (!SOURCE_FILE.test(file.path)) {
      continue;
    }
    for (const match of readRepoFile(file.path).matchAll(OPERATION_ID_DECLARATION)) {
      const id = match[1];
      if (id !== undefined) {
        found.add(id);
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
