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
 * VER LOS NUMEROS VA DETRAS DE UN FLAG, Y LOS NUMEROS NO SON EL SORTEO
 * ---------------------------------------------------------------------------
 *
 * `visible_entry_numbers_enabled` arranca apagado (DEC-032). Con el apagado,
 * `entry-numbers` devuelve 404: la funcion no existe, y eso no es un error. Los
 * numeros se asignan igual (DEC-080); el flag decide solo si se ven.
 *
 * Que existan numeros NO autoriza a sortear sobre ellos. El ganador lo elige el
 * Administrador sobre el universo exportado; DEC-017 exige cinco cerrojos para
 * cualquier seleccion interna.
 */

import {
  computeEntryNumberActivity,
  createEntryNumberCipher,
  DEFAULT_ENTRY_NUMBER_DIGITS,
  type BatchActivity,
} from "@lsw/sweepstakes";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import {
  assertConsents,
  assertDateOfBirth,
  consentsInputSchema,
  dateOfBirthSchema,
  residenceStateSchema,
} from "../http/eligibility-input.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import {
  buildPage,
  decodeCursor,
  encodeCursor,
  paginationQuerySchema,
  pageSchema,
} from "../http/pagination.js";
import type { ParticipantPrincipal } from "../http/principal-narrow.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { readAppliedCap } from "./amoe.js";
import {
  awardHoldSchema,
  type entryNumberBatchSchema,
  type entryNumberSchema,
  entryNumbersPageSchema,
  entrySummarySchema,
  entryTransactionSchema,
  participantProfilePatchSchema,
  participantProfileSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";

const promotionQuerySchema = z.object({ promotion_id: z.uuid() });
const promotionPageQuerySchema = promotionQuerySchema.extend(paginationQuerySchema.shape);

/**
 * "Mis numeros" pagina por NUMEROS: hasta mil por pagina, quinientos por
 * defecto. Con el tope de 10,000 por persona de las Reglas son diez paginas en
 * el peor caso, y cada una pesa unas decenas de KB.
 */
const entryNumbersQuerySchema = promotionQuerySchema.extend({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

/**
 * Posicion de "mis numeros": el lote y cuantos numeros de el ya se sirvieron.
 *
 * Se usa el identificador del lote y no su ordinal interno, que contaria
 * cuantas participaciones se emitieron antes. Un lote que no es del
 * participante, o un desplazamiento fuera de su lote, es un cursor invalido:
 * la misma respuesta que `decodeCursor` da a uno malformado.
 */
function readEntryNumberCursor(
  cursor: string | undefined,
  batches: readonly BatchActivity[],
): { readonly batchIndex: number; readonly offset: number } {
  if (cursor === undefined) {
    return { batchIndex: 0, offset: 0 };
  }
  const position = decodeCursor(cursor);
  const batchIndex = batches.findIndex((batch) => batch.batchId === position.sortKey);
  const offset = Number(position.id);
  const batch = batches[batchIndex];
  if (
    batch === undefined ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= batch.quantity
  ) {
    throw new ApiError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: { issues: [{ path: "cursor", code: "invalid_cursor" }] },
    });
  }
  return { batchIndex, offset };
}

/**
 * DEC-092: con que se rellena la direccion del checkout para no volver a
 * teclearla. Cualquier campo puede faltar; nada de esto se guarda aqui ni
 * decide nada: el pedido se congela con lo que la persona envie.
 */
const checkoutDefaultsSchema = z.object({
  /** `LAST_ORDER`: la direccion de su ultimo pedido. `ACCOUNT`: nombre y estado del alta. */
  source: z.enum(["LAST_ORDER", "ACCOUNT"]),
  full_name: z.string().nullable(),
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string().nullable(),
});

/** Un campo de texto de una direccion guardada, o `null` si falta o esta vacio. */
function addressField(address: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = Object.prototype.hasOwnProperty.call(address, key) ? address[key] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** DEC-067: si la cuenta declaro, y cuando. Nunca lo declarado. */
const eligibilityStatusSchema = z.object({
  /** Las dos mitades declaradas: estado Y fecha de nacimiento. */
  declared: z.boolean(),
  /** Instante en que se declaro el estado, o `null`. */
  declared_at: z.string().nullable(),
  /** DEC-089: el alta sin contrasena declara el estado y no la fecha. */
  residence_state_declared: z.boolean(),
  date_of_birth_declared: z.boolean(),
});

/**
 * DEC-089: cada mitad es opcional, porque una cuenta nueva ya declaro el estado
 * y solo le falta la fecha. Hace falta al menos una. Los consentimientos se
 * exigen al declarar el estado por primera vez, que es cuando una cuenta
 * anterior a DEC-067 los acepta; una cuenta nueva ya los acepto en el alta.
 */
const eligibilityDeclarationBodySchema = z
  .object({
    date_of_birth: dateOfBirthSchema.optional(),
    residence_state: residenceStateSchema.optional(),
    consents: consentsInputSchema.optional(),
    /** Idioma en el que se mostraron los documentos. */
    language: z.enum(["en-US", "es-US"]),
  })
  .refine((body) => body.date_of_birth !== undefined || body.residence_state !== undefined, {
    error: "date_of_birth_or_residence_state_required",
    path: ["date_of_birth"],
  });

/** Lo que se publica de una declaracion: si existe cada mitad, nunca su valor. */
function eligibilityStatusOf(
  declaration: { readonly dateOfBirth: string | null; readonly declaredAt: Date } | null,
): z.infer<typeof eligibilityStatusSchema> {
  const dateOfBirthDeclared = declaration !== null && declaration.dateOfBirth !== null;
  return {
    declared: dateOfBirthDeclared,
    declared_at: declaration?.declaredAt.toISOString() ?? null,
    residence_state_declared: declaration !== null,
    date_of_birth_declared: dateOfBirthDeclared,
  };
}

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
            // Se lee de la MISMA anotacion que dejo la concesion. Nada se
            // recalcula aqui: recalcular el recorte hoy daria otra cifra si el
            // saldo ha cambiado, y lo que hay que explicar es lo que paso.
            applied_cap: readAppliedCap(row.metadata),
          })),
          next_cursor: page.next_cursor,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/entry-numbers",
      operationId: "listEntryNumbers",
      summary: 'Numeros de participacion del participante ("mis numeros").',
      description:
        "Detras del flag `visible_entry_numbers_enabled`: con el flag apagado devuelve 404, aunque los numeros existen igual (DEC-080). Cada participacion tiene un numero distinto, derivado de su ordinal interno con la permutacion con clave de la promocion. `active: false` marca los anulados por devolucion, contracargo, descalificacion o ajuste, con la misma regla que el universo exportado al Administrador. Pagina por numeros (`limit` hasta 1000). Los numeros viajan como CADENA (DEC-010). AVISO: los numeros NO son el sorteo (DEC-017); el ganador lo elige el Administrador.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "entry.self.read" },
      schema: {
        querystring: entryNumbersQuerySchema,
        response: {
          200: entryNumbersPageSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const query = request.query as z.infer<typeof entryNumbersQuerySchema>;
        await requirePromotion(query.promotion_id);

        const flags = await domain.repositories.promotions.readFlags();
        if (!flags.visible_entry_numbers_enabled) {
          // 404 y no 403: la funcion no existe para nadie. Un 403 sugeriria que
          // existe y que a este participante no se le deja verla.
          throw ApiErrors.notFound();
        }

        const batches = await domain.repositories.entryNumbers.listBatchesForParticipant(
          query.promotion_id,
          principal.participantId,
        );
        const transactions = await domain.repositories.ledger.listForParticipant(
          query.promotion_id,
          principal.participantId,
        );
        const format = await domain.repositories.entryNumbers.getFormat(query.promotion_id);

        if (format === null && batches.length > 0) {
          // Un lote sin secuencia es imposible por construccion: la secuencia
          // nace con la primera asignacion (0037). NO se inventa una clave: un
          // numero derivado de otra no coincidiria con el que se exporta.
          throw new ApiError({ statusCode: 409, code: "ENTRY_NUMBER_FORMAT_NOT_CONFIGURED" });
        }

        // La MISMA regla que el congelado del export: lo que aqui sale vigente
        // es lo que entra en el universo del sorteo.
        const activity = computeEntryNumberActivity({
          batches,
          transactions,
          cutoff: domain.clock.now(),
          maxSequence: null,
        });
        const sources = new Map(transactions.map((row) => [row.id, row]));
        const cipher = format === null ? null : createEntryNumberCipher(format.key, format.digits);

        const position = readEntryNumberCursor(query.cursor, activity.batches);

        const items: z.infer<typeof entryNumberBatchSchema>[] = [];
        let remaining = query.limit;
        let next: { readonly batchId: string; readonly offset: number } | null = null;

        for (let index = position.batchIndex; index < activity.batches.length; index += 1) {
          const batch = activity.batches[index];
          const source = batch === undefined ? undefined : sources.get(batch.entryTransactionId);
          if (batch === undefined || source === undefined || cipher === null) {
            throw new Error("Lote de numeros sin su transaccion del ledger.");
          }
          const from = index === position.batchIndex ? position.offset : 0;
          if (remaining === 0) {
            next = { batchId: batch.batchId, offset: from };
            break;
          }
          const to = Math.min(batch.quantity, from + remaining);

          const numbers: z.infer<typeof entryNumberSchema>[] = [];
          for (let offset = from; offset < to; offset += 1) {
            numbers.push({
              number: cipher.encode(batch.range.start + BigInt(offset)),
              // Los vigentes son los PRIMEROS del rango (`entry-number-activity.ts`).
              active: offset < batch.activeQuantity,
            });
          }

          items.push({
            batch_id: batch.batchId,
            source_type: source.sourceType,
            awarded_at: source.effectiveAt.toISOString(),
            quantity: batch.quantity,
            active_quantity: batch.activeQuantity,
            numbers,
          });
          remaining -= to - from;

          if (to < batch.quantity) {
            next = { batchId: batch.batchId, offset: to };
            break;
          }
        }

        const activeNumbers = activity.batches.reduce((sum, row) => sum + row.activeQuantity, 0);
        const totalNumbers = activity.batches.reduce((sum, row) => sum + row.quantity, 0);

        return {
          promotion_id: query.promotion_id,
          digits: format?.digits ?? DEFAULT_ENTRY_NUMBER_DIGITS,
          active_numbers: activeNumbers,
          void_numbers: totalNumbers - activeNumbers,
          items,
          next_cursor:
            next === null ? null : encodeCursor({ sortKey: next.batchId, id: String(next.offset) }),
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
        "SIN fecha de nacimiento ni estado de residencia: lo declarado para la elegibilidad (DEC-067) no se devuelve en el perfil. Si la cuenta ya declaro lo dice `GET /me/eligibility`.",
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

    {
      method: "GET",
      url: "/api/v1/me/checkout-defaults",
      operationId: "getParticipantCheckoutDefaults",
      summary: "Datos con que se rellena la direccion del checkout (DEC-092).",
      description:
        "La direccion de envio del pedido mas reciente que llevaba una (`source = LAST_ORDER`); si no hay, el nombre de la cuenta y el estado declarado en el alta (`ACCOUNT`). Es para no volver a teclear lo que la persona ya dio: solo a ella misma, nada se guarda ni se decide aqui, y el pedido se congela con lo que envie al pagar. Es la unica lectura que devuelve el estado declarado, y solo como sugerencia de direccion.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.read" },
      schema: {
        response: {
          200: checkoutDefaultsSchema,
          401: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const [profile, lastAddress, declaration] = await Promise.all([
          domain.participants.findProfile(principal.participantId),
          domain.repositories.orders.findLatestShippingAddress(principal.participantId),
          dependencies.identity.identities.findEligibilityDeclaration(principal.participantId),
        ]);
        if (profile === null) {
          throw ApiErrors.unauthenticated();
        }

        const displayName =
          profile.display_name === null || profile.display_name.trim() === ""
            ? null
            : profile.display_name;
        const declaredState = declaration?.residenceState ?? null;

        if (lastAddress !== null) {
          return {
            source: "LAST_ORDER" as const,
            full_name: addressField(lastAddress, "full_name") ?? displayName,
            line1: addressField(lastAddress, "line1"),
            line2: addressField(lastAddress, "line2"),
            city: addressField(lastAddress, "city"),
            region: addressField(lastAddress, "region") ?? declaredState,
            postal_code: addressField(lastAddress, "postal_code"),
          };
        }
        return {
          source: "ACCOUNT" as const,
          full_name: displayName,
          line1: null,
          line2: null,
          city: null,
          region: declaredState,
          postal_code: null,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/me/eligibility",
      operationId: "getParticipantEligibility",
      summary:
        "Si el participante ya declaro su estado y su fecha de nacimiento (DEC-067, DEC-089).",
      description:
        "Solo dice SI declaro cada mitad y cuando, no lo declarado: la web lo necesita para pedir lo que falte antes de pagar, y no hace falta devolver la fecha de nacimiento para eso. `declared` es `true` solo con las dos mitades. Si es elegible no se responde aqui: depende de las reglas de cada promocion y se evalua al otorgar.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.read" },
      schema: {
        response: {
          200: eligibilityStatusSchema,
          401: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const declaration = await dependencies.identity.identities.findEligibilityDeclaration(
          principal.participantId,
        );
        return eligibilityStatusOf(declaration);
      },
    },

    {
      method: "PUT",
      url: "/api/v1/me/eligibility",
      operationId: "declareParticipantEligibility",
      summary:
        "Declarar lo que falte: el estado, la fecha de nacimiento o las dos (DEC-067, DEC-089).",
      description:
        "No reescribe: una mitad ya declarada con otro valor, o un envio que no anade nada, es 409 ELIGIBILITY_ALREADY_DECLARED, porque cambiar la fecha o el estado despues de comprar seria volverse elegible a posteriori. Al declarar el estado exige los consentimientos de `required_consents` (GET /config). Una fecha sin estado, en una cuenta que no lo declaro, es 422 ELIGIBILITY_STATE_REQUIRED.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.update" },
      schema: {
        body: eligibilityDeclarationBodySchema,
        response: {
          200: eligibilityStatusSchema,
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const body = request.body as z.infer<typeof eligibilityDeclarationBodySchema>;
        const now = new Date();

        if (body.date_of_birth !== undefined) assertDateOfBirth(body.date_of_birth, now);
        const consents =
          body.residence_state === undefined ? [] : assertConsents(body.consents ?? []);

        const { identities } = dependencies.identity;
        const outcome = await identities.declareEligibility({
          participantId: principal.participantId,
          residenceState: body.residence_state ?? null,
          dateOfBirth: body.date_of_birth ?? null,
          declaredAt: now,
          consents,
          locale: body.language,
        });

        if (outcome === "NOT_FOUND") throw ApiErrors.unauthenticated();
        if (outcome === "ALREADY_DECLARED") throw ApiErrors.eligibilityAlreadyDeclared();
        if (outcome === "STATE_REQUIRED") throw ApiErrors.eligibilityStateRequired();

        return eligibilityStatusOf(
          await identities.findEligibilityDeclaration(principal.participantId),
        );
      },
    },
  ];
}
