/**
 * Registro central de rutas, deny-by-default (DEC-015).
 *
 * DEC-015 dice, literalmente: "Toda ruta declara su permiso en un registro
 * central deny-by-default; una ruta sin permiso declarado NO ARRANCA."
 *
 * Este modulo cumple esa frase de tres formas que se refuerzan entre si:
 *
 *   1. TIPOS. `authorization` es un campo obligatorio de `RouteDefinition` y
 *      su tipo es una union discriminada. Olvidarlo no compila.
 *
 *   2. VALIDACION AL REGISTRAR. `assertRouteIsAuthorized` comprueba en tiempo
 *      de ejecucion que la declaracion es coherente: que el permiso existe en
 *      el catalogo de la base de datos, y que una ruta publica explica POR QUE
 *      lo es. Una justificacion obligatoria convierte "publica por descuido"
 *      en algo que hay que escribir a mano y que se lee en la revision.
 *
 *   3. GUARDIA DE ARRANQUE. `installRouteGuard` instala un hook `onRoute` que
 *      revisa TODA ruta que se anada a la instancia de Fastify, venga de donde
 *      venga. Si un plugin -propio o de terceros- registra una ruta sin pasar
 *      por este registro, el proceso no arranca.
 *
 *   El punto 3 es el que hace que esto sea deny-by-default de verdad. Sin el,
 *   bastaria con un `app.get(...)` suelto para saltarse el sistema entero, y
 *   nadie se enteraria hasta la auditoria.
 *
 * Ademas, este mismo registro es la unica fuente de la que sale el documento
 * OpenAPI (DEC-014) y el manifiesto que `security` compara contra
 * `docs/API_CONTRACT.md`. Una sola declaracion produce el comportamiento, la
 * documentacion y la evidencia.
 */

import { getPermission, isPermissionKey, type PermissionKey } from "./permission-catalog.js";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
  RouteOptions,
  preHandlerAsyncHookHandler,
} from "fastify";
import type { ZodType } from "zod";

import { ApiErrors } from "./errors.js";

/**
 * Como se autoriza una ruta. Union discriminada a proposito: no existe un
 * valor "por defecto" ni un `undefined` que pueda colarse.
 */
export type RouteAuthorization =
  | {
      readonly kind: "PUBLIC";
      /**
       * Obligatoria. Una ruta publica es una decision de seguridad, y toda
       * decision de seguridad debe poder leerse junto al codigo que la toma.
       */
      readonly justification: string;
    }
  | {
      readonly kind: "PARTICIPANT";
      /**
       * `true` cuando la ruta solo devuelve recursos del propio participante
       * autenticado. Lo comprueba el handler; declararlo aqui permite a
       * `security` auditar la superficie sin leer cada handler.
       */
      readonly selfOnly: boolean;
    }
  | {
      readonly kind: "PERMISSION";
      readonly permission: PermissionKey;
      /**
       * Solo para capacidades con `requiresSecondApproval`. Nombra DONDE el
       * dominio comprueba la segunda aprobacion, y su presencia le dice al
       * autorizador que no la decida el.
       *
       * POR QUE LA PUERTA NO PUEDE DECIDIR ESTO
       *   Una segunda aprobacion es un hecho sobre un RECURSO CONCRETO: existe,
       *   la dio un actor distinto y sigue dentro de su TTL. El autorizador
       *   corre antes del handler y solo conoce (metodo, camino, sesion); no
       *   sabe sobre que ajuste ni sobre que sorteo se pregunta, asi que no
       *   puede comprobarlo sin adivinar. `packages/tpa/src/ports.ts` ya lo
       *   dice explicitamente: el catalogo aporta la REGLA y el dominio calcula
       *   el HECHO.
       *
       * POR QUE ES UNA CADENA Y NO UN BOOLEANO
       *   Un `true` suelto seria una forma corta de apagar un control. Al
       *   exigir el nombre del sitio que lo impone, la declaracion se puede
       *   comprobar leyendo ese sitio, y un `grep` enumera en un segundo todas
       *   las rutas que difieren la comprobacion. Un booleano no se puede
       *   auditar; una referencia si.
       *
       * Sin este campo, una capacidad con `requiresSecondApproval` se deniega
       * en la puerta. Fallar en cerrado es lo correcto: es preferible un 403 en
       * una ruta que aun no tiene su comprobacion a un 200 que la finge.
       */
      readonly secondApprovalEnforcedBy?: string;
    };

export interface RouteSchemas {
  readonly params?: ZodType;
  readonly querystring?: ZodType;
  readonly body?: ZodType;
  /** Al menos una respuesta declarada: sin ella el contrato de DEC-014 esta incompleto. */
  readonly response: Readonly<Record<number, ZodType>>;
}

export interface RouteDefinition {
  readonly method: HTTPMethods;
  /** Ruta completa, incluyendo el prefijo de version (`/api/v1/...`). */
  readonly url: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly authorization: RouteAuthorization;
  readonly schema: RouteSchemas;
  /**
   * Devuelve el cuerpo de la respuesta; el serializador Zod se encarga del
   * resto. El tipo es `unknown` a secas -no `Promise<unknown> | unknown`-
   * porque `unknown` ya incluye las promesas: enumerarlas aparte no anadia
   * informacion y hacia que la union no dijese nada.
   */
  readonly handler: (request: FastifyRequest, reply: FastifyReply) => unknown;
}

/** Clave con la que la definicion viaja dentro de `routeOptions.config`. */
const ROUTE_CONFIG_KEY = "lswRoute";

export interface LswRouteConfig {
  readonly [ROUTE_CONFIG_KEY]: RouteDefinition;
}

export class RouteRegistrationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RouteRegistrationError";
  }
}

/**
 * Rutas que el framework genera por su cuenta y que no pasan por el registro.
 *
 * La lista es CERRADA y deliberadamente corta. Cada entrada es una excepcion a
 * DEC-015, asi que tiene que poder justificarse por escrito:
 *
 *   1. `HEAD`, que Fastify deriva automaticamente de cada `GET` y que hereda su
 *      misma configuracion -incluido el `preHandler` de autorizacion-.
 *
 *   2. El `OPTIONS *` que registra `@fastify/cors` para responder al preflight.
 *      No devuelve datos: responde con las cabeceras CORS y termina. Sin esta
 *      excepcion el proceso no arranca, que es exactamente lo que pasaba: la
 *      guardia abortaba el registro del plugin y `createApp` se quedaba
 *      colgado hasta el timeout de avvio. Se acota al comodin `*`: cualquier
 *      otro `OPTIONS` sobre una ruta concreta si tiene que declarar permiso.
 */
function isFrameworkGeneratedRoute(routeOptions: RouteOptions): boolean {
  const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
  if (methods.length !== 1) {
    return false;
  }

  if (methods[0] === "HEAD") {
    return true;
  }

  return methods[0] === "OPTIONS" && routeOptions.url === "*";
}

export function assertRouteIsAuthorized(definition: RouteDefinition): void {
  const where = `${String(definition.method)} ${definition.url}`;

  if (!definition.url.startsWith("/")) {
    throw new RouteRegistrationError(`Ruta ${where}: la url debe ser absoluta.`);
  }

  if (definition.operationId.trim() === "") {
    throw new RouteRegistrationError(
      `Ruta ${where}: falta operationId (DEC-014 lo necesita para el spec).`,
    );
  }

  if (Object.keys(definition.schema.response).length === 0) {
    throw new RouteRegistrationError(
      `Ruta ${where}: no declara ninguna respuesta. Sin respuesta declarada el contrato de DEC-014 queda incompleto.`,
    );
  }

  const authorization: RouteAuthorization | undefined = definition.authorization;

  if (authorization === undefined) {
    throw new RouteRegistrationError(
      `DEC-015: la ruta ${where} no declara autorizacion. Deny-by-default: el proceso no arranca.`,
    );
  }

  switch (authorization.kind) {
    case "PUBLIC": {
      if (authorization.justification.trim().length < 10) {
        throw new RouteRegistrationError(
          `DEC-015: la ruta publica ${where} debe justificar por escrito por que es publica.`,
        );
      }
      return;
    }
    case "PARTICIPANT": {
      return;
    }
    case "PERMISSION": {
      // Se ensancha a `string` a proposito. Para el compilador la comprobacion
      // es redundante -el campo ya es `PermissionKey`-, pero esta validacion
      // existe justamente para el caso en que el tipo no se haya podido
      // aplicar: una definicion construida en un test, cargada de un JSON o
      // llegada de un paquete compilado con otra version del catalogo. Un
      // control que solo funciona cuando los tipos son correctos no es un
      // control.
      const declared: string = authorization.permission;
      if (!isPermissionKey(declared)) {
        throw new RouteRegistrationError(
          `DEC-015: la ruta ${where} exige el permiso "${declared}", que no existe en el catalogo ` +
            "de autorizacion (DEC-027: packages/security, sembrado por packages/database). " +
            "Un permiso inventado es un permiso que nadie puede conceder ni auditar.",
        );
      }
      return;
    }
    default: {
      const exhaustive: never = authorization;
      throw new RouteRegistrationError(
        `Ruta ${where}: autorizacion desconocida ${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

/** Resultado de la comprobacion de autorizacion de una peticion concreta. */
export type AuthorizationOutcome =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "UNAUTHENTICATED" | "FORBIDDEN" | "STEP_UP_REQUIRED";
    };

export interface AuthorizationRequest {
  readonly request: FastifyRequest;
  readonly authorization: RouteAuthorization;
  /** `true` si el permiso exigido requiere step-up (DEC-006). */
  readonly requiresStepUp: boolean;
}

export type Authorizer = (
  input: AuthorizationRequest,
) => Promise<AuthorizationOutcome> | AuthorizationOutcome;

/**
 * Autorizador por defecto del hito B0.
 *
 * DEC-006 asigna la identidad y la sesion a `packages/security`, que todavia
 * no existe. Hasta entonces el comportamiento correcto no es "dejar pasar
 * mientras tanto": es DENEGAR todo lo que no sea explicitamente publico.
 *
 * Un stub permisivo tiene la costumbre de sobrevivir al despliegue.
 */
export const denyAllAuthorizer: Authorizer = ({ authorization }) => {
  if (authorization.kind === "PUBLIC") {
    return { allowed: true };
  }
  return { allowed: false, reason: "UNAUTHENTICATED" };
};

function buildAuthorizationPreHandler(): preHandlerAsyncHookHandler {
  return async function authorizationPreHandler(request, _reply) {
    const config = request.routeOptions.config as Partial<LswRouteConfig> | undefined;
    const definition = config?.[ROUTE_CONFIG_KEY];

    if (definition === undefined) {
      // Defensa en profundidad: no deberia poder llegar aqui, porque el hook
      // `onRoute` habria impedido el arranque. Si aun asi llega, se deniega.
      request.log.error(
        { event: "route.authorization.missing_definition" },
        "ruta sin definicion de autorizacion",
      );
      throw ApiErrors.internal();
    }

    const { authorization } = definition;
    const requiresStepUp =
      authorization.kind === "PERMISSION"
        ? getPermission(authorization.permission).requiresStepUp
        : false;

    const outcome = await request.server.lswAuthorizer({ request, authorization, requiresStepUp });

    if (outcome.allowed) {
      return;
    }

    const permissionName =
      authorization.kind === "PERMISSION" ? authorization.permission : authorization.kind;

    request.log.warn(
      {
        event: "route.authorization.denied",
        reason: outcome.reason,
        required_permission: permissionName,
      },
      "acceso denegado",
    );

    switch (outcome.reason) {
      case "UNAUTHENTICATED":
        throw ApiErrors.unauthenticated();
      case "STEP_UP_REQUIRED":
        throw ApiErrors.stepUpRequired(permissionName);
      case "FORBIDDEN":
      default:
        throw ApiErrors.forbidden(permissionName);
    }
  };
}

/**
 * Instala la guardia de arranque. Debe llamarse ANTES de registrar ninguna
 * ruta, o las rutas anteriores no quedarian cubiertas.
 */
export function installRouteGuard(app: FastifyInstance): void {
  app.addHook("onRoute", (routeOptions) => {
    if (isFrameworkGeneratedRoute(routeOptions)) {
      return;
    }

    const config = routeOptions.config as Partial<LswRouteConfig> | undefined;
    const definition = config?.[ROUTE_CONFIG_KEY];

    if (definition === undefined) {
      throw new RouteRegistrationError(
        `DEC-015 (deny-by-default): la ruta ${String(routeOptions.method)} ${routeOptions.url} se registro sin pasar ` +
          "por el registro central, asi que no declara permiso. El proceso no arranca. " +
          "Usa registerRoutes() de src/http/route-registry.ts.",
      );
    }

    assertRouteIsAuthorized(definition);
  });
}

export function registerRoutes(
  app: FastifyInstance,
  definitions: readonly RouteDefinition[],
): void {
  const seen = new Set<string>();
  const seenOperationIds = new Set<string>();

  for (const definition of definitions) {
    const signature = `${String(definition.method)} ${definition.url}`;
    if (seen.has(signature)) {
      throw new RouteRegistrationError(`Ruta duplicada: ${signature}.`);
    }
    seen.add(signature);

    if (seenOperationIds.has(definition.operationId)) {
      throw new RouteRegistrationError(
        `operationId duplicado: ${definition.operationId}. DEC-014 lo usa como identificador estable del contrato.`,
      );
    }
    seenOperationIds.add(definition.operationId);

    assertRouteIsAuthorized(definition);

    app.route({
      method: definition.method,
      url: definition.url,
      config: { [ROUTE_CONFIG_KEY]: definition } satisfies LswRouteConfig,
      preHandler: buildAuthorizationPreHandler(),
      schema: {
        ...(definition.schema.params === undefined ? {} : { params: definition.schema.params }),
        ...(definition.schema.querystring === undefined
          ? {}
          : { querystring: definition.schema.querystring }),
        ...(definition.schema.body === undefined ? {} : { body: definition.schema.body }),
        response: definition.schema.response,
      },
      // El tipo de handler del registro es deliberadamente mas laxo que el de
      // Fastify: los handlers devuelven el cuerpo y el serializador Zod se
      // encarga del resto. El contrato real lo impone `schema.response`.
      handler: definition.handler,
    });
  }
}

/**
 * Manifiesto legible por maquina de la superficie HTTP.
 *
 * Es lo que `security` compara contra `docs/API_CONTRACT.md` para el test de
 * contrato de DEC-015: si un endpoint existe en codigo y no en el documento, o
 * su permiso difiere, CI falla.
 */
export interface RouteManifestEntry {
  readonly method: string;
  readonly path: string;
  readonly operation_id: string;
  readonly authorization: string;
  readonly requires_step_up: boolean;
  readonly tags: readonly string[];
  readonly summary: string;
}

export function buildRouteManifest(definitions: readonly RouteDefinition[]): RouteManifestEntry[] {
  return definitions
    .map((definition): RouteManifestEntry => {
      const { authorization } = definition;
      const authorizationLabel =
        authorization.kind === "PERMISSION"
          ? authorization.permission
          : authorization.kind === "PARTICIPANT"
            ? authorization.selfOnly
              ? "PARTICIPANT_SELF"
              : "PARTICIPANT"
            : "PUBLIC";

      return {
        method: definition.method,
        path: definition.url,
        operation_id: definition.operationId,
        authorization: authorizationLabel,
        requires_step_up:
          authorization.kind === "PERMISSION"
            ? getPermission(authorization.permission).requiresStepUp
            : false,
        tags: definition.tags,
        summary: definition.summary,
      };
    })
    .sort((a, b) =>
      a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
    );
}

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Estrategia de autorizacion. `packages/security` la sustituira por la
     * implementacion real (DEC-006) mediante un decorador; hasta entonces es
     * `denyAllAuthorizer`.
     */
    lswAuthorizer: Authorizer;
  }

  /**
   * La definicion de ruta viaja dentro de `routeOptions.config` para que el
   * hook `onRoute` y el `preHandler` de autorizacion puedan recuperarla sin
   * mantener un registro paralelo indexado por url, que se desincronizaria en
   * cuanto una ruta se registrara dos veces.
   *
   * Opcional porque Fastify tambien crea rutas por su cuenta (`HEAD` derivado,
   * preflight de CORS): que el tipo lo permita es lo que obliga a comprobarlo
   * antes de usarlo, y esa comprobacion es la que deniega por defecto.
   */
  interface FastifyContextConfig {
    lswRoute?: RouteDefinition;
  }
}
