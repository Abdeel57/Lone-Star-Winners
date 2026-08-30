/**
 * AUTORIZACION DE LAS 21 RUTAS DE LA SECCION 13 (HO-041, DEC-052/053/054, y la
 * resolucion del Team Lead a los hallazgos de la fase 1 de security).
 *
 * QUE ES ESTE FICHERO
 * -------------------
 * La tabla de la seccion 13.11 de `docs/API_CONTRACT.md`, escrita como codigo
 * ejecutable. Cada fila declara metodo, camino y capacidad exigida; el test
 * comprueba, para cada una, las cuatro preguntas que un tercero hara despues:
 *
 *   1. quien puede (matriz rol x ruta, deny-by-default);
 *   2. que pasa sin capacidad (403 FORBIDDEN, nunca 200);
 *   3. que pasa sin motivo donde el motivo es obligatorio (403, NO 422: lo
 *      deniega la puerta antes de llegar al esquema del cuerpo);
 *   4. que pasa sin MFA reciente donde hay step-up (403 STEP_UP_REQUIRED).
 *
 * Las cuatro se responden con `authorize()` del catalogo, que es exactamente lo
 * que `apps/api/src/http/session-authorizer.ts` invoca en su `preHandler`; los
 * codigos HTTP salen de la traduccion que hace `route-registry.ts`
 * (`FORBIDDEN` -> `ApiErrors.forbidden` 403; `STEP_UP_REQUIRED` ->
 * `ApiErrors.stepUpRequired` 403), y se comprueban leyendo esas fuentes en vez
 * de darlos por sabidos.
 *
 * POR QUE SE ESCRIBE ANTES DE QUE LAS RUTAS EXISTAN
 * ------------------------------------------------
 * Porque el orden de `CLAUDE.md` seccion 3 es AGREE ON CONTRACT -> IMPLEMENT ->
 * TEST, y una prueba de autorizacion escrita despues de la ruta se escribe
 * mirando lo que la ruta hace. Lo que aqui se afirma es lo que el contrato
 * exige.
 *
 * CONSECUENCIA HONESTA: mientras `backend` no publique el manifiesto con estas
 * rutas, el bloque "la superficie real coincide con el contrato" FALLA, y debe
 * fallar. No se marca `skip`: un gate en verde por ausencia es el modo de fallo
 * que `tests/security` existe para no repetir (ver la cabecera de
 * `no-unraw-regexp-source.test.ts`). El resto del fichero -catalogo, matriz,
 * motivo, step-up- pasa desde hoy, porque el catalogo si existe.
 */

import { describe, expect, it } from "vitest";

import {
  authorize,
  capabilityForFlagUpdate,
  DUAL_CONTROL_FLAG_KEYS,
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  flagRequiresDualControl,
  LEGALLY_MATERIAL_FLAG_KEYS,
  getCapability,
  hasCapability,
  isCapabilityId,
  ROLE_IDS,
  SEPARATION_OF_DUTIES,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type AuthorizationContext,
  type CapabilityId,
  type RoleId,
} from "@lsw/security";

import { join } from "node:path";

import { listRepoTextFiles, readRepoFile, repoPathExists, repoRoot } from "../helpers/repo.js";
import { readRouteManifest, type RouteManifestEntry } from "../helpers/api-surface.js";

/**
 * Una fila de la tabla de la seccion 13.11.
 *
 * `authorization` es `"PUBLIC"` o una capacidad. `path` se escribe con la
 * plantilla `{param}` del contrato y se normaliza para comparar con el
 * manifiesto, que usa `:param`.
 */
interface ContractRoute {
  readonly method: string;
  readonly path: string;
  readonly authorization: "PUBLIC" | CapabilityId;
  /** Nota del contrato, para que el mensaje de fallo se lea sin abrir el .md. */
  readonly note: string;
}

/**
 * LAS 21 RUTAS, EN EL ORDEN DE LA TABLA DE LA SECCION 13.11.
 *
 * Eran 18 en la tabla original. La resolucion del Team Lead a los hallazgos de
 * la fase 1 retira `PATCH /admin/settings/amoe-mode` -que exigia una capacidad
 * con segunda aprobacion y por tanto era inalcanzable- y anade las cuatro de
 * `settings/change-requests`, que son el control dual con el que se cambia un
 * flag legalmente material o la modalidad AMOE.
 *
 * Se transcriben a mano y no se derivan del markdown a proposito: derivarlas
 * significaria que un error de transcripcion en el documento se propagaria
 * intacto al test, y entonces el test no comprobaria nada que el documento no
 * dijera ya. Escritas aqui, cualquier discrepancia entre las tres fuentes
 * -contrato, catalogo y superficie- sale como fallo.
 */
const SECTION_13_ROUTES: readonly ContractRoute[] = Object.freeze([
  {
    method: "GET",
    path: "/api/v1/product-categories",
    authorization: "PUBLIC",
    note: "13.6: solo categorias con al menos un producto ACTIVE.",
  },
  {
    method: "GET",
    path: "/api/v1/admin/product-categories",
    authorization: "product.read",
    note: "13.6",
  },
  {
    method: "POST",
    path: "/api/v1/admin/product-categories",
    authorization: "product.write",
    note: "13.6",
  },
  {
    method: "PATCH",
    path: "/api/v1/admin/product-categories/{category_key}",
    authorization: "product.write",
    note: "13.6",
  },
  {
    method: "GET",
    path: "/api/v1/admin/products/{product_id}/variants",
    authorization: "product.read",
    note: "13.6",
  },
  {
    method: "POST",
    path: "/api/v1/admin/products/{product_id}/variants",
    authorization: "product.write",
    note: "13.6: no hay DELETE, se archiva.",
  },
  {
    method: "PATCH",
    path: "/api/v1/admin/products/{product_id}/variants/{variant_id}",
    authorization: "product.write",
    note: "13.6",
  },
  {
    method: "GET",
    path: "/api/v1/admin/promotions/{promotion_id}/rules-versions",
    authorization: "rules.version.read",
    note: "13.7",
  },
  {
    method: "POST",
    path: "/api/v1/admin/promotions/{promotion_id}/rules-versions",
    authorization: "rules.version.create",
    note: "13.7: nace DRAFT; sin step-up.",
  },
  {
    method: "GET",
    path: "/api/v1/admin/promotions/{promotion_id}/rules-versions/{rules_version_id}",
    authorization: "rules.version.read",
    note: "13.7",
  },
  {
    method: "PATCH",
    path: "/api/v1/admin/promotions/{promotion_id}/rules-versions/{rules_version_id}",
    authorization: "rules.version.create",
    note: "13.7: solo sobre DRAFT; el cerrojo es el trigger de DEC-012.",
  },
  {
    method: "PUT",
    path: "/api/v1/admin/promotions/{promotion_id}/rules-versions/{rules_version_id}/documents/{locale}",
    authorization: "rules.version.create",
    note: "13.7: documento legal por locale, solo en DRAFT.",
  },
  {
    method: "POST",
    path: "/api/v1/admin/promotions/{promotion_id}/rules-versions/{rules_version_id}/activate",
    authorization: "rules.version.activate",
    note: "13.7: motivo + step-up.",
  },
  {
    method: "POST",
    path: "/api/v1/admin/promotions/{promotion_id}/bonus-periods",
    authorization: "rules.version.activate",
    note: "13.8: el atajo bonus ES una version de reglas nueva, y por eso exige la MISMA capacidad que activar una.",
  },
  {
    method: "GET",
    path: "/api/v1/admin/feature-flags",
    authorization: "flag.read",
    note: "13.9",
  },
  {
    method: "PATCH",
    path: "/api/v1/admin/feature-flags/{key}",
    authorization: "flag.update",
    note: "13.9 (resolucion HO-041): capacidad ESTATICA `flag.update`, solo para flags NO materiales. Sobre uno material responde 409 FLAG_LEGALLY_MATERIAL, no 403.",
  },
  {
    method: "POST",
    path: "/api/v1/admin/settings/change-requests",
    authorization: "flag.update.legally_material",
    note: "13.9 (resolucion HO-041): control dual. Motivo + step-up, y la ruta declara `secondApprovalEnforcedBy`.",
  },
  {
    method: "GET",
    path: "/api/v1/admin/settings/change-requests",
    authorization: "flag.read",
    note: "13.9 (resolucion HO-041): la cola de solicitudes se LEE con la capacidad de lectura de flags, no con la de escritura.",
  },
  {
    method: "POST",
    path: "/api/v1/admin/settings/change-requests/{change_request_id}/approve",
    authorization: "flag.update.legally_material",
    note: "13.9 (resolucion HO-041): aprobar por quien solicito -> 409 SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN.",
  },
  {
    method: "POST",
    path: "/api/v1/admin/settings/change-requests/{change_request_id}/reject",
    authorization: "flag.update.legally_material",
    note: "13.9 (resolucion HO-041): rechazar tambien exige motivo y step-up; el historico se conserva.",
  },
  {
    method: "POST",
    path: "/api/v1/admin/amoe-submissions",
    authorization: "amoe.submission.transcribe",
    note: "13.10: transcripcion de ficha postal; motivo opcional, sin step-up.",
  },
]);

/** Rutas de la seccion que exigen una capacidad (todas menos la publica). */
const CAPABILITY_ROUTES = SECTION_13_ROUTES.filter(
  (route): route is ContractRoute & { authorization: CapabilityId } =>
    route.authorization !== "PUBLIC",
);

function describeRoute(route: ContractRoute | RouteManifestEntry): string {
  return `${route.method} ${route.path}`;
}

/** `{param}` del contrato y `:param` del manifiesto son el mismo camino. */
function normalizePath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/gu, ":$1").replace(/:[A-Za-z0-9_]+/gu, ":param");
}

/**
 * Contexto que concede TODO lo que no sea la propia capacidad.
 *
 * Igual que en `route-authorization-matrix.test.ts`: asi, cuando una prueba
 * deniega, se sabe que denego por lo que se estaba probando y no por un dato de
 * contexto que faltaba.
 */
function contextFor(
  roles: readonly RoleId[],
  capability: CapabilityId,
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    roles,
    capability,
    secondsSinceLastMfa: 1,
    stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS_LIMIT,
    reasonProvided: true,
    secondApprovalGranted: true,
    featureFlagEnabled: true,
    ...overrides,
  };
}

const API_ERRORS_PATH = "apps/api/src/http/errors.ts";

/**
 * Codigos de error que la seccion 13 y su resolucion introducen.
 *
 * Cada uno responde a una pregunta distinta. Un solo codigo generico para todos
 * -un 409 CONFLICT a secas- haria indistinguible "esta persona no puede aprobar
 * esto" de "por esta ruta no se cambia esa clave", y el panel no podria
 * explicar ninguna de las dos.
 *
 *   AMOE_ENTRY_CAP_REACHED ................. 13.3: no queda hueco bajo el tope.
 *   RULES_VERSION_NOT_ACTIVE ............... 13.8: no hay version que clonar.
 *   RULES_CONFIG_INVALID ................... 13.7: la config no parsea.
 *   SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN . quien solicita no aprueba.
 *   FLAG_REQUIRES_CHANGE_REQUEST ........... esta clave va por la cola de
 *                                            solicitudes, no por el PATCH.
 *   AMOE_PARTICIPANT_INELIGIBLE_STAFF ...... la ficha lleva el correo de una
 *                                            cuenta de personal.
 *   AMOE_MODE_NOT_ONLINE ................... con AMOE postal, el envio en
 *                                            linea se rechaza.
 *   AMOE_MODE_NOT_MAIL_IN .................. sin AMOE postal, no se
 *                                            transcriben fichas.
 *
 * `FLAG_REQUIRES_CHANGE_REQUEST` se llamo `FLAG_LEGALLY_MATERIAL` hasta que
 * `dual_approval_for_sensitive_actions_enabled` -que NO es legalmente
 * material- paso a exigir el mismo camino. El nombre describe ahora la
 * CONSECUENCIA, que es lo que el frontend traduce, y no la clasificacion del
 * flag.
 *
 * Los dos ultimos son la respuesta al hallazgo 2 de la fase 1: hasta la
 * resolucion de HO-041, la modalidad decidia lo que pintaba la interfaz y no
 * quien podia escribir.
 */
const SECTION_13_ERROR_CODES: readonly string[] = [
  "AMOE_ENTRY_CAP_REACHED",
  "RULES_VERSION_NOT_ACTIVE",
  "RULES_CONFIG_INVALID",
  "SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN",
  "FLAG_REQUIRES_CHANGE_REQUEST",
  "AMOE_PARTICIPANT_INELIGIBLE_STAFF",
  "AMOE_MODE_NOT_ONLINE",
  "AMOE_MODE_NOT_MAIL_IN",
];

const manifest = readRouteManifest();
const manifestByRoute = new Map(
  manifest.map((route) => [`${route.method} ${normalizePath(route.path)}`, route]),
);

describe("seccion 13.11: la tabla de rutas es coherente con el catalogo", () => {
  it("las 21 rutas del contrato estan transcritas", () => {
    /*
     * Eran 18 en la tabla original de la seccion 13.11. La resolucion del Team
     * Lead a los hallazgos de la fase 1 las deja en 21: desaparece
     * `PATCH /admin/settings/amoe-mode` y entran las CUATRO de
     * `settings/change-requests`, que son el control dual con el que se cambia
     * un flag legalmente material.
     *
     * El numero se afirma a proposito: si alguien anade una ruta a la seccion y
     * no a esta tabla, el test de superficie de abajo no la vigilaria y nadie se
     * enteraria.
     */
    expect(SECTION_13_ROUTES).toHaveLength(21);
  });

  it("ninguna ruta exige un permiso que nadie puede conceder", () => {
    const unknown = CAPABILITY_ROUTES.filter((route) => !isCapabilityId(route.authorization)).map(
      (route) => `${describeRoute(route)} -> ${route.authorization}`,
    );

    expect(unknown, unknown.join("\n")).toStrictEqual([]);
  });

  it("ninguna ruta administrativa de la seccion es PUBLIC", () => {
    const offending = SECTION_13_ROUTES.filter(
      (route) => route.authorization === "PUBLIC" && route.path.includes("/admin"),
    ).map(describeRoute);

    expect(offending, offending.join("\n")).toStrictEqual([]);
  });

  it("la unica publica es el catalogo de categorias, y no lleva identificadores internos", () => {
    const publicRoutes = SECTION_13_ROUTES.filter((route) => route.authorization === "PUBLIC");
    expect(publicRoutes.map(describeRoute)).toStrictEqual(["GET /api/v1/product-categories"]);
  });
});

describe("seccion 13.11: matriz rol x ruta", () => {
  it("cada ruta tiene un veredicto para cada uno de los ocho roles", () => {
    const decisions: string[] = [];

    for (const route of CAPABILITY_ROUTES) {
      for (const role of ROLE_IDS) {
        const granted = hasCapability([role], route.authorization);
        const decision = authorize(contextFor([role], route.authorization));

        // La decision efectiva NUNCA puede ser mas amplia que la matriz.
        expect(
          decision.allowed,
          `${describeRoute(route)} | ${role}: autoriza sin tener la capacidad`,
        ).toBe(granted);

        decisions.push(`${describeRoute(route)} | ${role} | ${granted ? "ALLOW" : "DENY"}`);
      }
    }

    expect(decisions.length).toBe(CAPABILITY_ROUTES.length * ROLE_IDS.length);
  });

  it("sin la capacidad, la puerta deniega con CAPABILITY_NOT_GRANTED (403 FORBIDDEN)", () => {
    // Se recorren TODOS los roles que no tienen la capacidad, no uno de
    // ejemplo: probar con "un rol cualquiera" deja sin comprobar a los otros
    // seis, y deny-by-default es una afirmacion sobre todos ellos.
    for (const route of CAPABILITY_ROUTES) {
      const without = ROLE_IDS.filter((role) => !hasCapability([role], route.authorization));
      expect(
        without.length,
        `${describeRoute(route)}: TODOS los roles tienen ${route.authorization}`,
      ).toBeGreaterThan(0);

      for (const role of without) {
        const decision = authorize(contextFor([role], route.authorization));
        expect(decision.allowed, `${describeRoute(route)} | ${role}`).toBe(false);
        expect(decision.allowed ? null : decision.reason).toBe("CAPABILITY_NOT_GRANTED");
      }
    }
  });

  it("un actor sin ningun rol no alcanza ninguna de las 18", () => {
    for (const route of CAPABILITY_ROUTES) {
      expect(authorize(contextFor([], route.authorization)).allowed, describeRoute(route)).toBe(
        false,
      );
    }
  });

  it("un PARTICIPANT no alcanza ninguna: son todas de personal", () => {
    for (const route of CAPABILITY_ROUTES) {
      expect(hasCapability(["PARTICIPANT"], route.authorization), describeRoute(route)).toBe(false);
    }
  });

  it("SUPPORT no escribe nada de esta seccion", () => {
    // Atencion al participante ve la cola AMOE y el catalogo; no crea
    // categorias, no toca reglas, no cambia flags y no transcribe fichas.
    const writes = CAPABILITY_ROUTES.filter((route) => route.method !== "GET");
    for (const route of writes) {
      expect(hasCapability(["SUPPORT"], route.authorization), describeRoute(route)).toBe(false);
    }
  });

  it("DRAW_OFFICER y EXPORT_OFFICER tampoco escriben aqui", () => {
    // No es una omision: quien sortea o quien entrega el export no configura la
    // promocion sobre la que sortea. Es DEC-017 leido en esta seccion.
    const writes = CAPABILITY_ROUTES.filter((route) => route.method !== "GET");
    for (const route of writes) {
      for (const role of ["DRAW_OFFICER", "EXPORT_OFFICER"] as const) {
        expect(
          hasCapability([role], route.authorization),
          `${describeRoute(route)} | ${role}`,
        ).toBe(false);
      }
    }
  });

  it("solo COMPLIANCE_OFFICER activa una version de reglas y el atajo bonus", () => {
    const activations = CAPABILITY_ROUTES.filter(
      (route) => route.authorization === "rules.version.activate",
    );
    expect(activations.map(describeRoute)).toStrictEqual([
      "POST /api/v1/admin/promotions/{promotion_id}/rules-versions/{rules_version_id}/activate",
      "POST /api/v1/admin/promotions/{promotion_id}/bonus-periods",
    ]);

    const allowed = ROLE_IDS.filter((role) => hasCapability([role], "rules.version.activate"));
    expect(allowed).toStrictEqual(["COMPLIANCE_OFFICER"]);

    // PROMOTION_MANAGER redacta el borrador y NO lo activa. Es la separacion
    // que DEC-054 da por hecha al repartir las tres capacidades de reglas.
    expect(hasCapability(["PROMOTION_MANAGER"], "rules.version.create")).toBe(true);
    expect(hasCapability(["PROMOTION_MANAGER"], "rules.version.activate")).toBe(false);
  });

  it("solo SECURITY_ADMIN cambia un flag ordinario y solo COMPLIANCE_OFFICER uno material", () => {
    expect(ROLE_IDS.filter((role) => hasCapability([role], "flag.update"))).toStrictEqual([
      "SECURITY_ADMIN",
    ]);
    expect(
      ROLE_IDS.filter((role) => hasCapability([role], "flag.update.legally_material")),
    ).toStrictEqual(["COMPLIANCE_OFFICER"]);
  });

  it("transcriben ficha postal PROMOTION_MANAGER y COMPLIANCE_OFFICER, y nadie mas", () => {
    expect(
      ROLE_IDS.filter((role) => hasCapability([role], "amoe.submission.transcribe")),
    ).toStrictEqual(["PROMOTION_MANAGER", "COMPLIANCE_OFFICER"]);
  });
});

describe("seccion 13.11: motivo obligatorio", () => {
  /**
   * Que rutas exigen motivo lo dice el CATALOGO, no la ruta. Aqui se comprueban
   * las dos direcciones: que las que el contrato marca con motivo lo exigen de
   * verdad, y que las que no, no lo exigen (un motivo obligatorio de mas
   * convertiria una pantalla en un formulario que nadie rellena de verdad).
   */
  const REASON_REQUIRED: readonly CapabilityId[] = [
    "rules.version.activate",
    "flag.update",
    "flag.update.legally_material",
  ];

  const REASON_OPTIONAL: readonly CapabilityId[] = [
    "product.read",
    "product.write",
    "rules.version.read",
    "rules.version.create",
    "flag.read",
    "amoe.submission.transcribe",
  ];

  it("las capacidades marcadas con motivo lo declaran en el catalogo", () => {
    for (const capability of REASON_REQUIRED) {
      expect(getCapability(capability).requiresReason, capability).toBe(true);
    }
  });

  it("las demas no lo exigen", () => {
    for (const capability of REASON_OPTIONAL) {
      expect(getCapability(capability).requiresReason, capability).toBe(false);
    }
  });

  it("sin motivo se deniega en la PUERTA: 403, no 422", () => {
    /*
     * La distincion importa y es facil de perder. Un 422 significa "el cuerpo
     * esta mal formado" y lo produce el esquema de la ruta; un 403 significa
     * "no estas autorizado a hacer esto asi". El motivo lo exige el catalogo de
     * autorizacion, se evalua en el `preHandler` y por tanto ANTES de que el
     * cuerpo llegue al esquema: `authorize()` responde `REASON_REQUIRED`, y
     * `route-registry.ts` lo traduce a `ApiErrors.forbidden` (403).
     *
     * Si algun dia una de estas rutas devolviera 422 por falta de motivo,
     * significaria que la comprobacion se movio al esquema del cuerpo, y con
     * ella se habria perdido la garantia de que NINGUNA ruta con motivo
     * obligatorio puede ejecutarse sin uno.
     */
    for (const capability of REASON_REQUIRED) {
      const holders = ROLE_IDS.filter((candidate) => hasCapability([candidate], capability));
      expect(holders.length, `nadie tiene ${capability}`).toBeGreaterThan(0);

      for (const role of holders) {
        const decision = authorize(contextFor([role], capability, { reasonProvided: false }));
        expect(decision.allowed, `${capability} | ${role}`).toBe(false);
        expect(decision.allowed ? null : decision.reason).toBe("REASON_REQUIRED");
      }
    }
  });

  it("la transcripcion de una ficha NO se bloquea por falta de motivo", () => {
    // Seccion 13.10: `X-LSW-Reason-Code` es OPCIONAL. Meter una ficha en la cola
    // no es una correccion del ledger; lo que si exige motivo es aprobarla.
    const decision = authorize(
      contextFor(["PROMOTION_MANAGER"], "amoe.submission.transcribe", { reasonProvided: false }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("seccion 13.11: step-up", () => {
  /** Lo que la tabla del contrato marca con step-up. */
  const STEP_UP_REQUIRED: readonly CapabilityId[] = [
    "rules.version.activate",
    "flag.update.legally_material",
  ];

  /** Y lo que NO, aunque escriba. */
  const STEP_UP_NOT_REQUIRED: readonly CapabilityId[] = [
    "product.write",
    "rules.version.create",
    "flag.update",
    "amoe.submission.transcribe",
  ];

  it("el catalogo declara step-up exactamente donde lo dice el contrato", () => {
    for (const capability of STEP_UP_REQUIRED) {
      expect(getCapability(capability).requiresStepUp, capability).toBe(true);
      expect(getCapability(capability).requiresReason, capability).toBe(true);
    }
    for (const capability of STEP_UP_NOT_REQUIRED) {
      expect(getCapability(capability).requiresStepUp, capability).toBe(false);
    }
  });

  it("sin MFA reciente, la puerta responde STEP_UP_REQUIRED (403 con ese codigo)", () => {
    for (const capability of STEP_UP_REQUIRED) {
      const holders = ROLE_IDS.filter((candidate) => hasCapability([candidate], capability));
      expect(holders.length, `nadie tiene ${capability}`).toBeGreaterThan(0);

      for (const role of holders) {
        const decision = authorize(contextFor([role], capability, { secondsSinceLastMfa: null }));
        expect(decision.allowed, `${capability} | ${role}`).toBe(false);
        expect(decision.allowed ? null : decision.reason).toBe("STEP_UP_REQUIRED");
      }
    }
  });

  it("un MFA caducado tampoco vale, y el tope duro no se puede ampliar por configuracion", () => {
    const decision = authorize(
      contextFor(["COMPLIANCE_OFFICER"], "rules.version.activate", {
        stepUpMaxAgeSeconds: 86_400,
        secondsSinceLastMfa: 3_600,
      }),
    );
    expect(decision.allowed ? null : decision.reason).toBe("STEP_UP_REQUIRED");
  });

  it("la traduccion a HTTP la hace route-registry y sigue siendo 403", () => {
    /*
     * Se comprueba sobre las FUENTES de `apps/api` y no de memoria: el codigo
     * que devuelve la puerta es parte del contrato de seguridad -es lo que
     * distingue "te falta MFA" de "no puedes"- y cambiarlo sin darse cuenta es
     * facil, porque los dos son 403.
     */
    const registry = readRepoFile("apps/api/src/http/route-registry.ts");
    expect(registry).toContain("ApiErrors.stepUpRequired");
    expect(registry).toContain("ApiErrors.forbidden");

    const errors = readRepoFile("apps/api/src/http/errors.ts");
    expect(errors).toMatch(/statusCode:\s*403,\s*code:\s*"FORBIDDEN"/u);
    expect(errors).toMatch(/statusCode:\s*403,\s*code:\s*"STEP_UP_REQUIRED"/u);
  });
});

describe("seccion 13.9: la capacidad de un PATCH de flag se DERIVA de la clave", () => {
  it("capabilityForFlagUpdate cubre las doce claves del catalogo", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const capability = capabilityForFlagUpdate(key);
      expect(isCapabilityId(capability), key).toBe(true);
      expect(capability, key).toBe(
        flagRequiresDualControl(key) ? "flag.update.legally_material" : "flag.update",
      );
    }
  });

  it("la derivacion NO es `legallyMaterial` a secas: una clave no legal exige control dual", () => {
    /*
     * La diferencia entre las dos listas, escrita como prueba para que no se
     * pierda (HO-041, hallazgo S-02).
     *
     * `dual_approval_for_sensitive_actions_enabled` no cambia ninguna promesa
     * hecha al participante -no es materia legal- y aun asi exige control dual,
     * porque es el interruptor que APAGA el control dual de todo lo demas. Si
     * alguien "simplifica" la derivacion volviendo a `legallyMaterial`, esto
     * falla, que es justo cuando hay que discutirlo.
     */
    const key = "dual_approval_for_sensitive_actions_enabled";
    expect(FEATURE_FLAGS[key].legallyMaterial).toBe(false);
    expect(flagRequiresDualControl(key)).toBe(true);
    expect(capabilityForFlagUpdate(key)).toBe("flag.update.legally_material");

    // La lista derivada son las nueve legales MAS esa, y ninguna otra.
    expect([...DUAL_CONTROL_FLAG_KEYS].sort()).toStrictEqual(
      [...LEGALLY_MATERIAL_FLAG_KEYS, key].sort(),
    );
  });

  it("un flag legalmente material exige la capacidad fuerte Y step-up", () => {
    // El caso concreto que pide HO-041: `PATCH /admin/feature-flags/amoe_enabled`
    // no puede resolverse con `flag.update`.
    const capability = capabilityForFlagUpdate("amoe_enabled");
    expect(capability).toBe("flag.update.legally_material");
    expect(getCapability(capability).requiresStepUp).toBe(true);
    expect(getCapability(capability).requiresReason).toBe(true);

    // Y quien solo tiene `flag.update` no llega: SECURITY_ADMIN no puede
    // encender la via gratuita.
    expect(hasCapability(["SECURITY_ADMIN"], capability)).toBe(false);
    expect(authorize(contextFor(["SECURITY_ADMIN"], capability)).allowed).toBe(false);
  });

  it("un flag no material va por la capacidad debil y sin step-up", () => {
    const capability = capabilityForFlagUpdate("manual_adjustments_enabled");
    expect(capability).toBe("flag.update");
    expect(getCapability(capability).requiresStepUp).toBe(false);
    // El motivo SIGUE siendo obligatorio: el cambio queda en `audit_events`.
    expect(getCapability(capability).requiresReason).toBe(true);
  });

  it("solo DOS de las doce claves se cambian con un interruptor, y estan nombradas", () => {
    /*
     * Escrito con nombre y apellidos para que anadir un flag obligue a decidir
     * por que camino va, en vez de heredar el de al lado.
     *
     * Eran tres hasta HO-041. `dual_approval_for_sensitive_actions_enabled`
     * sale de esta lista: apagarlo desarmaba el control dual de los otros
     * nueve, y un control que se apaga con un interruptor no es un control.
     */
    const ordinary = FEATURE_FLAG_KEYS.filter(
      (key) => capabilityForFlagUpdate(key) === "flag.update",
    );
    expect([...ordinary].sort()).toStrictEqual([
      "manual_adjustments_enabled",
      "provisional_entries_enabled",
    ]);
  });

  it("la modalidad AMOE ya no tiene ruta propia: va por la cola de solicitudes", () => {
    /*
     * `PATCH /admin/settings/amoe-mode` DESAPARECE del contrato (resolucion
     * HO-041). No es una limpieza: esa ruta exigia
     * `flag.update.legally_material`, que declara segunda aprobacion, y ninguna
     * ruta de un solo paso puede satisfacerla. Cambiar la modalidad AMOE es
     * ahora una solicitud (`setting_kind: "AMOE_MODE"`) que aprueba otra
     * persona.
     *
     * Se afirma su AUSENCIA a proposito: si reapareciera, volveria el 403
     * permanente del hallazgo 1.
     */
    const revived = SECTION_13_ROUTES.filter((candidate) =>
      candidate.path.endsWith("/admin/settings/amoe-mode"),
    );
    expect(revived).toStrictEqual([]);
  });
});

describe("resolucion HO-041: control dual para lo legalmente material", () => {
  it("`flag.update.legally_material` SIGUE exigiendo segunda aprobacion", () => {
    /*
     * Este es el test que impide que el hallazgo 1 se "resuelva" por el camino
     * facil. La alternativa a construir el control dual era quitarle
     * `requiresSecondApproval` a la capacidad, y eso habria dejado el cambio de
     * un flag legalmente material -encender la via gratuita, publicar un
     * ganador, habilitar el sorteo interno- en manos de una sola persona.
     *
     * Si alguien lo baja, esto falla y hay que discutirlo, que es el momento
     * correcto para discutirlo.
     */
    const definition = getCapability("flag.update.legally_material");
    expect(definition.requiresSecondApproval).toBe(true);
    expect(definition.requiresStepUp).toBe(true);
    expect(definition.requiresReason).toBe(true);
    expect(definition.sensitivity).toBe("CRITICAL");
  });

  it("sin segunda aprobacion viva, la puerta deniega las tres rutas de solicitud", () => {
    // Es exactamente lo que hacia inalcanzable a `PATCH /admin/settings/amoe-mode`.
    // La diferencia no es la capacidad: es que ahora la ruta puede declarar
    // DONDE se impone la segunda aprobacion, porque hay un recurso concreto
    // -la solicitud- sobre el que preguntarlo.
    const routes = SECTION_13_ROUTES.filter(
      (route) => route.authorization === "flag.update.legally_material",
    );
    expect(routes).toHaveLength(3);

    for (const route of routes) {
      const decision = authorize(
        contextFor(["COMPLIANCE_OFFICER"], "flag.update.legally_material", {
          secondApprovalGranted: false,
        }),
      );
      expect(decision.allowed, describeRoute(route)).toBe(false);
      expect(decision.allowed ? null : decision.reason).toBe("SECOND_APPROVAL_REQUIRED");
    }
  });

  it("`PATCH /admin/feature-flags/:key` es alcanzable porque su capacidad NO exige segunda aprobacion", () => {
    /*
     * La otra mitad del reparto. `flag.update` no declara segunda aprobacion,
     * asi que la ruta de un solo paso funciona... y por eso tiene que quedarse
     * SOLO con los flags no materiales. Lo que impide que sirva para uno
     * material no es la puerta -la capacidad es estatica- sino el 409 que
     * devuelve el handler cuando `capabilityForFlagUpdate(key)` dice otra cosa.
     */
    expect(getCapability("flag.update").requiresSecondApproval).toBe(false);
    expect(authorize(contextFor(["SECURITY_ADMIN"], "flag.update")).allowed).toBe(true);
  });

  it("un flag material se rechaza con 409, no con 403: son cosas distintas", () => {
    /*
     * POR QUE IMPORTA EL CODIGO.
     *
     * 403 significa "tu no puedes". 409 significa "por aqui no se hace". Quien
     * tiene `flag.update` -SECURITY_ADMIN- SI puede cambiar flags; lo que no
     * puede es cambiar ESTE por ESTA ruta. Devolver 403 haria pensar en un
     * permiso mal configurado y el atajo evidente seria ensanchar el rol, que
     * es como se degrada una matriz de permisos (el mecanismo de HO-013).
     *
     * Aqui se comprueba lo unico comprobable sin base de datos: que la
     * derivacion dice que la clave es material, que es el hecho del que el
     * handler tiene que sacar el 409. El 409 en si lo comprueba el e2e.
     */
    const guardedKeys = FEATURE_FLAG_KEYS.filter(
      (key) => capabilityForFlagUpdate(key) === "flag.update.legally_material",
    );
    expect(guardedKeys.length).toBeGreaterThan(0);

    // Se comprueba contra `flagRequiresDualControl` y NO contra
    // `legallyMaterial`: desde HO-041 la lista incluye una clave que no es
    // legal (ver la prueba de la seccion 13.9), y afirmar lo contrario aqui
    // ataria el 409 a la pregunta equivocada.
    for (const key of guardedKeys) {
      expect(flagRequiresDualControl(key), key).toBe(true);
    }

    const flagPatch = SECTION_13_ROUTES.find(
      (route) => route.path === "/api/v1/admin/feature-flags/{key}",
    );
    expect(flagPatch?.authorization).toBe("flag.update");
    expect(flagPatch?.method).toBe("PATCH");
  });

  it("la cola de solicitudes se LEE con `flag.read`, no con la capacidad de escritura", () => {
    // Cobertura de lectura (HO-013) aplicada a la superficie nueva: quien
    // aprueba tiene que poder ver la cola, y quien solo mira no necesita poder
    // cambiar nada. `flag.read` la tienen los cinco roles de personal que ven
    // el panel; la aprobacion sigue siendo de COMPLIANCE_OFFICER.
    const listing = SECTION_13_ROUTES.find(
      (route) => route.method === "GET" && route.path === "/api/v1/admin/settings/change-requests",
    );
    expect(listing?.authorization).toBe("flag.read");
    expect(hasCapability(["COMPLIANCE_OFFICER"], "flag.read")).toBe(true);
    expect(hasCapability(["SECURITY_ADMIN"], "flag.read")).toBe(true);
  });

  it("la ruta de solicitud declara DONDE se impone la segunda aprobacion", () => {
    /*
     * `secondApprovalEnforcedBy` es una CADENA y no un booleano justamente para
     * esto: se puede comprobar leyendo el sitio que nombra, y un `grep` enumera
     * en un segundo todas las rutas que difieren la comprobacion. Sin la
     * declaracion, la puerta deniega y la ruta responde 403 para siempre.
     *
     * FALLA hasta que `backend` escriba la ruta (resolucion HO-041).
     */
    const declaring = listRepoTextFiles(join(repoRoot(), "apps/api/src"))
      .filter((file) => /\.(ts|tsx|mts|cts)$/u.test(file.path))
      .map((file) => readRepoFile(file.path))
      .filter((source) => source.includes("/admin/settings/change-requests"));

    expect(
      declaring.length,
      "Ninguna fuente de apps/api declara la ruta /admin/settings/change-requests.",
    ).toBeGreaterThan(0);

    expect(
      declaring.some((source) => source.includes("secondApprovalEnforcedBy")),
      "La ruta de solicitudes de cambio existe pero no declara `secondApprovalEnforcedBy`: " +
        "sin esa declaracion, `authorize()` deniega la capacidad en la puerta y la ruta " +
        "responde 403 siempre (es lo que le paso a entry.adjust.create en HO-034.1).",
    ).toBe(true);
  });
});

describe("seccion 13.10: quien transcribe no aprueba", () => {
  it("NO existe un par de separacion de funciones para la transcripcion", () => {
    /*
     * DEC-054 lo dice por ENVIO, no por rol, y la diferencia es la razon de
     * este test.
     *
     * `authorize()` deniega LAS DOS capacidades de un par a quien acumula las
     * dos. Si "transcribir" y "aprobar" fueran un par del catalogo, el
     * COMPLIANCE_OFFICER -que tiene las dos- se quedaria sin ninguna: no podria
     * transcribir NI aprobar ninguna ficha, ni siquiera una que tecleara otra
     * persona. El control correcto compara
     * `metadata.transcribed_by_admin_user_id` con el aprobador, envio a envio.
     */
    const pairs = SEPARATION_OF_DUTIES.filter((constraint) =>
      constraint.capabilities.includes("amoe.submission.transcribe"),
    );
    expect(pairs.map((constraint) => constraint.id)).toStrictEqual([]);
  });

  it("por eso COMPLIANCE_OFFICER conserva las dos capacidades a la vez", () => {
    expect(hasCapability(["COMPLIANCE_OFFICER"], "amoe.submission.transcribe")).toBe(true);
    expect(hasCapability(["COMPLIANCE_OFFICER"], "amoe.review.approve")).toBe(true);
    expect(authorize(contextFor(["COMPLIANCE_OFFICER"], "amoe.review.approve")).allowed).toBe(true);
    expect(
      authorize(contextFor(["COMPLIANCE_OFFICER"], "amoe.submission.transcribe")).allowed,
    ).toBe(true);
  });

  it("el 409 SEPARATION_OF_DUTIES existe como error de la API", () => {
    /*
     * El control que sustituye al par del catalogo tiene que existir en algun
     * sitio, y ese sitio es el dominio. Lo unico que este paquete puede
     * comprobar sin base de datos es que el codigo de error esta declarado: sin
     * el, la ruta no tendria con que negarse y la separacion seria una frase
     * del contrato.
     *
     * FALLA hasta que `backend` lo anada a `http/errors.ts` (HO-041).
     */
    const errors = readRepoFile("apps/api/src/http/errors.ts");
    expect(
      errors.includes("SEPARATION_OF_DUTIES"),
      "apps/api/src/http/errors.ts no declara SEPARATION_OF_DUTIES: la seccion 13.10 " +
        "exige 409 cuando el aprobador es quien transcribio.",
    ).toBe(true);
  });

  it("los siete errores restantes de la seccion 13 tambien estan declarados", () => {
    /*
     * LA LISTA COMPLETA, y cada uno responde a una pregunta distinta. Un solo
     * codigo generico para todos -un 409 CONFLICT a secas- haria indistinguible
     * "esta persona no puede aprobar esto" de "por esta ruta no se cambia esa
     * clave", y el panel no podria explicar ninguna de las dos.
     *
     *   AMOE_ENTRY_CAP_REACHED ............ 13.3: no queda hueco bajo el tope.
     *   RULES_VERSION_NOT_ACTIVE .......... 13.8: no hay version que clonar.
     *   RULES_CONFIG_INVALID .............. 13.7: la config no parsea.
     *   SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN  resolucion HO-041: quien
     *                                       solicita no aprueba.
     *   FLAG_LEGALLY_MATERIAL ............. resolucion HO-041: esta clave va
     *                                       por la cola de solicitudes.
     *   AMOE_MODE_NOT_ONLINE .............. resolucion HO-041: con AMOE postal,
     *                                       el envio en linea se rechaza.
     *   AMOE_MODE_NOT_MAIL_IN ............. resolucion HO-041: sin AMOE postal,
     *                                       no se transcriben fichas.
     *
     * Los dos ultimos son la respuesta al hallazgo 2 de la fase 1: hasta ahora
     * la modalidad decidia lo que pintaba la interfaz y no quien podia escribir.
     *
     * FALLA hasta que `backend` los anada a `http/errors.ts`.
     */
    const sources = listRepoTextFiles(join(repoRoot(), "apps/api/src"))
      .filter((file) => /\.(ts|tsx|mts|cts)$/u.test(file.path))
      .map((file) => readRepoFile(file.path))
      .join("\n");

    const missing = SECTION_13_ERROR_CODES.filter((code) => !sources.includes(`"${code}"`));

    expect(
      missing,
      `codigos de error de la seccion 13 que la API no puede devolver: ${missing.join(", ")}`,
    ).toStrictEqual([]);
  });

  it("los codigos de error viven en el catalogo, no repartidos por las rutas", () => {
    /*
     * POR QUE ESTO ES UNA PRUEBA APARTE, Y MAS DEBIL QUE LA DE ARRIBA
     *
     *   La de arriba comprueba el HECHO: la API puede negarse con ese codigo.
     *   Esta comprueba la CONVENCION: que el codigo esta declarado en
     *   `http/errors.ts`, que es el catalogo de errores de la API igual que
     *   `capabilities.ts` lo es de los permisos.
     *
     *   No es cosmetica. Un codigo construido con `new ApiError({ code: "..." })`
     *   dentro de un handler es una cadena suelta: una errata no la detecta
     *   nadie -no hay tipo que la contradiga-, el catalogo deja de enumerar lo
     *   que la API puede responder, y el frontend, que traduce por codigo, se
     *   queda esperando un mensaje que nunca llega con ese nombre.
     *
     *   Se mantiene separada para que su fallo no se confunda con "el control
     *   no existe": el control existe, y lo que falta es ponerlo donde se
     *   pueda enumerar.
     */
    const catalog = readRepoFile(API_ERRORS_PATH);
    const scattered = SECTION_13_ERROR_CODES.filter((code) => !catalog.includes(`"${code}"`));

    expect(
      scattered,
      `Codigos de la seccion 13 que NO estan en ${API_ERRORS_PATH} y viven sueltos en ` +
        `una ruta:\n${scattered.join("\n")}\n\n` +
        "Declararlos como fabrica en `ApiErrors` deja el catalogo completo y hace que " +
        "una errata deje de compilar en vez de devolver un codigo que nadie traduce.",
    ).toStrictEqual([]);
  });
});

describe("seccion 13.11: la superficie real coincide con el contrato", () => {
  /*
   * ESTE BLOQUE FALLA HASTA QUE `backend` PUBLIQUE LAS RUTAS, y esta escrito
   * para que falle diciendo exactamente que falta. No se marca `skip`: la
   * suite tiene que poder responder "estas 21 rutas todavia no existen", no
   * quedarse callada.
   */
  it("el manifiesto declara las 21 rutas de la seccion", () => {
    const missing = SECTION_13_ROUTES.filter(
      (route) => !manifestByRoute.has(`${route.method} ${normalizePath(route.path)}`),
    ).map((route) => `${describeRoute(route)} (${route.note})`);

    expect(
      missing,
      "Rutas de la seccion 13.11 ausentes de apps/api/openapi/route-manifest.json:\n" +
        missing.join("\n") +
        "\n\nSe regenera con `pnpm --filter @lsw/api run contract:emit`.",
    ).toStrictEqual([]);
  });

  it("cada ruta publicada exige la capacidad que dice el contrato", () => {
    const mismatched: string[] = [];

    for (const route of SECTION_13_ROUTES) {
      const published = manifestByRoute.get(`${route.method} ${normalizePath(route.path)}`);
      if (published === undefined) {
        continue; // Lo reporta el test de arriba; aqui no se cuenta dos veces.
      }
      if (published.authorization !== route.authorization) {
        mismatched.push(
          `${describeRoute(route)}: contrato ${route.authorization}, codigo ${published.authorization}`,
        );
      }
    }

    expect(mismatched, mismatched.join("\n")).toStrictEqual([]);
  });

  it("cada ruta publicada declara el step-up que declara el catalogo", () => {
    const mismatched: string[] = [];

    for (const route of CAPABILITY_ROUTES) {
      const published = manifestByRoute.get(`${route.method} ${normalizePath(route.path)}`);
      if (published === undefined) {
        continue;
      }
      const expected = getCapability(route.authorization).requiresStepUp;
      if (published.requires_step_up !== expected) {
        mismatched.push(
          `${describeRoute(route)}: catalogo ${String(expected)}, manifiesto ${String(published.requires_step_up)}`,
        );
      }
    }

    expect(mismatched, mismatched.join("\n")).toStrictEqual([]);
  });

  it("el contrato documenta las 21 rutas por su metodo y camino", () => {
    // La otra direccion de `api-contract.test.ts`: alli se comprueba que nada
    // implementado quede sin documentar; aqui, que lo acordado en HO-041 siga
    // escrito en el documento y no se haya perdido en una edicion.
    const contractPath = "docs/API_CONTRACT.md";
    expect(repoPathExists(contractPath)).toBe(true);

    /*
     * Se normalizan LOS DOS lados con la misma funcion, igual que hace
     * `api-contract.test.ts`. Normalizar solo el documento fue el primer
     * intento y fallaba en `{variant_id}`: la limpieza de adornos de markdown
     * convierte el guion bajo en espacio, asi que la ruta buscada tiene que
     * pasar por la misma transformacion o nunca coincide.
     */
    const normalize = (text: string): string =>
      text
        .replace(/[`*_|]/gu, " ")
        .replace(/\s+/gu, " ")
        .toUpperCase();

    const normalized = normalize(readRepoFile(contractPath));

    const undocumented = SECTION_13_ROUTES.filter(
      (route) => !normalized.includes(normalize(`${route.method} ${route.path}`)),
    ).map(describeRoute);

    expect(undocumented, undocumented.join("\n")).toStrictEqual([]);
  });
});
