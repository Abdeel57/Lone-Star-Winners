/**
 * Sorteo interno y expediente de ganador potencial (DEC-017).
 *
 * ---------------------------------------------------------------------------
 * NINGUNA RUTA DE ESTE FICHERO SORTEA HOY, Y NO ES UN "TODAVIA NO"
 * ---------------------------------------------------------------------------
 *
 * DEC-017 exige CINCO cerrojos simultaneos para cualquier seleccion aleatoria
 * interna. `POST /admin/draws` los consulta en este orden y se niega en el
 * primero que no pasa:
 *
 *   1. `internal_draw_enabled`, persistido y APAGADO (DEC-032).
 *   2. Autorizacion documental viva, con alcance y ventana.
 *   3. Segunda aprobacion de un actor distinto, dentro de su TTL.
 *   4. Snapshot FINALIZED cuyo digest RECALCULADO coincida con el guardado.
 *   5. CSPRNG utilizable.
 *
 * Con el flag apagado, la respuesta es `409 INTERNAL_DRAW_DISABLED` y ahi acaba.
 * Es la respuesta correcta, no un placeholder: el cerrojo 1 esta cerrado.
 *
 * Ademas, el MOTOR de seleccion vive en `@lsw/tpa` y `apps/api` todavia no
 * depende de ese paquete (`pnpm install` esta fuera de alcance esta ronda,
 * DEC-046 punto 5). Por eso, si algun dia el flag se encendiera sin que la
 * dependencia exista, la ruta responde `409 DRAW_ENGINE_NOT_WIRED` en vez de
 * improvisar una seleccion aqui. Un sorteo escrito a mano en un handler no
 * tiene commit-reveal, ni rechazo de muestreo, ni cadena de registro.
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

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  drawAuthorizationSchema,
  drawingEventSchema,
  potentialWinnerSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";

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
        "Comprueba los CINCO cerrojos de DEC-017 y se niega en el primero que no pasa. Hoy el cerrojo 1 -el flag `internal_draw_enabled`- esta cerrado, asi que responde 409 INTERNAL_DRAW_DISABLED y no llega a los demas.",
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
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const body = request.body as z.infer<typeof initiateDrawBodySchema>;

        // ---- Cerrojo 1: el flag persistido -----------------------------------
        //
        // Se lee de la base de datos, nunca del entorno (DEC-013): un flag
        // legalmente material tiene que dejar rastro de quien lo cambio y por
        // que, y un fichero de entorno no deja ninguno.
        const config = await dependencies.repositories.config.read();
        if (!config.featureFlags.internal_draw_enabled) {
          request.log.warn(
            {
              event: "draw.refused",
              reason: "draw.refused.feature_disabled",
              draw_request_id: body.draw_request_id,
            },
            "sorteo interno rechazado: el flag esta apagado",
          );
          throw new ApiError({
            statusCode: 409,
            code: "INTERNAL_DRAW_DISABLED",
            details: { reason: "draw.refused.feature_disabled" },
          });
        }

        // ---- El motor no esta montado ---------------------------------------
        //
        // Los cinco cerrojos y la seleccion viven en `@lsw/tpa`, y `apps/api`
        // todavia no depende de ese paquete. Aqui NO se improvisa un sorteo: sin
        // rechazo de muestreo, sin commit-reveal y sin cadena de registro, lo
        // que saliera no seria defendible ante un tercero.
        request.log.error(
          {
            event: "draw.refused",
            reason: "draw.refused.engine_not_wired",
            draw_request_id: body.draw_request_id,
          },
          "el flag esta encendido pero el motor de sorteo no esta montado",
        );
        throw new ApiError({
          statusCode: 409,
          code: "DRAW_ENGINE_NOT_WIRED",
          details: { required_package: "@lsw/tpa" },
        });
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

        return {
          items: rows.map((row) => ({
            id: row.id,
            promotion_id: row.promotionId,
            draw_request_id: row.drawRequestId,
            snapshot_id: row.snapshotId,
            authorization_id: row.authorizationId,
            entropy_source: row.entropySource,
            // CADENA: son `bigint` y no sobreviven a `JSON.parse` como numero.
            total_eligible_entries: String(row.totalEligibleEntries),
            selected_ordinal: String(row.selectedOrdinal),
            selected_participant_reference: row.selectedParticipantReference,
            selected_provenance: row.selectedProvenance,
            completed_at: row.completedAt,
            record_hash: row.recordHash,
            previous_record_hash: row.previousRecordHash,
          })),
          next_cursor: null,
        };
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

        return {
          items: rows.map((row) => ({
            id: row.id,
            promotion_id: row.promotionId,
            drawing_event_id: row.drawingEventId,
            source: row.source,
            participant_reference: row.participantReference,
            entry_reference: row.entryReference,
            rank: row.rank,
            status: row.status,
            status_changed_at: row.statusChangedAt,
            status_reason_code: row.statusReasonCode,
            history: row.history.map((entry) => ({
              from: entry.from,
              to: entry.to,
              occurred_at: entry.occurredAt,
              actor_id: entry.actorId,
              reason_code: entry.reasonCode,
            })),
          })),
          next_cursor: null,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/potential-winners/:potential_winner_id/status",
      operationId: "updatePotentialWinnerStatus",
      summary: "Mover el expediente de un ganador potencial.",
      description:
        "La maquina de estados vive en `@lsw/tpa` y decide QUE transiciones son legitimas. Mientras esa dependencia no este montada, esta ruta se niega en vez de aplicar una transicion sin validar: replicar la tabla aqui crearia una segunda maquina y el dia que discreparan ganaria la que se ejecutara antes.",
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
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof winnerParamsSchema>;

        const existing = await domain.repositories.potentialWinners.findById(
          params.potential_winner_id,
        );
        if (existing === null) {
          throw new ApiError({ statusCode: 404, code: "POTENTIAL_WINNER_NOT_FOUND" });
        }

        throw new ApiError({
          statusCode: 409,
          code: "WINNER_WORKFLOW_NOT_WIRED",
          details: { required_package: "@lsw/tpa", current_status: existing.status },
        });
      },
    },
  ];
}
