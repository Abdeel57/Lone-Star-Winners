/**
 * Portal del participante: saldo, ledger propio, numeros, retenciones y perfil.
 *
 * ---------------------------------------------------------------------------
 * EL SALDO NO SALE DE UN CONTADOR
 * ---------------------------------------------------------------------------
 *
 * Sale de `lsw_entry_balances_at`, la unica definicion del saldo (DEC-007), que
 * suma los deltas POSTED vigentes al corte. Nunca de `entry_balance_cache`, que
 * es una cache y se puede truncar entera sin perder un dato.
 *
 * Compra y AMOE conviven en el MISMO universo elegible conservando su
 * procedencia (principio 9). Por eso `entry-summary` devuelve un saldo con
 * desglose y NO dos saldos: si fueran dos, el dia que hubiera una devolucion
 * dejarian de sumar.
 *
 * ---------------------------------------------------------------------------
 * UNA DEVOLUCION APARECE COMO FILA NUEVA, NO COMO UNA FILA QUE DESAPARECE
 * ---------------------------------------------------------------------------
 *
 * `entry-transactions` sirve el historico completo, correcciones incluidas. El
 * participante puede ver que paso y cuando. Es lo contrario de un contador que
 * baja sin explicacion.
 *
 * ---------------------------------------------------------------------------
 * LOS NUMEROS VAN DETRAS DE UN FLAG, Y NO SON EL SORTEO
 * ---------------------------------------------------------------------------
 *
 * `visible_entry_numbers_enabled` arranca apagado (DEC-032). Con el apagado,
 * `entry-numbers` devuelve 404: la funcion no existe, y eso no es un error.
 *
 * Que existan numeros NO autoriza a sortear sobre ellos. La secuencia es
 * monotona y predecible; DEC-017 exige cinco cerrojos para cualquier seleccion.
 */

import { formatEntryNumber } from "@lsw/sweepstakes";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, paginationQuerySchema, pageSchema } from "../http/pagination.js";
import type { ParticipantPrincipal } from "../http/principal-narrow.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  awardHoldSchema,
  entryNumberBatchSchema,
  entrySummarySchema,
  entryTransactionSchema,
  participantProfilePatchSchema,
  participantProfileSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";

const promotionQuerySchema = z.object({ promotion_id: z.uuid() });
const promotionPageQuerySchema = promotionQuerySchema.extend(paginationQuerySchema.shape);

async function requireParticipant(request: FastifyRequest): Promise<ParticipantPrincipal> {
  const principal = await request.server.lswPrincipalResolver(request);

  // En POSITIVO, y anotado (HO-027). Ver la nota de `amoe.ts`.
  const isParticipant = principal !== null && principal.kind === "PARTICIPANT";
  if (!isParticipant) {
    throw ApiErrors.unauthenticated();
  }
  return principal;
}

export function buildPortalRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const domain = domainServicesFor(dependencies);

  /**
   * Comprueba que la promocion existe ANTES de leer el saldo.
   *
   * Sin esto, un `promotion_id` inventado devolveria un saldo de cero, que es
   * indistinguible de "existe y no tengo entries". Son dos respuestas distintas
   * y el participante merece la correcta.
   */
  async function requirePromotion(promotionId: string): Promise<void> {
    const context = await domain.repositories.promotions.getContext(promotionId);
    if (context !== null) {
      return;
    }
    const reason = await domain.repositories.promotions.describeMissingContext(promotionId);
    if (reason === "PROMOTION_NOT_FOUND") {
      throw ApiErrors.promotionNotFound(promotionId);
    }
    // Existe pero no esta operativa -sin version de reglas activa o sin
    // ventana-. Se distingue a proposito: es informacion accionable para
    // operaciones y no un 404 que haria buscar una promocion que si existe.
    throw new ApiError({ statusCode: 409, code: "PROMOTION_NOT_OPERATIONAL", details: { reason } });
  }

  return [
    {
      method: "GET",
      url: "/api/v1/account/entry-summary",
      operationId: "getEntrySummary",
      summary: "Saldo de participaciones del participante, con su procedencia.",
      description:
        "Compra y AMOE conviven en el MISMO universo elegible conservando su procedencia (principio 9). Nunca son dos saldos separados. El numero sale de la vista SQL de saldo, nunca de un contador editable.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "entry.self.read" },
      schema: {
        querystring: promotionQuerySchema,
        response: {
          200: entrySummarySchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const query = request.query as z.infer<typeof promotionQuerySchema>;
        await requirePromotion(query.promotion_id);

        const asOf = domain.clock.now();
        const balance = await domain.repositories.ledger.balanceAt(
          query.promotion_id,
          principal.participantId,
          asOf,
        );

        return {
          promotion_id: query.promotion_id,
          active_entries: balance.activeEntries,
          purchase_entries: balance.purchaseEntries,
          amoe_entries: balance.amoeEntries,
          admin_entries: balance.adminEntries,
          system_entries: balance.systemEntries,
          as_of: asOf.toISOString(),
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/entry-transactions",
      operationId: "listEntryTransactions",
      summary: "Historial del ledger del propio participante, correcciones incluidas.",
      description:
        "Una devolucion aparece como FILA NUEVA con delta negativo, no como la desaparicion de la original. `reason_key` es un enum estable; nunca prosa.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "entry.self.read" },
      schema: {
        querystring: promotionPageQuerySchema,
        response: {
          200: pageSchema(entryTransactionSchema),
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const query = request.query as z.infer<typeof promotionPageQuerySchema>;
        await requirePromotion(query.promotion_id);

        const all = await domain.repositories.ledger.listForParticipant(
          query.promotion_id,
          principal.participantId,
        );

        // La paginacion se aplica sobre el resultado porque el puerto del
        // ledger NO expone paginacion, y no la expone a proposito: el dominio
        // necesita el historico COMPLETO para calcular saldos y sobre-reversal.
        // Un puerto paginado invitaria a que un servicio calculara sobre media
        // pagina. Para un participante el historico son decenas de filas; el
        // dia que sean miles, la paginacion baja al puerto de lectura, no al
        // del dominio.
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;
        const start = after === null ? 0 : all.findIndex((row) => row.id === after) + 1;
        const window = all.slice(start, start + query.limit + 1);

        const page = buildPage(window, query.limit, (row) => ({ sortKey: row.id, id: row.id }));

        return {
          items: page.items.map((row) => ({
            id: row.id,
            type: row.type,
            source_type: row.sourceType,
            quantity_delta: row.quantityDelta,
            reason_key: row.reasonKey,
            effective_at: row.effectiveAt.toISOString(),
            expires_at: row.expiresAt?.toISOString() ?? null,
            reverses_transaction_id: row.reversesTransactionId,
          })),
          next_cursor: page.next_cursor,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/entry-numbers",
      operationId: "listEntryNumbers",
      summary: 'Rangos de numeros asignados al participante ("mis numeros").',
      description:
        "Detras del flag `visible_entry_numbers_enabled`, apagado. Con el flag apagado devuelve 404. Los numeros viajan como CADENA (DEC-010). AVISO: la secuencia NO es el algoritmo del sorteo (DEC-017).",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "entry.self.read" },
      schema: {
        querystring: promotionPageQuerySchema,
        response: {
          200: pageSchema(entryNumberBatchSchema),
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const query = request.query as z.infer<typeof promotionPageQuerySchema>;
        await requirePromotion(query.promotion_id);

        const flags = await domain.repositories.promotions.readFlags();
        if (!flags.visible_entry_numbers_enabled) {
          // 404 y no 403: la funcion no existe para nadie. Un 403 sugeriria que
          // existe y que a este participante no se le deja verla.
          throw ApiErrors.notFound();
        }

        const format = await domain.repositories.entryNumbers.getFormat(query.promotion_id);
        if (format === null) {
          // El flag esta encendido pero la promocion no tiene secuencia
          // inicializada. NO se inventa un prefijo: el identificador visible
          // aparece en pantalla y en soporte, y uno improvisado seria imposible
          // de reconciliar despues.
          throw new ApiError({ statusCode: 409, code: "ENTRY_NUMBER_FORMAT_NOT_CONFIGURED" });
        }

        const batches = await domain.repositories.entryNumbers.listBatchesForParticipant(
          query.promotion_id,
          principal.participantId,
        );

        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;
        const start = after === null ? 0 : batches.findIndex((row) => row.id === after) + 1;
        const window = batches.slice(start, start + query.limit + 1);
        const page = buildPage(window, query.limit, (row) => ({ sortKey: row.id, id: row.id }));

        return {
          items: page.items.map((batch) => ({
            batch_id: batch.id,
            quantity: batch.quantity,
            first_number: formatEntryNumber(format.prefix, format.digits, batch.range.start),
            // El rango es SEMIABIERTO `[start, end)`: el ultimo numero es
            // `end - 1`. Con rangos cerrados por ambos lados, dos bloques
            // contiguos se solaparian en el extremo.
            last_number: formatEntryNumber(format.prefix, format.digits, batch.range.end - 1n),
          })),
          next_cursor: page.next_cursor,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/award-holds",
      operationId: "listAwardHolds",
      summary: "Concesiones retenidas del propio participante.",
      description:
        "Una orden que YA califico pero cuyas participaciones esperan a que se cumpla una condicion del participante -hoy, la verificacion del correo, y solo si las Official Rules la exigen-. Es lo que explica un `entry_state: PENDING_QUALIFICATION` que no avanza.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "entry.self.read" },
      schema: {
        querystring: promotionQuerySchema,
        response: {
          200: pageSchema(awardHoldSchema),
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const query = request.query as z.infer<typeof promotionQuerySchema>;
        await requirePromotion(query.promotion_id);

        const holds = await domain.repositories.holds.listHeldForParticipant(
          query.promotion_id,
          principal.participantId,
        );

        return {
          items: holds.map((hold) => ({
            id: hold.id,
            order_id: hold.orderId,
            promotion_id: hold.promotionId,
            reason: hold.reason,
            qualified_at: hold.qualifiedAt.toISOString(),
            held_at: hold.heldAt.toISOString(),
          })),
          next_cursor: null,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/me",
      operationId: "getParticipantProfile",
      summary: "Perfil del participante autenticado.",
      description:
        "SIN fecha de nacimiento, estado de residencia ni edad. No es un olvido: la elegibilidad la fijan las Official Rules y sigue en docs/LEGAL_PENDING.md. Pedir un dato personal que todavia no se sabe si hace falta es recoger datos por si acaso.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.read" },
      schema: {
        response: {
          200: participantProfileSchema,
          401: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const profile = await domain.participants.findProfile(principal.participantId);
        if (profile === null) {
          throw ApiErrors.unauthenticated();
        }
        return profile;
      },
    },

    {
      method: "PATCH",
      url: "/api/v1/me",
      operationId: "updateParticipantProfile",
      summary: "Cambiar nombre para mostrar e idioma preferido.",
      description:
        "Solo esos dos campos. El correo no se cambia por aqui: cambiarlo invalida la verificacion, y la verificacion puede ser condicion para acumular participaciones.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.update" },
      schema: {
        body: participantProfilePatchSchema,
        response: {
          200: participantProfileSchema,
          401: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const body = request.body as z.infer<typeof participantProfilePatchSchema>;

        const updated = await domain.participants.updateProfile(principal.participantId, {
          displayName: body.display_name,
          languagePreference: body.language_preference,
        });
        if (updated === null) {
          throw ApiErrors.unauthenticated();
        }
        return updated;
      },
    },
  ];
}
