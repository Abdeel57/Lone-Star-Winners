/**
 * Sorteo interno y expediente de ganador potencial (DEC-017).
 *
 * ---------------------------------------------------------------------------
 * EL MOTOR ESTA MONTADO. EL SORTEO SIGUE NEGANDOSE POR DEFECTO
 * ---------------------------------------------------------------------------
 *
 * Las dos frases son ciertas a la vez, y la distincion es todo lo que importa
 * aqui. `POST /admin/draws` ya NO responde "no implementado": llama a
 * `initiateDraw` de `@lsw/tpa`, que es la unica puerta por la que se puede
 * sortear, con los puertos REALES -flags persistidos, autorizador de
 * `@lsw/security`, repositorios de PostgreSQL, CSPRNG del sistema y la cadena
 * de `@lsw/audit`-.
 *
 * Esa funcion exige CINCO cerrojos simultaneos y se niega en el primero que no
 * pasa, dejando `AuditEvent` de la negativa:
 *
 *   1. `internal_draw_enabled`, persistido y APAGADO por defecto (DEC-032).
 *   2. Autorizacion documental viva, con alcance y ventana.
 *   3. Segunda aprobacion de un actor DISTINTO, dentro de su TTL.
 *   4. Snapshot FINALIZED cuyo digest RECALCULADO coincida con el guardado.
 *   5. CSPRNG utilizable, con rechazo de muestreo.
 *
 * Hoy fallan dos: el flag esta apagado, y aunque se encendiera no existe la
 * ruta que concede la segunda aprobacion (ver mas abajo). La respuesta es
 * `409` con el `reason_code` ESTABLE del dominio en `details.reason`, no un
 * codigo inventado en este fichero: ese identificador lo leera un tercero
 * dentro de meses y renombrarlo romperia el historico (DEC-022).
 *
 * Lo que este handler NO hace, y no debe hacer nunca: decidir. No comprueba
 * cerrojos por su cuenta, no elige ordinal y no construye el registro. Un
 * sorteo escrito a mano en un handler no tiene rechazo de muestreo, ni
 * commit-reveal, ni cadena de registro.
 *
 * ---------------------------------------------------------------------------
 * `draw.approve` NO EXISTE TODAVIA EN EL CATALOGO
 * ---------------------------------------------------------------------------
 *
 * HO-026 lo resolvio como capacidad PROPIA -no reutilizar `draw.initiate`,
 * porque dejaria la separacion de funciones dentro del mismo rol- y su
 * resiembra la hace la otra sesion.
 *
 * La ruta de segunda aprobacion NO ESTA EN ESTE FICHERO, y esa ausencia es
 * deliberada. Se escribio, y despues se retiro: dejarla aqui "preparada pero
 * sin registrar" habria roto un gate real. El escaner de `tests/security`
 * recorre las FUENTES de `apps/api` buscando `operationId` y exige que el
 * manifiesto conozca cada uno; una ruta escrita y no registrada aparece como
 * manifiesto desactualizado, y el gate deja de distinguir "falta regenerar" de
 * "hay una ruta que nadie audita".
 *
 * El codigo completo esta en el informe del hito B5 y se pega aqui cuando la
 * capacidad exista, sin cambiar nada mas. Registrarla con un permiso inventado
 * haria que el registro deny-by-default abortara el arranque, y registrarla con
 * `draw.initiate` romperia justamente lo que HO-026 decidio.
 *
 * ---------------------------------------------------------------------------
 * `draw.authorization.read` TAMPOCO EXISTE
 * ---------------------------------------------------------------------------
 *
 * HO-026 nombra la alternativa: reutilizar `draw.result.read`. Es lo que se
 * hace, y queda escrito aqui para que la eleccion se pueda revisar en vez de
 * deducirse.
 */

import { createDrawingEventChainPort } from "@lsw/audit";
import {
  DRAW_REFUSAL_CODES,
  DrawRefusedError,
  PotentialWinnerTransitionError,
  allowedTransitionsFrom,
  initiateDraw,
  transitionPotentialWinner,
  type DrawServiceDependencies,
  type DrawingEvent,
  type PotentialWinner,
} from "@lsw/tpa";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import { requireStaff, requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  drawAuthorizationSchema,
  drawingEventSchema,
  potentialWinnerSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";
import type { DomainServices } from "../services/domain-services.js";
import { createDrawDependencies } from "../services/draw-service.js";

const promotionParamsSchema = z.object({ promotion_id: z.uuid() });
const authorizationParamsSchema = promotionParamsSchema.extend({
  authorization_id: z.uuid(),
});
const winnerParamsSchema = z.object({ potential_winner_id: z.uuid() });

const createAuthorizationBodySchema = z.object({
  /**
   * Referencia al documento aprobado por el cliente y su abogado. Es el campo
   * que hace que la autorizacion valga algo: sin el, esto seria un booleano con
   * mas pasos.
   */
  authorization_reference: z.string().min(3).max(200),
  /** `null` = cualquier snapshot FINALIZED de la promocion. */
  scope_snapshot_id: z.uuid().nullable(),
  scope_max_draws: z.number().int().min(1).max(1000),
  /** TEXTO, no enum: ningun valor de este campo codifica una regla legal. */
  scope_purpose: z.string().min(3).max(500),
  valid_from: z.iso.datetime(),
  valid_until: z.iso.datetime(),
  reason_text: z.string().min(3).max(2000),
});

const revokeBodySchema = z.object({
  revocation_reason: z.string().min(3).max(2000),
});

const initiateDrawBodySchema = z.object({
  promotion_id: z.uuid(),
  snapshot_id: z.uuid(),
  authorization_id: z.uuid(),
  /** Identificador de ESTA peticion. Ata la segunda aprobacion y da idempotencia. */
  draw_request_id: z.string().regex(/^[A-Za-z0-9_:-]{1,100}$/u),
  reason_text: z.string().min(3).max(2000),
});

const winnerStatusBodySchema = z.object({
  next_status: z.enum([
    "CONTACT_PENDING",
    "CONTACTED",
    "DOCUMENTS_PENDING",
    "ELIGIBILITY_REVIEW",
    "VERIFIED",
    "DISQUALIFIED",
    "ALTERNATE_REQUIRED",
    "CONFIRMED",
  ]),
  /** DEC-022: codigo estable, nunca prosa traducible. */
  reason_code: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u),
  reason_text: z.string().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Montaje y proyecciones
// ---------------------------------------------------------------------------

function drawDependencies(
  dependencies: AppDependencies,
  domain: DomainServices,
): DrawServiceDependencies {
  return createDrawDependencies({
    clock: domain.clock,
    // DEC-013: el flag sale del repositorio, jamas del entorno.
    config: dependencies.repositories.config,
    authorizations: domain.repositories.drawAuthorizations,
    snapshots: domain.repositories.exportSnapshots,
    drawings: domain.repositories.drawingEvents,
    chain: createDrawingEventChainPort(),
    audit: domain.tpaAudit,
    stepUpMaxAgeSeconds: dependencies.config.session.stepUpMaxAgeSeconds,
  });
}

/**
 * `user-agent`, acotado.
 *
 * La cabecera la escribe el cliente y puede traer kilobytes. La columna la
 * guarda indefinidamente, asi que se recorta aqui y no en la base de datos.
 */
function userAgentOf(request: FastifyRequest): string | null {
  const raw = request.headers["user-agent"];
  return typeof raw === "string" && raw !== "" ? raw.slice(0, 512) : null;
}

/**
 * Negativa del dominio -> respuesta HTTP.
 *
 * `details.reason` lleva SIEMPRE el codigo estable de `@lsw/tpa`. El `code` de
 * primer nivel se conserva como `INTERNAL_DRAW_DISABLED` para el cerrojo 1
 * porque es el que el contrato documenta y el que el frontend traduce; el resto
 * comparten `DRAW_REFUSED`, con el motivo exacto en `details`.
 *
 * NUNCA viaja `error.message`: es prosa, y DEC-031 deja claro que el envelope
 * no lleva texto. El detalle legible queda en el log y en el `AuditEvent`.
 */
function refusalToApiError(error: DrawRefusedError): ApiError {
  const flagRefusal =
    error.code === DRAW_REFUSAL_CODES.FEATURE_DISABLED ||
    error.code === DRAW_REFUSAL_CODES.FEATURE_FLAG_NOT_EVALUATED;

  return new ApiError({
    statusCode: 409,
    code: flagRefusal ? "INTERNAL_DRAW_DISABLED" : "DRAW_REFUSED",
    details: { reason: error.code, ...error.context },
    cause: error,
  });
}

/**
 * Proyeccion del registro de sorteo.
 *
 * Los dos contadores viajan como CADENA (DEC-010): son `bigint` en la tabla y
 * no sobreviven a `JSON.parse` como numero.
 */
function presentDrawingEvent(event: DrawingEvent): z.infer<typeof drawingEventSchema> {
  return {
    id: event.id,
    promotion_id: event.promotionId,
    draw_request_id: event.drawRequestId,
    snapshot_id: event.snapshotId,
    authorization_id: event.authorizationId,
    entropy_source: event.entropySource,
    total_eligible_entries: String(event.totalEligibleEntries),
    selected_ordinal: String(event.selectedOrdinal),
    selected_participant_reference: event.selectedParticipantReference,
    selected_provenance: event.selectedProvenance,
    completed_at: event.completedAt,
    record_hash: event.recordHash,
    previous_record_hash: event.previousRecordHash,
  };
}

function presentPotentialWinner(winner: PotentialWinner): z.infer<typeof potentialWinnerSchema> {
  return {
    id: winner.id,
    promotion_id: winner.promotionId,
    drawing_event_id: winner.drawingEventId,
    source: winner.source,
    participant_reference: winner.participantReference,
    entry_reference: winner.entryReference,
    rank: winner.rank,
    status: winner.status,
    status_changed_at: winner.statusChangedAt,
    status_reason_code: winner.statusReasonCode,
    history: winner.history.map((entry) => ({
      from: entry.from,
      to: entry.to,
      occurred_at: entry.occurredAt,
      actor_id: entry.actorId,
      reason_code: entry.reasonCode,
    })),
  };
}

export function buildDrawRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const domain = domainServicesFor(dependencies);

  return [
    {
      method: "GET",
      url: "/api/v1/admin/promotions/:promotion_id/draw-authorizations",
      operationId: "listDrawAuthorizations",
      summary: "Autorizaciones documentales de sorteo de una promocion.",
      description:
        "Usa `draw.result.read` porque `draw.authorization.read` no existe en el catalogo; HO-026 nombra esta reutilizacion como la alternativa aceptada.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "draw.result.read" },
      schema: {
        params: promotionParamsSchema,
        response: {
          200: pageSchema(drawAuthorizationSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;

        const rows = await domain.repositories.drawAuthorizations.listAuthorizations(
          params.promotion_id,
          50,
        );

        const items = await Promise.all(
          rows.map(async (row) => ({
            id: row.id,
            promotion_id: row.promotionId,
            authorized_by: row.authorizedBy,
            authorized_at: row.authorizedAt,
            authorization_reference: row.authorizationReference,
            scope: {
              snapshot_id: row.scope.snapshotId,
              max_draws: row.scope.maxDraws,
              purpose: row.scope.purpose,
            },
            valid_from: row.validFrom,
            valid_until: row.validUntil,
            revoked_at: row.revokedAt,
            // Cuantos sorteos ha amparado ya. Sin esta cifra, "quedan sorteos"
            // habria que deducirlo restando en el cliente, y una resta de dos
            // numeros que pueden llegar desincronizados no es una respuesta.
            draws_used: await domain.repositories.drawingEvents.countForAuthorization(row.id),
          })),
        );

        return { items, next_cursor: null };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/draw-authorizations",
      operationId: "createDrawAuthorization",
      summary: "Registrar una autorizacion documental de sorteo.",
      description:
        "No autoriza por si sola: es el cerrojo 2 de DEC-017. Sin ella el sorteo se niega aunque el flag este encendido, y con ella tampoco se sortea si falla cualquiera de los otros cuatro cerrojos.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "draw.authorization.create" },
      schema: {
        params: promotionParamsSchema,
        body: createAuthorizationBodySchema,
        response: {
          201: drawAuthorizationSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const body = request.body as z.infer<typeof createAuthorizationBodySchema>;

        const created = await domain.repositories.drawAuthorizationWriter.createAuthorization({
          id: domain.ids.next(),
          promotionId: params.promotion_id,
          authorizedBy: staff.actor.type === "ADMIN" ? staff.actor.adminUserId : "system",
          authorizedAt: domain.clock.now(),
          authorizationReference: body.authorization_reference,
          scopeSnapshotId: body.scope_snapshot_id,
          scopeMaxDraws: body.scope_max_draws,
          scopePurpose: body.scope_purpose,
          validFrom: new Date(body.valid_from),
          validUntil: new Date(body.valid_until),
          reasonText: body.reason_text,
        });

        void reply.code(201);
        return {
          id: created.id,
          promotion_id: created.promotionId,
          authorized_by: created.authorizedBy,
          authorized_at: created.authorizedAt,
          authorization_reference: created.authorizationReference,
          scope: {
            snapshot_id: created.scope.snapshotId,
            max_draws: created.scope.maxDraws,
            purpose: created.scope.purpose,
          },
          valid_from: created.validFrom,
          valid_until: created.validUntil,
          revoked_at: created.revokedAt,
          draws_used: 0,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/draw-authorizations/:authorization_id/revoke",
      operationId: "revokeDrawAuthorization",
      summary: "Revocar una autorizacion de sorteo, con motivo.",
      description:
        "Revocar es lo unico que le puede pasar a una autorizacion, y solo una vez: des-revocar equivaldria a resucitar una firma retirada, y un trigger lo impide.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "draw.authorization.create" },
      schema: {
        params: authorizationParamsSchema,
        body: revokeBodySchema,
        response: {
          200: z.object({ revoked: z.boolean() }),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof authorizationParamsSchema>;
        const body = request.body as z.infer<typeof revokeBodySchema>;

        const existing = await domain.repositories.drawAuthorizations.findDrawAuthorization(
          params.promotion_id,
          params.authorization_id,
        );
        if (existing === null) {
          throw new ApiError({ statusCode: 404, code: "DRAW_AUTHORIZATION_NOT_FOUND" });
        }

        const revoked = await domain.repositories.drawAuthorizationWriter.revokeAuthorization(
          params.authorization_id,
          domain.clock.now(),
          body.revocation_reason,
        );

        // `false` = ya estaba revocada. No es un error: la operacion es
        // idempotente y el instante que queda es el de la primera revocacion.
        return { revoked };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/draws",
      operationId: "initiateDraw",
      summary: "Iniciar un sorteo interno.",
      description:
        "Llama a `initiateDraw` de `@lsw/tpa`, que comprueba los CINCO cerrojos de DEC-017 y se niega en el primero que no pasa dejando AuditEvent de la negativa. El cerrojo 1 -el flag persistido, apagado por defecto- responde 409 INTERNAL_DRAW_DISABLED; el resto, 409 DRAW_REFUSED con el reason_code estable del dominio en details.reason.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "draw.initiate" },
      schema: {
        body: initiateDrawBodySchema,
        response: {
          201: drawingEventSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const body = request.body as z.infer<typeof initiateDrawBodySchema>;

        /**
         * NO se abre transaccion alrededor de `initiateDraw`, y es deliberado.
         *
         * Cada negativa deja su propio `AuditEvent` -el intento de sortear sin
         * autorizacion es exactamente el hecho que un auditor querra ver- y esos
         * eventos se escriben DENTRO de la funcion, antes de lanzar. Con una
         * transaccion envolvente, el `throw` la haria retroceder y la constancia
         * de la negativa desapareceria con ella: el sistema se habria negado sin
         * dejar rastro, que es la unica forma de negarse que no sirve de nada.
         *
         * El grabador de auditoria abre transaccion propia por evento, asi que
         * cada uno confirma por su cuenta. En el camino de exito, el registro del
         * sorteo lo escribe `drawings.append` y el expediente del ganador se
         * persiste justo despues: si el proceso muriera entre los dos, quedaria
         * el `DrawingEvent` -que es la evidencia, y lleva dentro el ordinal, el
         * lote y la referencia del participante- sin su expediente, que se puede
         * reconstruir desde el. Al reves no seria recuperable.
         */
        let outcome;
        try {
          outcome = await initiateDraw(drawDependencies(dependencies, domain), {
            drawRequestId: body.draw_request_id,
            promotionId: body.promotion_id,
            snapshotId: body.snapshot_id,
            authorizationId: body.authorization_id,
            // Identificadores preasignados por el llamante, como pide el dominio.
            drawingEventId: domain.ids.next(),
            potentialWinnerId: domain.ids.next(),
            initiatedBy: staff.adminUserId,
            initiatorRoles: staff.roles,
            secondsSinceLastMfa: staff.secondsSinceLastMfa,
            reasonText: body.reason_text,
            requestId: request.id,
            // HO-032 punto 1: la direccion solo puede viajar como digest CON
            // CLAVE, y esa clave todavia no existe. `null` es la respuesta
            // correcta; guardarla en claro para siempre, no.
            sourceIp: null,
            userAgent: userAgentOf(request),
          });
        } catch (error) {
          if (error instanceof DrawRefusedError) {
            request.log.warn(
              {
                event: "draw.refused",
                reason: error.code,
                draw_request_id: body.draw_request_id,
                promotion_id: body.promotion_id,
                snapshot_id: body.snapshot_id,
              },
              "sorteo interno rechazado por un cerrojo de DEC-017",
            );
            throw refusalToApiError(error);
          }
          throw error;
        }

        // El expediente del ganador POTENCIAL. `initiateDraw` lo construye pero
        // no lo persiste -no conoce la base de datos-, y aqui no se le cambia
        // nada: se guarda tal cual sale del dominio.
        await domain.repositories.unitOfWork.withTransaction(async () => {
          await domain.repositories.potentialWinners.create(outcome.potentialWinner);
        });

        void reply.code(201);
        return presentDrawingEvent(outcome.drawingEvent);
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/draws",
      operationId: "listDrawingEvents",
      summary: "Sorteos ejecutados de una promocion, en orden de cadena.",
      description:
        "No hay estado FAILED ni VOIDED: una negativa es un AuditEvent `draw.rejected`, no un sorteo a medias. Cada fila trae su hash y el anterior, para que la cadena se pueda verificar desde fuera.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "draw.result.read" },
      schema: {
        querystring: promotionParamsSchema,
        response: {
          200: pageSchema(drawingEventSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof promotionParamsSchema>;

        const rows = await domain.repositories.drawingEvents.listChain(query.promotion_id);

        return { items: rows.map(presentDrawingEvent), next_cursor: null };
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/promotions/:promotion_id/potential-winners",
      operationId: "listPotentialWinners",
      summary: "Expedientes de ganador potencial de una promocion.",
      description:
        "Sin nombre, correo ni telefono: solo referencias internas. Este registro se ensena a terceros.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "winner.workflow.read" },
      schema: {
        params: promotionParamsSchema,
        response: {
          200: pageSchema(potentialWinnerSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;

        const rows = await domain.repositories.potentialWinners.listForPromotion(
          params.promotion_id,
        );

        return { items: rows.map(presentPotentialWinner), next_cursor: null };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/potential-winners/:potential_winner_id/status",
      operationId: "updatePotentialWinnerStatus",
      summary: "Mover el expediente de un ganador potencial.",
      description:
        "La maquina de estados vive en `@lsw/tpa` y decide QUE transiciones son legitimas: aqui no se replica, se llama. Una transicion no permitida responde 409 WINNER_TRANSITION_NOT_ALLOWED con el estado de partida y los destinos posibles.",
      tags: ["draw"],
      authorization: { kind: "PERMISSION", permission: "winner.status.update" },
      schema: {
        params: winnerParamsSchema,
        body: winnerStatusBodySchema,
        response: {
          200: potentialWinnerSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof winnerParamsSchema>;
        const body = request.body as z.infer<typeof winnerStatusBodySchema>;

        const existing = await domain.repositories.potentialWinners.findById(
          params.potential_winner_id,
        );
        if (existing === null) {
          throw new ApiError({ statusCode: 404, code: "POTENTIAL_WINNER_NOT_FOUND" });
        }

        const occurredAt = domain.clock.now();

        // La maquina de estados decide ANTES de tocar la base de datos. El
        // resultado se descarta -el adaptador reconstruye el expediente al
        // aplicar- pero la validacion no: es la unica que existe, y aplicar
        // primero para validar despues seria no validar.
        try {
          transitionPotentialWinner(existing, {
            to: body.next_status,
            occurredAt: occurredAt.toISOString(),
            actorId: staff.adminUserId,
            reasonCode: body.reason_code,
            reasonText: body.reason_text ?? null,
          });
        } catch (error) {
          if (error instanceof PotentialWinnerTransitionError) {
            throw new ApiError({
              statusCode: 409,
              code: "WINNER_TRANSITION_NOT_ALLOWED",
              details: {
                reason: error.code,
                from: error.from,
                to: error.to,
                // Los destinos posibles salen de la MISMA maquina que acaba de
                // negarse. Sin ellos, el panel tendria que llevar su propia
                // tabla de transiciones para pintar los botones, y ese seria el
                // primer paso hacia una segunda maquina de estados.
                allowed: [...allowedTransitionsFrom(error.from)],
              },
              cause: error,
            });
          }
          throw error;
        }

        const updated = await domain.repositories.unitOfWork.withTransaction(async () => {
          // El `WHERE` del adaptador incluye el estado de partida, asi que dos
          // transiciones concurrentes desde el mismo estado no se aplican las
          // dos: la segunda no encuentra fila y devuelve `null`.
          const applied = await domain.repositories.potentialWinners.applyTransition({
            id: existing.id,
            expectedStatus: existing.status,
            nextStatus: body.next_status,
            occurredAt,
            actorReference: staff.adminUserId,
            reasonCode: body.reason_code,
            reasonText: body.reason_text ?? null,
          });

          if (applied === null) {
            return null;
          }

          await domain.tpaAudit.record({
            occurredAt: occurredAt.toISOString(),
            actor: { type: "STAFF", id: staff.adminUserId, roles: staff.roles },
            action: "winner.status_changed",
            targetEntityType: "potential_winner",
            targetEntityId: existing.id,
            promotionId: existing.promotionId,
            requestId: request.id,
            before: null,
            after: null,
            reasonCode: body.reason_code,
            reasonText: body.reason_text ?? null,
            sourceIp: null,
            userAgent: userAgentOf(request),
            metadata: {
              from_status: existing.status,
              to_status: body.next_status,
              // Referencia interna, nunca nombre ni correo: este registro se
              // ensena a terceros.
              participant_reference: existing.participantReference,
              rank: existing.rank,
            },
            canonicalizationVersion: 1,
          });

          return applied;
        });

        if (updated === null) {
          throw new ApiError({
            statusCode: 409,
            code: "WINNER_TRANSITION_CONFLICT",
            details: { expected_status: existing.status },
          });
        }

        return presentPotentialWinner(updated);
      },
    },
  ];
}
