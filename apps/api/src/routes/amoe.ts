/**
 * AMOE: la via de participacion SIN COMPRA.
 *
 * ---------------------------------------------------------------------------
 * ESTA SECCION NO DECIDE NADA LEGAL
 * ---------------------------------------------------------------------------
 *
 * Ni la modalidad, ni la ventana, ni el limite por persona, ni cuantas
 * participaciones vale un envio aprobado. Todo eso sale de
 * `PromotionRulesVersion.config` (DEC-012) y lo fija el abogado del cliente;
 * `docs/LEGAL_PENDING.md` -> "AMOE mechanism" sigue en TBD.
 *
 * El flag `amoe_enabled` arranca apagado (DEC-032). Con el apagado, la
 * configuracion publica responde `enabled: false` SIN filtrar ningun otro
 * parametro -si la via no existe, sus parametros tampoco son asunto de nadie- y
 * el envio responde 404: la funcion no existe, y eso no es un error.
 *
 * ---------------------------------------------------------------------------
 * UN ENVIO APROBADO GENERA LAS MISMAS ENTRIES QUE UNA COMPRA
 * ---------------------------------------------------------------------------
 *
 * Mismo ledger, mismo universo elegible, `source_type = 'AMOE'` para conservar
 * la procedencia (principio 9). No hay un segundo saldo ni una segunda tabla.
 * La aprobacion escribe una fila; nunca incrementa un contador.
 *
 * ---------------------------------------------------------------------------
 * LA CANTIDAD SALE DE LAS REGLAS DE ENTONCES
 * ---------------------------------------------------------------------------
 *
 * `AmoeService.approve` usa la version de reglas BAJO LA QUE SE ENVIO, no la
 * vigente hoy. Si entre el envio y la revision se publicara una version nueva
 * con otra cantidad, aplicar la nueva cambiaria retroactivamente lo que valia un
 * envio ya hecho. Es el mismo principio que DEC-007 aplica a los reversals.
 */

import { isSweepstakesError, type AmoeSubmission } from "@lsw/sweepstakes";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import type { ParticipantPrincipal } from "../http/principal-narrow.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  amoeConfigSchema,
  amoeReviewItemSchema,
  amoeSubmissionSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";

const slugParamsSchema = z.object({ slug: z.string().min(1).max(120) });
const promotionParamsSchema = z.object({ promotion_id: z.uuid() });
const submissionParamsSchema = z.object({ submission_id: z.uuid() });
const reviewQuerySchema = z.object({ promotion_id: z.uuid() });

/**
 * Cuerpo del envio.
 *
 * `payload` es un mapa de clave a TEXTO, no un objeto con forma fija: las
 * cuatro modalidades piden datos distintos y cual aplica lo dira el abogado.
 * Las claves obligatorias las declara `identity_requirements` en la
 * configuracion, y el dominio las comprueba; tiparlas aqui seria inventar el
 * requisito legal antes de que exista.
 */
const submitBodySchema = z.object({
  payload: z.record(z.string().min(1).max(64), z.string().min(1).max(500)),
});

const rejectBodySchema = z.object({
  /** DEC-022: clave estable, obligatoria. Un rechazo sin motivo no es auditable. */
  reason_key: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  notes: z.string().max(2000).nullable().optional(),
});

const approveBodySchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

async function requireParticipant(request: FastifyRequest): Promise<ParticipantPrincipal> {
  const principal = await request.server.lswPrincipalResolver(request);

  // En POSITIVO, y anotado (HO-027): la forma negada con `||` sobre `null`
  // dispara `prefer-optional-chain`, y una reescritura automatica de esa regla
  // ya abrio una vez un agujero de autenticacion en este repositorio.
  const isParticipant = principal !== null && principal.kind === "PARTICIPANT";
  if (!isParticipant) {
    throw ApiErrors.unauthenticated();
  }
  return principal;
}

/**
 * Traduce los rechazos del dominio a codigos del contrato.
 *
 * Uno a uno, y no con un `catch` generico: `AMOE_WINDOW_CLOSED` y
 * `AMOE_LIMIT_REACHED` son estados normales que la interfaz pinta distinto, y
 * un 500 haria que un limite alcanzado pareciera una averia.
 */
function translateAmoeError(error: unknown): never {
  if (!isSweepstakesError(error)) {
    throw error;
  }
  switch (error.code) {
    case "AMOE_NOT_ENABLED":
      throw ApiErrors.notFound();
    case "AMOE_WINDOW_CLOSED":
      throw new ApiError({ statusCode: 409, code: "AMOE_WINDOW_CLOSED" });
    case "AMOE_PERIOD_LIMIT_REACHED":
      throw new ApiError({ statusCode: 409, code: "AMOE_LIMIT_REACHED", details: error.details });
    case "AMOE_DUPLICATE_SUBMISSION":
      throw new ApiError({ statusCode: 409, code: "AMOE_DUPLICATE_SUBMISSION" });
    case "AMOE_SUBMISSION_NOT_FOUND":
      throw new ApiError({ statusCode: 404, code: "AMOE_SUBMISSION_NOT_FOUND" });
    case "AMOE_SUBMISSION_NOT_REVIEWABLE":
      throw new ApiError({ statusCode: 409, code: "AMOE_SUBMISSION_NOT_REVIEWABLE" });
    case "AMOE_PAYLOAD_INVALID":
      throw ApiErrors.validationFailed([error.details]);
    case "AMOE_CONFIG_INVALID":
    case "AMOE_MODE_NOT_CONFIGURED":
      // El flag esta encendido pero la configuracion legal no esta completa.
      // Codigo propio: si se confundiera con un 500, nadie investigaria que la
      // promocion se activo con AMOE a medio configurar.
      throw new ApiError({ statusCode: 409, code: "AMOE_CONFIG_INVALID" });
    default:
      throw error;
  }
}

function presentSubmission(
  submission: AmoeSubmission,
  entriesAwarded: number | null,
): z.infer<typeof amoeSubmissionSchema> {
  return {
    submission_id: submission.id,
    promotion_id: submission.promotionId,
    status: submission.status,
    mode: submission.mode,
    submitted_at: submission.submittedAt.toISOString(),
    entries_awarded: entriesAwarded,
  };
}

export function buildAmoeRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const domain = domainServicesFor(dependencies);
  const { repositories } = dependencies;

  /** Entries que genero un envio aprobado, leidas del ledger. Nunca de un contador. */
  async function entriesFor(submission: AmoeSubmission): Promise<number | null> {
    if (submission.entryTransactionId === null) {
      return null;
    }
    const transaction = await domain.repositories.ledger.findById(submission.entryTransactionId);
    return transaction?.quantityDelta ?? null;
  }

  return [
    {
      method: "GET",
      url: "/api/v1/promotions/:slug/amoe-config",
      operationId: "getAmoeConfig",
      summary: "Modalidad AMOE vigente y lo que exige.",
      description:
        "`mode` es un enum precisamente porque las cuatro modalidades exigen pantallas distintas; un booleano no permitiria decidir cual renderizar. Con el flag apagado responde `enabled: false` y nada mas.",
      tags: ["amoe"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "La via SIN COMPRA tiene que ser visible sin cuenta: exigir sesion para saber como participar gratis convertiria la cuenta en un requisito de participacion, que es justo lo que AMOE existe para evitar.",
      },
      schema: {
        params: slugParamsSchema,
        response: {
          200: amoeConfigSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const params = request.params as z.infer<typeof slugParamsSchema>;
        const promotion = await repositories.promotions.findBySlug(params.slug);
        if (promotion === null) {
          throw ApiErrors.promotionNotFound(params.slug);
        }

        try {
          const view = await domain.amoe.configView(promotion.id);
          return {
            enabled: view.enabled,
            mode: view.mode,
            submission_window: {
              opens_at: view.windowStartsAt,
              closes_at: view.windowEndsAt,
            },
            identity_requirements: [...view.identityRequirements],
            entries_per_approved_submission: view.entriesPerApprovedSubmission,
            requires_review: view.requiresReview,
            max_per_participant_per_period: view.maxPerParticipantPerPeriod,
            limit_period: view.limitPeriod,
          };
        } catch (error) {
          return translateAmoeError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/promotions/:promotion_id/amoe-submissions",
      operationId: "submitAmoeEntry",
      summary: "Enviar una participacion sin compra.",
      description:
        "Una participacion aprobada genera entries del MISMO tipo que una compra, con `source_type: AMOE`. Un solo universo, con procedencia. La aprobacion crea una transaccion del ledger; nunca incrementa un contador.",
      tags: ["amoe"],
      authorization: { kind: "PERMISSION", permission: "amoe.self.submit" },
      schema: {
        params: promotionParamsSchema,
        body: submitBodySchema,
        response: {
          201: amoeSubmissionSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const principal = await requireParticipant(request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const body = request.body as z.infer<typeof submitBodySchema>;

        try {
          const outcome = await domain.repositories.unitOfWork.withTransaction(() =>
            domain.amoe.submit({
              promotionId: params.promotion_id,
              participantId: principal.participantId,
              payload: body.payload,
            }),
          );

          void reply.code(201);
          return presentSubmission(
            outcome.submission,
            outcome.status === "APPROVED" ? outcome.entries : null,
          );
        } catch (error) {
          return translateAmoeError(error);
        }
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/amoe-submissions",
      operationId: "listOwnAmoeSubmissions",
      summary: "Envios AMOE del propio participante.",
      description:
        "No devuelve el payload: contiene datos personales y el participante ya sabe lo que envio. Lo que necesita es el ESTADO.",
      tags: ["amoe"],
      // No hay capacidad de LECTURA de los envios propios en el catalogo
      // (`amoe.self.submit` es de escritura). Se declara como recurso propio del
      // participante, que es lo que es, en vez de reutilizar una capacidad de
      // escritura para leer o de inventar una que nadie podria conceder.
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        querystring: reviewQuerySchema,
        response: {
          200: pageSchema(amoeSubmissionSchema),
          401: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const query = request.query as z.infer<typeof reviewQuerySchema>;

        const submissions = await domain.repositories.amoe.listForParticipant(
          query.promotion_id,
          principal.participantId,
        );

        const items = await Promise.all(
          submissions.map(async (submission) =>
            presentSubmission(submission, await entriesFor(submission)),
          ),
        );

        return { items, next_cursor: null };
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/amoe-submissions",
      operationId: "listAmoeReviewQueue",
      summary: "Cola de revision de envios AMOE.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "amoe.review.read" },
      schema: {
        querystring: reviewQuerySchema,
        response: {
          200: pageSchema(amoeReviewItemSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof reviewQuerySchema>;

        const submissions = await domain.amoe.reviewQueue(query.promotion_id, staff);

        const items = await Promise.all(
          submissions.map(async (submission) => ({
            ...presentSubmission(submission, await entriesFor(submission)),
            participant_id: submission.participantId,
            period_bucket: submission.periodBucket,
            flagged_duplicate: Object.prototype.hasOwnProperty.call(
              submission.metadata,
              "duplicate_of_submission_id",
            ),
          })),
        );

        return { items, next_cursor: null };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/amoe-submissions/:submission_id/approve",
      operationId: "approveAmoeSubmission",
      summary: "Aprobar un envio AMOE y generar sus participaciones.",
      description:
        "La cantidad sale de la version de reglas BAJO LA QUE SE ENVIO, no de la vigente hoy: aplicar la nueva cambiaria retroactivamente lo que valia un envio ya hecho.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "amoe.review.approve" },
      schema: {
        params: submissionParamsSchema,
        body: approveBodySchema,
        response: {
          200: amoeSubmissionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof submissionParamsSchema>;
        const body = request.body as z.infer<typeof approveBodySchema>;

        try {
          // Cambio de estado y fila de ledger en la MISMA transaccion: si el
          // envio quedara aprobado y la fila fallara, habria un expediente que
          // dice "aprobado" sin participaciones que lo respalden.
          const outcome = await domain.repositories.unitOfWork.withTransaction(() =>
            domain.amoe.approve(params.submission_id, staff, body.notes ?? null),
          );

          return presentSubmission(
            outcome.submission,
            outcome.status === "APPROVED" ? outcome.entries : null,
          );
        } catch (error) {
          return translateAmoeError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/amoe-submissions/:submission_id/reject",
      operationId: "rejectAmoeSubmission",
      summary: "Rechazar un envio AMOE, con motivo obligatorio.",
      description:
        "Un envio rechazado NO consume cuota del limite por periodo: si consumiera, un rechazo por un dato mal tecleado dejaria a la persona sin poder participar ese dia.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "amoe.review.reject" },
      schema: {
        params: submissionParamsSchema,
        body: rejectBodySchema,
        response: {
          200: amoeSubmissionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof submissionParamsSchema>;
        const body = request.body as z.infer<typeof rejectBodySchema>;

        try {
          const rejected = await domain.amoe.reject(
            params.submission_id,
            staff,
            body.reason_key,
            body.notes ?? null,
          );
          return presentSubmission(rejected, null);
        } catch (error) {
          return translateAmoeError(error);
        }
      },
    },
  ];
}
