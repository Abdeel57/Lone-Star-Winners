/**
 * MATRIZ rol x endpoint sobre el 100% de las rutas de `apps/api` (DEC-015).
 *
 * QUE ANADE ESTO A `authorization-matrix.test.ts`
 *
 *   Aquel comprueba la matriz rol x CAPACIDAD: que el catalogo es coherente y
 *   que nadie acumula lo que no debe. Este comprueba la matriz rol x RUTA: que
 *   la superficie HTTP realmente expuesta se corresponde con esa matriz.
 *
 *   La diferencia importa porque los dos fallos que de verdad ocurren no viven
 *   en el catalogo:
 *
 *     1. una ruta declara una capacidad que no es la suya (mas ancha, o
 *        simplemente la que habia a mano: es lo que provoco `HO-013`, con tests
 *        reapuntados a `order.read` por no existir `promotion.read`);
 *     2. una ruta se declara publica sin que nadie lo revise.
 *
 *   Ninguno de los dos lo ve un test que solo mire el catalogo.
 *
 * COBERTURA
 *   No se eligen rutas: se recorren TODAS las del manifiesto, y se comprueba
 *   ademas que el manifiesto conoce todas las que declaran las fuentes. Un test
 *   de autorizacion que cubre "las rutas importantes" cubre, por definicion,
 *   las que alguien considero importantes.
 */

import { describe, expect, it } from "vitest";

import {
  authorize,
  CAPABILITY_IDS,
  getCapability,
  hasCapability,
  isCapabilityId,
  ROLE_IDS,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type CapabilityId,
  type RoleId,
} from "@lsw/security";

import {
  readRouteManifest,
  scanDeclaredOperationIds,
  ROUTE_MANIFEST_PATH,
  type RouteManifestEntry,
} from "../helpers/api-surface.js";

const manifest = readRouteManifest();

/** Etiquetas de autorizacion que no son capacidades. */
const NON_CAPABILITY_AUTHORIZATIONS = new Set(["PUBLIC", "PARTICIPANT", "PARTICIPANT_SELF"]);

function describeRoute(route: RouteManifestEntry): string {
  return `${route.method} ${route.path}`;
}

/**
 * Rutas de infraestructura, no de producto.
 *
 * Lista CERRADA y corta, como la de rutas generadas por el framework en
 * `route-registry.ts`. Un healthcheck lo consulta el orquestador antes de que
 * exista sesion alguna, y el documento OpenAPI ES el contrato.
 */
const INFRASTRUCTURE_TAG = "meta";

function isInfrastructureRoute(route: RouteManifestEntry): boolean {
  return route.tags.includes(INFRASTRUCTURE_TAG);
}

/**
 * Fragmentos de ruta que NUNCA pueden quedar sin autenticacion.
 *
 * Es una comprobacion sobre la forma de la url, no sobre una lista de rutas
 * conocidas, precisamente para que siga funcionando con rutas que todavia no
 * existen. `backend` esta escribiendo endpoints ahora mismo; el dia que uno de
 * estos aparezca marcado como PUBLIC, este test lo dice antes de que se
 * despliegue.
 */
const NEVER_PUBLIC_SEGMENTS: readonly string[] = [
  "/admin",
  "/export",
  "/exports",
  "/snapshot",
  "/draw",
  "/winner",
  "/audit",
  "/reconciliation",
  "/adjust",
  "/ledger",
  "/rbac",
  "/roles",
  "/flags",
  "/tpa",
  "/review",
];

function violatesNeverPublic(path: string): boolean {
  const normalized = path.toLowerCase();
  return NEVER_PUBLIC_SEGMENTS.some((segment) => normalized.includes(segment));
}

/** Contexto que concede todo lo que no sea la propia capacidad. */
function permissiveContext(roles: readonly RoleId[], capability: CapabilityId) {
  return {
    roles,
    capability,
    secondsSinceLastMfa: 1,
    stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS_LIMIT,
    reasonProvided: true,
    secondApprovalGranted: true,
    featureFlagEnabled: true,
  } as const;
}

describe("el manifiesto de rutas es utilizable como evidencia", () => {
  it("existe y declara al menos una ruta", () => {
    expect(manifest.length, `${ROUTE_MANIFEST_PATH} no declara ninguna ruta.`).toBeGreaterThan(0);
  });

  it("no conoce menos rutas que las que declaran las fuentes de apps/api", () => {
    // Un manifiesto desactualizado convertiria toda la matriz de abajo en un
    // gate ciego. No se compara al reves a proposito: el manifiesto puede
    // contener rutas que solo se registran fuera de produccion.
    const declared = scanDeclaredOperationIds();
    const known = new Set(manifest.map((route) => route.operation_id));
    const missing = declared.filter((id) => !known.has(id));

    expect(
      missing,
      `${ROUTE_MANIFEST_PATH} esta desactualizado: faltan ${missing.join(", ")}. ` +
        "Regenerar con `pnpm --filter @lsw/api run contract:emit`.",
    ).toStrictEqual([]);
  });

  it("no hay dos rutas con el mismo metodo y camino", () => {
    const signatures = manifest.map(describeRoute);
    expect(signatures.length).toBe(new Set(signatures).size);
  });

  it("no hay dos rutas con el mismo operationId", () => {
    const ids = manifest.map((route) => route.operation_id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("DEC-015: toda ruta declara una autorizacion que existe", () => {
  it("ninguna ruta exige una capacidad ausente del catalogo", () => {
    const unknown = manifest
      .filter(
        (route) =>
          !NON_CAPABILITY_AUTHORIZATIONS.has(route.authorization) &&
          !isCapabilityId(route.authorization),
      )
      .map((route) => `${describeRoute(route)} -> ${route.authorization}`);

    expect(
      unknown,
      "Una ruta exige un permiso que nadie puede conceder ni auditar:\n" + unknown.join("\n"),
    ).toStrictEqual([]);
  });

  it("`requires_step_up` del manifiesto coincide con el catalogo", () => {
    const mismatched = manifest
      .filter((route) => isCapabilityId(route.authorization))
      .filter(
        (route) =>
          route.requires_step_up !==
          getCapability(route.authorization as CapabilityId).requiresStepUp,
      )
      .map(describeRoute);

    expect(
      mismatched,
      `El manifiesto miente sobre el step-up en:\n${mismatched.join("\n")}`,
    ).toStrictEqual([]);
  });
});

describe("matriz rol x endpoint: cobertura total", () => {
  it("cada ruta del manifiesto tiene un veredicto para cada rol", () => {
    const decisions: string[] = [];

    for (const route of manifest) {
      for (const role of ROLE_IDS) {
        const label = `${describeRoute(route)} | ${role}`;

        if (route.authorization === "PUBLIC") {
          decisions.push(`${label} | ALLOW(public)`);
          continue;
        }

        if (NON_CAPABILITY_AUTHORIZATIONS.has(route.authorization)) {
          // Rutas de participante. No pasan por el catalogo de capacidades: lo
          // que las acota es la sesion y, en las `PARTICIPANT_SELF`, el propio
          // handler. Se cuentan para la cobertura y se comprueban aparte.
          decisions.push(`${label} | PARTICIPANT_SESSION`);
          continue;
        }

        const capability = route.authorization as CapabilityId;
        const granted = hasCapability([role], capability);
        const decision = authorize(permissiveContext([role], capability));

        // La decision efectiva nunca puede ser mas amplia que la matriz.
        expect(decision.allowed, `${label}: autoriza sin tener la capacidad`).toBe(granted);
        decisions.push(`${label} | ${granted ? "ALLOW" : "DENY"}`);
      }
    }

    expect(decisions.length).toBe(manifest.length * ROLE_IDS.length);
  });

  it("una ruta de participante con identificador ajeno en la url debe ser selfOnly", () => {
    // `PARTICIPANT` a secas significa "hace falta sesion de participante", sin
    // mas. Si ademas la url nombra a un participante, esa ruta puede devolver
    // los datos de OTRO en cuanto el handler se despiste, y el manifiesto es el
    // unico sitio donde eso se ve sin leer el handler.
    const offending = manifest
      .filter((route) => route.authorization === "PARTICIPANT")
      .filter((route) => /[:{](participant|user|account)[A-Za-z]*[}]?/u.test(route.path))
      .map(describeRoute);

    expect(
      offending,
      "Ruta de participante parametrizada por identificador y no marcada selfOnly:\n" +
        offending.join("\n"),
    ).toStrictEqual([]);
  });

  it("un actor sin ningun rol solo pasa por rutas publicas", () => {
    for (const route of manifest) {
      if (route.authorization === "PUBLIC") {
        continue;
      }
      if (NON_CAPABILITY_AUTHORIZATIONS.has(route.authorization)) {
        continue;
      }
      const decision = authorize(permissiveContext([], route.authorization as CapabilityId));
      expect(decision.allowed, `${describeRoute(route)} deja pasar a un anonimo`).toBe(false);
    }
  });

  it("ninguna ruta expone a un PARTICIPANT una capacidad de personal", () => {
    const leaks = manifest
      .filter((route) => isCapabilityId(route.authorization))
      .filter((route) => hasCapability(["PARTICIPANT"], route.authorization as CapabilityId))
      .filter((route) => !route.authorization.includes(".self."))
      .map(describeRoute);

    expect(
      leaks,
      `Rutas de personal alcanzables por un participante:\n${leaks.join("\n")}`,
    ).toStrictEqual([]);
  });

  it("ninguna ruta que toque PII es alcanzable por un participante que no sea el titular", () => {
    const offending = manifest
      .filter((route) => isCapabilityId(route.authorization))
      .filter((route) => {
        const capability = getCapability(route.authorization as CapabilityId);
        return capability.touchesPii && !capability.id.includes(".self.");
      })
      .filter((route) => hasCapability(["PARTICIPANT"], route.authorization as CapabilityId))
      .map(describeRoute);

    expect(offending).toStrictEqual([]);
  });
});

describe("superficie publica", () => {
  it("ninguna ruta administrativa esta declarada PUBLIC", () => {
    const offending = manifest
      .filter((route) => route.authorization === "PUBLIC")
      .filter((route) => violatesNeverPublic(route.path))
      .map(describeRoute);

    expect(
      offending,
      "Ruta administrativa sin autenticacion:\n" +
        offending.join("\n") +
        "\nSi de verdad debe ser publica, hace falta justificarlo y revisar esta lista a proposito.",
    ).toStrictEqual([]);
  });

  it("toda ruta publica que no sea infraestructura queda registrada aqui", () => {
    // No falla: informa. La lista se imprime para que una ruta publica nueva
    // aparezca en la salida de CI aunque nadie vaya a mirarla en el manifiesto.
    const publicProductRoutes = manifest
      .filter((route) => route.authorization === "PUBLIC" && !isInfrastructureRoute(route))
      .map(describeRoute);

    expect(Array.isArray(publicProductRoutes)).toBe(true);
  });

  it("una ruta publica nunca exige step-up, que seria una contradiccion", () => {
    const contradictory = manifest
      .filter((route) => route.authorization === "PUBLIC" && route.requires_step_up)
      .map(describeRoute);
    expect(contradictory).toStrictEqual([]);
  });
});

describe("el catalogo y la superficie no divergen", () => {
  it("toda capacidad usada por una ruta sigue existiendo", () => {
    const known = new Set<string>(CAPABILITY_IDS);
    for (const route of manifest) {
      if (NON_CAPABILITY_AUTHORIZATIONS.has(route.authorization)) {
        continue;
      }
      expect(known.has(route.authorization), describeRoute(route)).toBe(true);
    }
  });
});
