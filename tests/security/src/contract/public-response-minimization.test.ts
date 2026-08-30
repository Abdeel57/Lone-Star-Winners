/**
 * LO QUE UNA RESPUESTA PUBLICA NO PUEDE CONTENER (DEC-044, DEC-052 punto 6).
 *
 * POR QUE HACE FALTA UNA AFIRMACION NEGATIVA
 * ------------------------------------------
 * Todos los tests de contrato que existen comprueban que un campo ESTA. Ninguno
 * puede detectar que apareceria uno de mas: un campo nuevo en una respuesta es
 * aditivo, no rompe ningun cliente, y pasa todas las pruebas verdes. Para los
 * campos de esta lista, "aparece de mas" es exactamente el fallo que importa.
 *
 * QUE HAY EN LA LISTA, Y POR QUE CADA UNO
 * ---------------------------------------
 *   `entry_pool`  DEC-052 punto 6 lo RETIRA del contrato. El 10,000 nunca fue
 *                 un universo total: es el tope POR PARTICIPANTE. Publicarlo
 *                 como un pozo con "emitidas" y "restantes" describe una rifa
 *                 -boletos que se acaban- que es justo lo que `CLAUDE.md`
 *                 seccion 1 dice que este producto no es.
 *
 *   `issued`      La cifra de participaciones ya emitidas. DEC-044 decidio no
 *   `remaining`   pintarla; DEC-052 la retira tambien del transporte. Mientras
 *                 viaje en la respuesta, "no se pinta" depende de que nadie la
 *                 pinte, y eso no es un control: es una convencion.
 *
 *   `stock_quantity`      Inventario. El escaparate publica `availability` con
 *   `quantity_available`  un ESTADO (`IN_STOCK`, `SOLD_OUT`), no un numero.
 *                         Publicar unidades restantes de un producto que genera
 *                         participaciones vuelve a contar la misma historia de
 *                         escasez, y ademas regala a un raspador la evolucion
 *                         de las ventas.
 *
 * COMO SE COMPRUEBA
 * -----------------
 * Sobre `apps/api/openapi/openapi.json`, que es el contrato en forma legible
 * por maquina y lo genera el propio registro de rutas (DEC-014): no hay forma
 * de servir un campo que no este ahi, porque la respuesta se serializa con ese
 * esquema. Se recorren TODAS las rutas publicas, no una lista elegida, para que
 * una ruta publica nueva quede cubierta el dia que exista.
 */

import { describe, expect, it } from "vitest";

import { readRepoFile } from "../helpers/repo.js";
import { readRouteManifest } from "../helpers/api-surface.js";

const OPENAPI_PATH = "apps/api/openapi/openapi.json";

/**
 * Nombres prohibidos en una respuesta publica. Lista CERRADA y justificada
 * arriba: anadir uno es una decision, quitarlo tambien.
 */
const FORBIDDEN_PROPERTIES: readonly string[] = [
  "entry_pool",
  "issued",
  "remaining",
  "stock_quantity",
  "quantity_available",
];

/**
 * Rutas publicas que esta red tiene que estar cubriendo SI O SI.
 *
 * Sin esto, el dia que `GET /promotions/{slug}` cambiara de camino -o
 * desapareciera del documento por un error de generacion- el recorrido de abajo
 * no encontraria nada que mirar y el test pasaria por vacio. Es el mismo modo
 * de fallo que `no-unraw-regexp-source.test.ts` describe: verde por ausencia.
 */
const MUST_BE_COVERED: readonly string[] = [
  "GET /api/v1/promotions/{slug}",
  "GET /api/v1/promotions/active",
  "GET /api/v1/products",
  "GET /api/v1/products/{slug}",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const document: unknown = JSON.parse(readRepoFile(OPENAPI_PATH));

if (!isRecord(document) || !isRecord(document.paths)) {
  throw new Error(`${OPENAPI_PATH}: no tiene \`paths\`. Regenerar con \`contract:emit\`.`);
}

const paths = document.paths;

/**
 * Nombres de propiedad que alcanza un esquema, incluidos los anidados.
 *
 * Recorre el arbol entero -`properties`, `items`, `anyOf`, `oneOf`, `allOf`- y
 * resuelve `$ref` contra `components`. Un campo escondido dos niveles mas abajo
 * viaja igual que uno de primer nivel.
 */
function collectPropertyNames(schema: unknown, seen = new Set<unknown>()): readonly string[] {
  if (!isRecord(schema) || seen.has(schema)) {
    return [];
  }
  seen.add(schema);

  const found: string[] = [];

  const ref = schema.$ref;
  if (typeof ref === "string" && ref.startsWith("#/")) {
    let target: unknown = document;
    for (const segment of ref.slice(2).split("/")) {
      target = isRecord(target)
        ? target[segment.replace(/~1/gu, "/").replace(/~0/gu, "~")]
        : undefined;
    }
    found.push(...collectPropertyNames(target, seen));
  }

  if (isRecord(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      found.push(name);
      found.push(...collectPropertyNames(child, seen));
    }
  }

  for (const key of ["items", "additionalProperties", "not"]) {
    found.push(...collectPropertyNames(schema[key], seen));
  }

  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    const branch = schema[key];
    if (Array.isArray(branch)) {
      for (const child of branch) {
        found.push(...collectPropertyNames(child, seen));
      }
    }
  }

  return found;
}

/** Esquemas de respuesta 2xx de una operacion. */
function successResponseSchemas(operation: unknown): readonly unknown[] {
  if (!isRecord(operation) || !isRecord(operation.responses)) {
    return [];
  }

  const schemas: unknown[] = [];
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!/^2\d\d$/u.test(status) || !isRecord(response) || !isRecord(response.content)) {
      continue;
    }
    for (const media of Object.values(response.content)) {
      if (isRecord(media) && media.schema !== undefined) {
        schemas.push(media.schema);
      }
    }
  }
  return schemas;
}

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

/** Rutas declaradas PUBLIC en el manifiesto, indexadas por `METODO /camino`. */
const publicOperations = new Set(
  readRouteManifest()
    .filter((route) => route.authorization === "PUBLIC")
    // El manifiesto usa `:param` y el documento OpenAPI `{param}`.
    .map((route) => `${route.method} ${route.path.replace(/:([A-Za-z0-9_]+)/gu, "{$1}")}`),
);

interface PublicOperation {
  readonly label: string;
  readonly properties: readonly string[];
}

const inspected: PublicOperation[] = [];

for (const [path, item] of Object.entries(paths)) {
  if (!isRecord(item)) {
    continue;
  }
  for (const method of HTTP_METHODS) {
    const operation = item[method];
    if (operation === undefined) {
      continue;
    }
    const label = `${method.toUpperCase()} ${path}`;
    if (!publicOperations.has(label)) {
      continue;
    }
    const properties = successResponseSchemas(operation).flatMap((schema) =>
      collectPropertyNames(schema),
    );
    inspected.push({ label, properties });
  }
}

describe("la red esta mirando algo", () => {
  it("encuentra rutas publicas en el documento OpenAPI", () => {
    expect(inspected.length, `${OPENAPI_PATH} no declara ninguna ruta publica.`).toBeGreaterThan(0);
  });

  it("cubre el escaparate y la promocion, que son las que publican cifras", () => {
    const covered = new Set(inspected.map((operation) => operation.label));
    const missing = MUST_BE_COVERED.filter((label) => !covered.has(label));

    expect(
      missing,
      "Estas rutas publicas no aparecen en el documento, asi que esta red NO las esta " +
        "vigilando:\n" +
        missing.join("\n"),
    ).toStrictEqual([]);
  });

  it("el recorrido ve tambien las propiedades anidadas", () => {
    // El detector se prueba a si mismo: un escaner que solo mirara el primer
    // nivel pasaria con `{ entry_offer: { issued: 1 } }`, que es exactamente la
    // forma en la que reaparece una cifra retirada.
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { anyOf: [{ type: "null" }, { properties: { entry_pool: { type: "object" } } }] },
        },
      },
    };
    expect(collectPropertyNames(schema)).toContain("entry_pool");
  });
});

describe("DEC-052 punto 6: ninguna respuesta publica publica un pozo de entries", () => {
  it("ninguna ruta publica declara un campo de la lista prohibida", () => {
    const offenders: string[] = [];

    for (const operation of inspected) {
      const present = FORBIDDEN_PROPERTIES.filter((name) => operation.properties.includes(name));
      for (const name of present) {
        offenders.push(`${operation.label}: ${name}`);
      }
    }

    expect(
      offenders,
      "Campos retirados por DEC-044/DEC-052 que vuelven a viajar en una respuesta publica:\n" +
        offenders.join("\n") +
        "\n\n`entry_pool`, `issued` y `remaining` describen un universo que se agota; " +
        "`stock_quantity` y `quantity_available` publican inventario. Lo publico es " +
        "`entry_offer` (base_entries / entries_now / per_participant_max) y " +
        "`availability.status`.",
    ).toStrictEqual([]);
  });

  it("el detalle de promocion no trae `entry_pool` en ninguna forma", () => {
    // El caso literal de DEC-052: se comprueba con nombre y apellidos para que
    // una regresion se lea como lo que es.
    const detail = inspected.find(
      (operation) => operation.label === "GET /api/v1/promotions/{slug}",
    );
    expect(detail).toBeDefined();
    expect(detail?.properties).not.toContain("entry_pool");
  });

  it("el catalogo publico no trae unidades en almacen", () => {
    for (const label of ["GET /api/v1/products", "GET /api/v1/products/{slug}"]) {
      const operation = inspected.find((candidate) => candidate.label === label);
      expect(operation, label).toBeDefined();
      expect(operation?.properties, label).not.toContain("stock_quantity");
      expect(operation?.properties, label).not.toContain("quantity_available");
    }
  });
});
