/**
 * TEST DE CONTRATO: el codigo no puede exponer una API que el contrato no
 * documente (DEC-015, regla 1 y 3 de `docs/API_CONTRACT.md`).
 *
 * LA ASIMETRIA ES DELIBERADA
 *
 *   Documentado y no implementado  -> BIEN. Es el estado `PROPOSED`: `frontend`
 *     disena contra el contrato antes de que exista. Este test no lo toca.
 *
 *   Implementado y no documentado  -> MAL. Es una API que existe, responde y
 *     tiene autorizacion propia, y que nadie acordo. Es exactamente lo que
 *     prohibe "no se crean APIs alternativas para evitar coordinarse".
 *
 *   Solo la segunda direccion falla. Por eso el test tolera un contrato
 *   incompleto -que es el estado de hoy, con `backend` poblandolo- sin dejar de
 *   ser un gate.
 *
 * POR QUE LAS RUTAS `meta` NO CUENTAN
 *
 *   `docs/API_CONTRACT.md` se define a si mismo como "fuente de verdad
 *   compartida entre `frontend` y `backend`". Los healthchecks no los consume
 *   `frontend`: los consulta el orquestador. Y `GET /openapi.json` no es una API
 *   documentada por el contrato, ES el contrato en forma legible por maquina.
 *   Documentarlos ahi seria ruido que ensena a hojear el documento.
 *
 *   La exencion es por ETIQUETA, no por lista de rutas: cualquier ruta de
 *   producto que apareciera etiquetada `meta` para esquivar este gate seria un
 *   cambio visible en el manifiesto y en la revision.
 *
 * COMO SE BUSCA UNA RUTA EN EL DOCUMENTO
 *
 *   Por presencia textual de `METODO /camino`, no analizando la estructura del
 *   markdown. El formato exacto lo esta decidiendo `backend` ahora mismo, y un
 *   analizador afinado a un formato que aun no existe fallaria por el motivo
 *   equivocado, que es la peor clase de fallo en un gate.
 */

import { describe, expect, it } from "vitest";

import { CAPABILITY_DOMAINS, isCapabilityId } from "@lsw/security";

import { readRepoFile, repoPathExists } from "../helpers/repo.js";
import { readRouteManifest, type RouteManifestEntry } from "../helpers/api-surface.js";

const CONTRACT_PATH = "docs/API_CONTRACT.md";
const INFRASTRUCTURE_TAG = "meta";

const manifest = readRouteManifest();
const contract = repoPathExists(CONTRACT_PATH) ? readRepoFile(CONTRACT_PATH) : null;

/**
 * Normaliza el documento para poder buscar en el sin depender del formato:
 * se colapsa todo espacio en blanco y se quitan los adornos de markdown que
 * pueden partir un `GET /api/v1/algo` en dos (backticks, negrita, tablas).
 */
function normalize(text: string): string {
  return text
    .replace(/[`*_|]/gu, " ")
    .replace(/\s+/gu, " ")
    .toUpperCase();
}

const normalizedContract = contract === null ? "" : normalize(contract);

/**
 * `:param` (manifiesto) y `{param}` (documento) son el mismo camino.
 *
 * EL FALSO POSITIVO QUE ESTO ARREGLA
 *   El manifiesto siempre escribe los parametros al estilo de Fastify
 *   (`:change_request_id`). El documento usa las DOS notaciones: las secciones
 *   antiguas escriben `:promotion_id` y la seccion 13 escribe
 *   `{promotion_id}`. Comparando literalmente, las diez rutas de la seccion 13
 *   aparecian como "implementadas y no documentadas" estando documentadas, y
 *   este gate -que existe para detectar una API que nadie acordo- habria
 *   mandado a `backend` a arreglar algo que ya estaba bien.
 *
 *   Un gate que da falsos positivos se desactiva, y entonces deja de detectar
 *   el caso real. Se comprueban las dos notaciones en vez de normalizar el
 *   documento entero: reescribir `:algo` en todo el texto tocaria ademas las
 *   lineas `Authorization:` y los ejemplos JSON.
 */
function documentedNotations(path: string): readonly string[] {
  return [path, path.replace(/:([A-Za-z0-9_]+)/gu, "{$1}")];
}

function isDocumented(route: RouteManifestEntry): boolean {
  return documentedNotations(route.path).some((variant) =>
    normalizedContract.includes(normalize(`${route.method} ${variant}`)),
  );
}

function isInfrastructure(route: RouteManifestEntry): boolean {
  return route.tags.includes(INFRASTRUCTURE_TAG);
}

const productRoutes = manifest.filter((route) => !isInfrastructure(route));

describe("el contrato existe y es legible", () => {
  it("docs/API_CONTRACT.md esta en el repositorio", () => {
    expect(repoPathExists(CONTRACT_PATH)).toBe(true);
  });

  it("conserva sus reglas de coordinacion", () => {
    // Si alguien vacia el documento, este test debe fallar por eso y no por
    // "ninguna ruta encontrada", que se leeria como un contrato al dia.
    expect(contract).not.toBeNull();
    expect(normalizedContract.length).toBeGreaterThan(200);
  });
});

describe("DEC-015: ninguna ruta existe en codigo sin estar en el contrato", () => {
  it("toda ruta de producto de apps/api aparece en docs/API_CONTRACT.md", () => {
    const undocumented = productRoutes
      .filter((route) => !isDocumented(route))
      .map((route) => `${route.method} ${route.path} (${route.operation_id})`);

    expect(
      undocumented,
      "Estas rutas existen en el codigo y no estan en docs/API_CONTRACT.md:\n" +
        undocumented.join("\n") +
        "\n\nLa regla 1 del contrato prohibe asumir una API que no este documentada, " +
        "y la 3 prohibe que un cambio de API sea silencioso. Documentarlas es de " +
        "`backend`; `security` no edita ese fichero.",
    ).toStrictEqual([]);
  });

  it("las rutas de infraestructura estan exentas, y son solo las etiquetadas meta", () => {
    const exempt = manifest.filter(isInfrastructure).map((route) => route.path);
    // Ninguna exencion puede apuntar a algo que no sea un healthcheck o el
    // propio documento del contrato.
    const suspicious = exempt.filter((path) => !/^\/api\/v\d+\/(health|openapi\.json)/u.test(path));
    expect(
      suspicious,
      "Ruta etiquetada `meta` que no es infraestructura, y que por tanto se " +
        "estaria saltando el contrato:\n" +
        suspicious.join("\n"),
    ).toStrictEqual([]);
  });
});

describe("el contrato no nombra permisos inexistentes", () => {
  /**
   * Solo se miran las lineas `Authorization:` de la plantilla del documento, no
   * el texto entero. Buscar identificadores con forma de capacidad por todo el
   * markdown daria falsos positivos en cuanto un ejemplo de respuesta usara
   * `producto.slug` o similar, y un gate con falsos positivos se acaba
   * desactivando.
   */
  it("toda capacidad citada en un bloque Authorization existe en el catalogo", () => {
    if (contract === null) {
      return;
    }

    const lines = contract.split("\n");
    const candidates: string[] = [];

    for (const [index, line] of lines.entries()) {
      if (!/^\s*Authorization\s*:/iu.test(line)) {
        continue;
      }
      // El valor puede ir en la misma linea o en la siguiente (la plantilla del
      // documento lo pone debajo).
      const inline = line.replace(/^\s*Authorization\s*:/iu, "");
      const next = lines[index + 1] ?? "";
      for (const chunk of [inline, next]) {
        for (const match of chunk.matchAll(/[a-z][a-z_]*(?:\.[a-z][a-z_]*)+/gu)) {
          candidates.push(match[0]);
        }
      }
    }

    // Solo se consideran los identificadores que ADEMAS empiezan por un dominio
    // del catalogo. Sin este filtro, cualquier `fichero.md` citado en un bloque
    // Authorization se reportaria como permiso inexistente, y un gate con falsos
    // positivos termina desactivado. El prefijo con guion bajo esta a proposito:
    // captura `rules_version.read`, que es justo el vocabulario equivocado con
    // el que llego `HO-013`.
    const looksLikeCapability = (token: string): boolean =>
      CAPABILITY_DOMAINS.some(
        (domain) =>
          token === domain || token.startsWith(`${domain}.`) || token.startsWith(`${domain}_`),
      );

    const unknown = [...new Set(candidates)]
      .filter(looksLikeCapability)
      .filter((token) => !isCapabilityId(token));

    expect(
      unknown,
      "El contrato cita permisos que no existen en `@lsw/security`:\n" +
        unknown.join("\n") +
        "\n\nOjo con el vocabulario: el catalogo usa `rules.version.read`, no " +
        "`rules_version.read`; y `product.write`/`product.publish`, no `product.update`.",
    ).toStrictEqual([]);
  });
});
