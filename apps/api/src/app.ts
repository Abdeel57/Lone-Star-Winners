/**
 * Ensamblado de la aplicacion Fastify (DEC-004: proceso separado de `apps/web`).
 *
 * El orden de este archivo importa y no es arbitrario:
 *
 *   1. Se instala la guardia de rutas ANTES que nada. Si se instalara despues,
 *      cualquier ruta registrada por un plugin anterior escaparia al control
 *      deny-by-default de DEC-015.
 *   2. Se decora el autorizador. Desde DEC-045 es el real, respaldado por la
 *      tabla de sesiones; antes era uno que denegaba todo lo no publico.
 *   3. Se registran los plugins de seguridad de transporte.
 *   4. Al final, las rutas.
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createDatabaseHandle, type DatabaseHandle } from "@lsw/database";
import { UnconfiguredPaymentProvider, type PaymentProvider } from "@lsw/commerce";
import { fastify, type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config/env.js";
import { ApiError, ApiErrors } from "./http/errors.js";
import { installRouteGuard, registerRoutes, type RouteDefinition } from "./http/route-registry.js";
import { zodSerializerCompiler, zodValidatorCompiler } from "./http/zod-compilers.js";
import { createLogger } from "./observability/logger.js";
import {
  runWithRequestContext,
  sanitizeIncomingCorrelationId,
} from "./observability/request-context.js";
import cookie from "@fastify/cookie";

import { createSessionAuthorizer } from "./http/session-authorizer.js";
import { createSessionPrincipalResolver } from "./http/session-principal.js";
import { buildAuthRoutes } from "./routes/auth.js";
import { buildCartRoutes } from "./routes/cart.js";
import { buildHealthRoutes } from "./routes/health.js";
import { buildMetaRoutes } from "./routes/meta.js";
import { buildStorefrontRoutes } from "./routes/storefront.js";
// Hito B5 (DEC-046): comercio, portal, AMOE, ajustes, sorteo y exportacion.
import { buildAdjustmentRoutes } from "./routes/adjustments.js";
// HO-034 punto 5: los cuatro modulos de lectura que el panel llamaba y que no
// existian (dashboard, pedidos, participantes y traza de auditoria).
import { buildAdminAuditRoutes } from "./routes/admin-audit.js";
import { buildAdminCatalogRoutes } from "./routes/admin-catalog.js";
import { buildAdminRulesRoutes } from "./routes/admin-rules.js";
import { buildAdminDashboardRoutes } from "./routes/admin-dashboard.js";
import { buildAdminOrdersRoutes } from "./routes/admin-orders.js";
import { buildAdminParticipantRoutes } from "./routes/admin-participants.js";
import { buildAmoeRoutes } from "./routes/amoe.js";
import { buildDrawRoutes } from "./routes/draw.js";
import { buildExportRoutes } from "./routes/export.js";
import { buildOrdersRoutes, installRawBodyForPaymentWebhooks } from "./routes/orders.js";
import { buildPortalRoutes } from "./routes/portal.js";
import { installPrincipalResolver } from "./http/principal.js";
import { createFeatureFlagPort } from "./services/draw-service.js";
import { createIdentityRepositories } from "./services/drizzle-identity.js";
import { createParticipantLookup } from "./services/participant-lookup.js";
import { createRepositories } from "./services/drizzle-repositories.js";
import type { IdentityRepositories } from "./services/identity-ports.js";
import type { Repositories } from "./services/ports.js";

export interface AppDependencies {
  readonly config: ApiConfig;
  readonly database: DatabaseHandle;
  readonly paymentProvider: PaymentProvider;
  /**
   * Acceso a datos detras de puertos. Ver `services/ports.ts` para el motivo:
   * permite probar sin Docker lo que NO vive en el motor, sin simular lo que
   * si vive en el (DEC-018).
   */
  readonly repositories: Repositories;
  /** Puertos de identidad y sesion (DEC-006, DEC-045). */
  readonly identity: IdentityRepositories;
}

export function createDependencies(config: ApiConfig): AppDependencies {
  const database = createDatabaseHandle({
    // DEC-003: la API usa el rol `app`. Nunca `migrator`.
    role: "app",
    connectionString: config.database.appUrl,
    maxConnections: config.database.poolMax,
    statementTimeoutMs: config.database.statementTimeoutMs,
    ssl:
      config.database.sslMode === "disable"
        ? false
        : { rejectUnauthorized: config.database.sslMode === "verify-full" },
    applicationName: "lsw-api",
  });

  return {
    config,
    database,
    repositories: createRepositories(database.db),
    identity: createIdentityRepositories(database.db),
    // `CLAUDE.md` seccion 7: el procesador de pagos no esta decidido. Hasta que
    // lo este, el puerto falla ruidosamente en vez de simular exito.
    paymentProvider: new UnconfiguredPaymentProvider(),
  };
}

/** Devuelve todas las definiciones de ruta del proceso. Es la fuente de DEC-014 y DEC-015. */
export function collectRouteDefinitions(dependencies: AppDependencies): RouteDefinition[] {
  const routes: RouteDefinition[] = [
    ...buildHealthRoutes(dependencies),
    ...buildStorefrontRoutes(dependencies),
    ...buildCartRoutes(dependencies),
    ...buildAuthRoutes(dependencies),
    ...buildOrdersRoutes(dependencies),
    ...buildPortalRoutes(dependencies),
    ...buildAmoeRoutes(dependencies),
    ...buildAdjustmentRoutes(dependencies),
    ...buildDrawRoutes(dependencies),
    ...buildExportRoutes(dependencies),
    ...buildAdminDashboardRoutes(dependencies),
    ...buildAdminOrdersRoutes(dependencies),
    ...buildAdminParticipantRoutes(dependencies),
    ...buildAdminAuditRoutes(dependencies),
    ...buildAdminCatalogRoutes(dependencies),
    ...buildAdminRulesRoutes(dependencies),
  ];

  const metaRoutes = buildMetaRoutes({
    serverUrl: dependencies.config.http.publicUrl,
    allRoutes: () => routes,
  });

  if (dependencies.config.exposeOpenApiOverHttp) {
    routes.push(...metaRoutes);
  }

  return routes;
}

/**
 * Superficie completa del contrato, independientemente de que se sirva por
 * HTTP o no. Es lo que consume el generador de artefactos, para que el spec
 * publicado sea el mismo en todos los entornos.
 */
export function collectContractRouteDefinitions(dependencies: AppDependencies): RouteDefinition[] {
  const routes: RouteDefinition[] = [
    ...buildHealthRoutes(dependencies),
    ...buildStorefrontRoutes(dependencies),
    ...buildCartRoutes(dependencies),
    ...buildAuthRoutes(dependencies),
    ...buildOrdersRoutes(dependencies),
    ...buildPortalRoutes(dependencies),
    ...buildAmoeRoutes(dependencies),
    ...buildAdjustmentRoutes(dependencies),
    ...buildDrawRoutes(dependencies),
    ...buildExportRoutes(dependencies),
    ...buildAdminDashboardRoutes(dependencies),
    ...buildAdminOrdersRoutes(dependencies),
    ...buildAdminParticipantRoutes(dependencies),
    ...buildAdminAuditRoutes(dependencies),
    ...buildAdminCatalogRoutes(dependencies),
    ...buildAdminRulesRoutes(dependencies),
  ];
  routes.push(
    ...buildMetaRoutes({ serverUrl: dependencies.config.http.publicUrl, allRoutes: () => routes }),
  );
  return routes;
}

export async function createApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config } = dependencies;
  const logger = createLogger(config);

  const app = fastify({
    loggerInstance: logger,
    bodyLimit: config.http.bodyLimitBytes,
    // `trustProxy` desactivado por defecto: activarlo sin saber cuantos
    // proxies hay delante permite falsificar la IP de origen, y esa IP acaba
    // en decisiones de rate limiting y de riesgo.
    trustProxy: false,
    disableRequestLogging: false,
    genReqId: (request) =>
      sanitizeIncomingCorrelationId(request.headers[config.http.requestIdHeader]),
  });

  // ---- 1. Guardia deny-by-default, antes de cualquier ruta (DEC-015) ----
  installRouteGuard(app);

  //        El parser de cuerpo CRUDO del webhook de pago se instala aqui, antes
  //        de las rutas: la firma se calcula sobre los BYTES que envio el
  //        proveedor, y un JSON reserializado -aunque sea equivalente- ya no
  //        coincide. Es global porque Fastify no permite un parser por ruta, y
  //        discrimina por url: el resto de la API sigue recibiendo el objeto
  //        ya parseado.
  installRawBodyForPaymentWebhooks(app);

  // ---- 2. Autorizador y resolutor de identidad ----
  //
  //        Dos puertos y no uno: el primero responde "puede pasar?" antes del
  //        handler; el segundo, "quien es?", y solo lo necesitan las rutas que
  //        leen datos de alguien.
  //
  //        DEC-045 sustituye aqui el autorizador que denegaba TODO lo no
  //        publico por uno real, respaldado por la tabla de sesiones. Es el
  //        momento en que las rutas con permiso dejan de ser inalcanzables.
  //
  //        El resolutor de principal ya traduce sesion -> participante. Un
  //        visitante SIN cuenta sigue sin carrito: las rutas de carrito admiten
  //        ademas sesiones anonimas (DEC-023) y esas no existen todavia, asi
  //        que el resolutor devuelve `null` para el y su ruta responde 401.
  //        Falla cerrado, y se cierra del todo cuando exista el registro.
  app.decorate(
    "lswAuthorizer",
    createSessionAuthorizer({
      identity: dependencies.identity,
      config,
      // El MISMO puerto que usa el dominio de sorteo, no una segunda lectura de
      // flags: dos formas de responder "esta encendido?" acabarian respondiendo
      // cosas distintas, y una de las dos seria la que autoriza.
      flags: createFeatureFlagPort(dependencies.repositories.config),
    }),
  );
  installPrincipalResolver(
    app,
    createSessionPrincipalResolver({
      identity: dependencies.identity,
      config,
      participants: createParticipantLookup(dependencies.database.db),
    }),
  );

  // ---- 3. Zod como unico lenguaje de esquemas (DEC-014) ----
  app.setValidatorCompiler(zodValidatorCompiler);
  app.setSerializerCompiler(zodSerializerCompiler);

  // ---- 4. Contexto de peticion y `correlation_id` ----
  app.addHook("onRequest", (request, reply, done) => {
    void reply.header(config.http.requestIdHeader, request.id);
    runWithRequestContext(
      {
        correlationId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url,
      },
      done,
    );
  });

  // ---- 4b. Cookies de sesion (DEC-006) ----
  //
  // Sin firmar a proposito. El token ya es opaco y de 256 bits, y su validez la
  // decide la fila de `sessions`, no su forma: firmarlo solo anadiria un
  // segundo secreto que rotar sin ganar ninguna garantia. Una cookie firmada
  // pero no revocable seria peor que esta.
  await app.register(cookie);

  // ---- 5. Seguridad de transporte ----
  await app.register(helmet, {
    // La API no sirve HTML; una CSP restrictiva evita que una respuesta de
    // error se interprete como documento.
    contentSecurityPolicy: {
      directives: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  });

  await app.register(cors, {
    origin: [...config.http.corsAllowedOrigins],
    // La sesion viaja en cookie httpOnly (DEC-006), asi que el navegador debe
    // poder enviarla en peticiones cruzadas desde `apps/web`.
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    exposedHeaders: [config.http.requestIdHeader],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: config.http.rateLimit.maxRequests,
    timeWindow: config.http.rateLimit.windowSeconds * 1_000,
    // El envelope de error tambien aqui: un 429 con otro formato obligaria al
    // frontend a tratar dos formas distintas de error (DEC-022, DEC-031). Se
    // construye con la misma fabrica que el resto para que no pueda divergir.
    errorResponseBuilder: (request, context) =>
      ApiErrors.rateLimited(Math.ceil(context.ttl / 1_000)).toEnvelope(request.id),
  });

  // ---- 6. Errores: un unico envelope (DEC-022) ----
  app.setNotFoundHandler((request, reply) => {
    const error = ApiErrors.notFound();
    void reply.code(error.statusCode).send(error.toEnvelope(request.id));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        request.log.error({ event: "request.failed", err: error }, "error del servidor");
      } else {
        request.log.info({ event: "request.rejected", code: error.code }, "peticion rechazada");
      }
      void reply.code(error.statusCode).send(error.toEnvelope(request.id));
      return;
    }

    // Cualquier otro error se registra completo y se devuelve GENERICO. Un
    // stack trace o un mensaje de PostgreSQL en la respuesta es una filtracion
    // de estructura interna.
    request.log.error({ event: "request.unhandled", err: error }, "error no controlado");
    const generic = ApiErrors.internal();
    void reply.code(generic.statusCode).send(generic.toEnvelope(request.id));
  });

  // ---- 7. Rutas ----
  registerRoutes(app, collectRouteDefinitions(dependencies));

  return app;
}
