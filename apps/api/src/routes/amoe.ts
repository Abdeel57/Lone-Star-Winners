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

import { isSweepstakesError, principalHasCapability, type AmoeSubmission } from "@lsw/sweepstakes";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import { maskEmail } from "../http/pii.js";

/**
 * La capacidad que gobierna ver datos personales enmascarados.
 *
 * Literal y no importada de `@lsw/security` por la misma razon que en
 * `packages/sweepstakes/src/capabilities.ts`: aqui basta con la clave, y
 * `tests/security` ya compara este fichero contra el catalogo canonico.
 */
const PII_MASKED_CAPABILITY = "pii.view.masked";
import type { ParticipantPrincipal } from "../http/principal-narrow.js";
import { requireStaff, requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  amoeConfigSchema,
  amoeReviewItemSchema,
  amoeSubmissionSchema,
} from "../http/schemas-b5.js";
import {
  createAdminRulesRepository,
  StaffIdentityNotEligibleError,
  type AdminRulesRepository,
} from "../services/admin-rules.js";
import { domainServicesFor } from "../services/domain-registry.js";

const slugParamsSchema = z.object({ slug: z.string().min(1).max(120) });
const promotionParamsSchema = z.object({ promotion_id: z.uuid() });
const submissionParamsSchema = z.object({ submission_id: z.uuid() });
const reviewQuerySchema = z.object({ promotion_id: z.uuid() });

/**
 * La cola administrativa, con filtro de estado.
 *
 * POR QUE `PENDING_REVIEW` ES EL VALOR POR DEFECTO
 *   Porque es la lectura de trabajo: quien abre la cola quiere lo que espera
 *   decision. Sin el parametro la respuesta es EXACTAMENTE la de antes de
 *   existir este filtro -incluidos los `SUBMITTED`, que tambien esperan-, asi
 *   que ningun cliente cambia de comportamiento por este anadido.
 *
 * POR QUE HACE FALTA PODER PEDIR OTRO ESTADO
 *   Sin filtro, un envio decidido desaparecia de toda lectura administrativa:
 *   la cola devolvia solo lo pendiente, y con el envio se iban `granted_entries`
 *   y `applied_cap` -lo unico que explica por que una aprobacion concedio menos
 *   de lo anunciado-. Un expediente que no se puede volver a mirar no es
 *   auditable, y estos son registros promocionales regulados.
 *
 * `promotion_id` SIGUE SIENDO OBLIGATORIO. La cola es de UNA promocion: una
 * lectura sin promocion mezclaria expedientes de sorteos distintos en la misma
 * pantalla.
 *
 * Esquema NO estricto, como el resto de la API: un parametro que no se declara
 * se descarta en silencio en vez de romper la peticion.
 */
const adminReviewQuerySchema = reviewQuerySchema.extend({
  status: z
    .enum(["PENDING_REVIEW", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"])
    .default("PENDING_REVIEW"),
});

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

/**
 * `reason_key` OBLIGATORIO tambien al aprobar, no solo al rechazar.
 *
 * El catalogo marca `amoe.review.approve` con `requiresReason`, y el autorizador
 * lo exige ANTES del handler (HO-034.1). Sin este campo la ruta no podia pasar
 * la puerta con ningun cuerpo, y el 403 parecia un problema de permisos cuando
 * era un cuerpo al que le faltaba el campo que la puerta buscaba. Aprobar una
 * participacion que no paso por compra es la decision mas sensible de la via
 * gratuita: merece el mismo motivo que un rechazo.
 */
const approveBodySchema = z.object({
  reason_key: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Transcripcion de una ficha postal (contrato 13.10).
 *
 * `participant_email` es el de la FICHA, no el de quien teclea. Se normaliza
 * como en el registro y, si no hay participante con ese correo, se crea uno con
 * identidad `PENDING_VERIFICATION` y sin credenciales: las Official Rules no
 * exigen cuenta para la via gratuita, y exigirla convertiria el registro en un
 * requisito de participacion.
 */
const transcribeBodySchema = z.object({
  promotion_id: z.uuid(),
  participant_email: z.string().email().max(254),
  /**
   * El locale del participante nuevo. SIN valor por defecto: DEC-021 no admite
   * un idioma por defecto, y quien teclea la ficha sabe en que idioma la
   * escribio su titular. Se ignora si el participante ya existe.
   */
  preferred_locale: z.enum(["en-US", "es-US"]),
  payload: z.record(z.string().min(1).max(64), z.string().min(1).max(500)),
  /** Referencia del sobre, tal cual la anota el operador. Opaca para el sistema. */
  envelope_reference: z.string().min(1).max(120).nullable().default(null),
  /**
   * Cuantas fichas venian en ese sobre. El sistema NO cuenta sobres: compara
   * este numero con `mail_in.max_cards_per_envelope` y MARCA el envio si lo
   * supera, para que decida una persona. `null` = el operador no lo anoto.
   */
  cards_in_envelope: z.number().int().min(1).max(100).nullable().default(null),
});

const transcribeResultSchema = z.object({
  submission_id: z.uuid(),
  status: z.enum(["SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED", "CANCELLED"]),
  participant_id: z.uuid(),
  /** `true` si esta peticion creo el expediente del participante. */
  participant_created: z.boolean(),
  /** `true` si el sobre traia mas fichas de las que admite la configuracion. */
  flagged_envelope: z.boolean(),
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
    case "AMOE_MODE_NOT_ONLINE":
      throw ApiErrors.amoeModeNotOnline(error.details);
    case "AMOE_MODE_NOT_MAIL_IN":
      throw ApiErrors.amoeModeNotMailIn(error.details);
    case "AMOE_ENTRY_CAP_REACHED":
      // El envio sigue en la cola: lo unico que no cabe son las participaciones
      // (contrato 13.3). El revisor decide que hacer con el.
      throw ApiErrors.amoeEntryCapReached(error.details);
    case "SEPARATION_OF_DUTIES":
      throw ApiErrors.separationOfDuties(error.details);
    case "CAPABILITY_REQUIRED":
      // El dominio comprueba la capacidad una SEGUNDA vez, sobre el principal
      // ya resuelto. Si salta aqui es que la puerta y el catalogo discrepan, y
      // eso es un 403 honesto y no un 500.
      // La clave se comprueba antes de interpolarla: `details` es un objeto
      // libre del dominio y un `String(objeto)` en el cuerpo de un 403
      // produciria "[object Object]" en el mensaje que ve el operador.
      throw ApiErrors.forbidden(
        typeof error.details.capability === "string" ? error.details.capability : "amoe",
      );
    default:
      throw error;
  }
}

/**
 * `metadata` es JSON de origen externo, asi que se recorre a un `Map` antes de
 * consultarlo: con acceso indexado directo, una clave hostil leeria la cadena
 * de prototipos en vez del dato. Es el mismo criterio que aplica el dominio.
 */
function metadataOf(submission: AmoeSubmission): Map<string, unknown> {
  return new Map(Object.entries(submission.metadata));
}

/** Quien tecleo la ficha, o `null` si la envio su titular (DEC-054). */
function transcribedBy(submission: AmoeSubmission): string | null {
  const value = metadataOf(submission).get("transcribed_by_admin_user_id");
  return typeof value === "string" ? value : null;
}

function envelopeFlagged(submission: AmoeSubmission): boolean {
  return metadataOf(submission).get("flag") === "ENVELOPE_LIMIT_EXCEEDED";
}

/**
 * El recorte por tope anotado en `metadata.applied_cap` de una transaccion.
 *
 * Se valida campo a campo en vez de castearlo: `metadata` es JSON persistido y
 * una fila antigua -o escrita por otra version- puede no tener esta forma. Una
 * forma inesperada devuelve `null`, que significa "no consta recorte", en vez
 * de romper la pantalla del revisor con un error de tipos.
 */
export function readAppliedCap(metadata: Readonly<Record<string, unknown>>): {
  readonly kind: string;
  readonly limit: number;
  readonly requested: number;
  readonly granted: number;
} | null {
  const raw = new Map(Object.entries(metadata)).get("applied_cap");
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const fields = new Map(Object.entries(raw as Record<string, unknown>));
  const kind = fields.get("kind");
  const limit = fields.get("limit");
  const requested = fields.get("requested");
  const granted = fields.get("granted");

  if (
    typeof kind !== "string" ||
    typeof limit !== "number" ||
    typeof requested !== "number" ||
    typeof granted !== "number"
  ) {
    return null;
  }
  return { kind, limit, requested, granted };
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

  /**
   * Resolucion del participante por correo, para la transcripcion postal.
   *
   * Perezosa: el emisor del contrato construye las definiciones de ruta sin
   * base de datos, y un repositorio construido aqui arriba reventaria alli.
   */
  let rulesRepository: AdminRulesRepository | null = null;
  const rulesRepo = (): AdminRulesRepository => {
    rulesRepository ??= createAdminRulesRepository(dependencies.database.db);
    return rulesRepository;
  };

  /**
   * Lo que genero un envio aprobado, leido del LEDGER.
   *
   * Nunca de un contador ni de la configuracion: la cifra que importa es la que
   * se escribio, que puede ser menor que la que la version de reglas prometia
   * si el tope por participante recorto. El recorte viaja junto, en
   * `applied_cap`, porque sin el la diferencia no se puede explicar.
   */
  async function grantedFor(submission: AmoeSubmission): Promise<{
    readonly entries: number | null;
    readonly appliedCap: z.infer<typeof amoeReviewItemSchema>["applied_cap"];
  }> {
    if (submission.entryTransactionId === null) {
      return { entries: null, appliedCap: null };
    }
    const transaction = await domain.repositories.ledger.findById(submission.entryTransactionId);
    if (transaction === null) {
      return { entries: null, appliedCap: null };
    }
    return {
      entries: transaction.quantityDelta,
      appliedCap: readAppliedCap(transaction.metadata),
    };
  }

  /** Entries que genero un envio aprobado. Se conserva por comodidad de lectura. */
  async function entriesFor(submission: AmoeSubmission): Promise<number | null> {
    return (await grantedFor(submission)).entries;
  }

  return [
    {
      method: "GET",
      url: "/api/v1/promotions/:slug/amoe-config",
      operationId: "getAmoeConfig",
      summary: "Modalidad AMOE vigente y lo que exige.",
      description:
        "`mode` es un enum precisamente porque las cuatro modalidades exigen pantallas distintas; un booleano no permitiria decidir cual renderizar. Con el flag apagado responde `enabled: false` y nada mas, salvo `promotion_id`. `required_fields` sale de `identity_requirements`, para que el formulario no invente ningun campo; `instructions` es texto LEGALMENTE CONTROLANTE publicado por el abogado en la version de reglas -el sistema no lo redacta, y si no esta configurado responde `null`-.",
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
            promotion_id: view.promotionId,
            mode: view.mode,
            submission_window: {
              opens_at: view.windowStartsAt,
              closes_at: view.windowEndsAt,
            },
            identity_requirements: [...view.identityRequirements],
            required_fields:
              view.requiredFields === null
                ? null
                : view.requiredFields.map((field) => ({
                    key: field.key,
                    type: field.type,
                    required: field.required,
                    label_key: field.labelKey,
                    max_length: field.maxLength,
                  })),
            // Texto legal, copiado tal cual. El backend no lo redacta, no lo
            // traduce y no lo recorta: lo publica el abogado en la version de
            // reglas y aqui solo cambia de forma.
            instructions: view.instructions === null ? null : { ...view.instructions },
            external_url: view.externalUrl,
            entries_per_approved_submission: view.entriesPerApprovedSubmission,
            requires_review: view.requiresReview,
            max_per_participant_per_period: view.maxPerParticipantPerPeriod,
            limit_period: view.limitPeriod,
            // Plazos de la via postal, tal y como los escribio el abogado. El
            // sistema no cuenta sobres ni comprueba matasellos: los publica.
            mail_in:
              view.mailIn === null
                ? null
                : {
                    max_cards_per_envelope: view.mailIn.max_cards_per_envelope,
                    postmark_by: view.mailIn.postmark_by,
                    received_by: view.mailIn.received_by,
                  },
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
      summary: "Cola de revision de envios AMOE, filtrable por estado.",
      description:
        "Sin `status` devuelve la COLA DE TRABAJO: lo que espera decision -`SUBMITTED` y `PENDING_REVIEW`-, que es el valor por defecto `PENDING_REVIEW`. Con `status` consulta ese estado exacto, y es asi como se vuelve a mirar un envio ya decidido: sin el filtro, una aprobacion se llevaba consigo `granted_entries` y `applied_cap`, que son la unica explicacion de por que concedio menos de lo anunciado. Nunca devuelve el payload del envio.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "amoe.review.read" },
      schema: {
        querystring: adminReviewQuerySchema,
        response: {
          200: pageSchema(amoeReviewItemSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof adminReviewQuerySchema>;

        const submissions = await domain.amoe.reviewQueue(query.promotion_id, staff, query.status);

        // El actor de la sesion, para poder decir "esta la tecleaste tu" sin
        // publicar su identificador en la respuesta.
        const viewer = staff.actor.type === "ADMIN" ? staff.actor.adminUserId : null;

        // EL CORREO EXIGE `pii.view.masked`, ADEMAS DE `amoe.review.read`.
        //
        // Que hoy todos los roles con la segunda tengan tambien la primera es
        // una coincidencia del reparto de roles, no una garantia: manana entra
        // un rol de solo-cola y se lleva el correo sin que nadie lo decida. La
        // capacidad se comprueba sobre el principal ya resuelto, que es donde
        // se sabe que tiene esta sesion; la ruta no puede declararla porque
        // entonces quien no la tuviera no veria la cola en absoluto.
        const canSeePii = principalHasCapability(staff, PII_MASKED_CAPABILITY);

        // UNA lectura de perfil por PARTICIPANTE, no por fila: una cola con
        // cinco fichas de la misma persona haria cinco consultas identicas. Y
        // solo si se va a publicar: sin capacidad no se lee siquiera.
        const emails = new Map<string, string | null>();
        if (canSeePii) {
          for (const participantId of new Set(submissions.map((row) => row.participantId))) {
            const profile = await domain.participants.findProfile(participantId);
            // Enmascarado en la FRONTERA, nunca en el navegador: el dato que no
            // se puede ver no se envia (ver `http/pii.ts`).
            emails.set(participantId, maskEmail(profile?.email ?? null));
          }
        }

        // UNA sola pasada de proyeccion para toda la cola, y no una por fila.
        // Ademas de barata, es la que hace que dos filas del mismo participante
        // ensenen el mismo saldo previo: calculadas por separado, cada una
        // leeria el ledger en un instante distinto y la pantalla se
        // contradiria consigo misma.
        const projections = await domain.amoe.approvalProjections(submissions);

        const items = await Promise.all(
          submissions.map(async (submission) => {
            const projection = projections.get(submission.id);
            const granted = await grantedFor(submission);
            return {
              ...presentSubmission(submission, granted.entries),
              granted_entries: granted.entries,
              applied_cap: granted.appliedCap,
              participant_id: submission.participantId,
              period_bucket: submission.periodBucket,
              flagged_duplicate: Object.prototype.hasOwnProperty.call(
                submission.metadata,
                "duplicate_of_submission_id",
              ),
              // `?? 0` solo para satisfacer al tipo: `approvalProjections`
              // devuelve una entrada por cada envio que recibe, y estos son
              // exactamente los que recibio. Un hueco aqui seria un fallo de
              // programacion, no un estado del dominio.
              entries_before: projection?.entriesBefore ?? 0,
              entries_if_approved: projection?.entriesIfApproved ?? null,
              entries_after_if_approved: projection?.entriesAfterIfApproved ?? null,
              cap_applies: projection?.capApplies ?? false,
              entries_if_approved_after_cap: projection?.entriesIfApprovedAfterCap ?? null,
              participant_email: emails.get(submission.participantId) ?? null,
              // El identificador CRUDO del transcriptor no se publica:
              // `transcribed_by_me` ya resuelve lo que la interfaz necesita, y
              // el id se lo llevaba cualquiera con `amoe.review.read` -incluido
              // SUPPORT, que no tiene `rbac.admin.read`-.
              transcribed_by_me: viewer !== null && transcribedBy(submission) === viewer,
              flagged_envelope: envelopeFlagged(submission),
            };
          }),
        );

        return { items, next_cursor: null };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/amoe-submissions",
      operationId: "transcribeAmoeSubmission",
      summary: "Transcribir una ficha AMOE recibida por correo.",
      description:
        "Reutiliza el MISMO camino que un envio propio -ventana, huella, limite por periodo y politica de duplicados- y solo anade procedencia: quien la tecleo, de que sobre salio y cuantas fichas venian. NO concede participaciones: el envio entra en la cola. Quien transcribe no puede aprobar lo que transcribio (409 SEPARATION_OF_DUTIES). Si el participante no existe, se le crea una identidad PENDING_VERIFICATION SIN credenciales: las Official Rules no exigen cuenta para la via gratuita.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "amoe.submission.transcribe" },
      schema: {
        body: transcribeBodySchema,
        response: {
          201: transcribeResultSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const body = request.body as z.infer<typeof transcribeBodySchema>;

        // El locale del participante nuevo sale de la peticion, no de un
        // default: DEC-021 no admite un idioma por defecto, y quien teclea la
        // ficha sabe en que idioma la escribio su titular.
        const preferredLocale = body.preferred_locale;

        try {
          const outcome = await domain.repositories.unitOfWork.withTransaction(async () => {
            const participant = await rulesRepo().findOrCreateParticipantByEmail(
              body.participant_email,
              preferredLocale,
            );

            const submitted = await domain.amoe.submitOnBehalf(
              {
                promotionId: body.promotion_id,
                participantId: participant.participantId,
                payload: body.payload,
                // Quien teclea NO viaja en el cuerpo: lo deriva el dominio del
                // principal (S-01). Si lo eligiera quien transcribe, podria
                // firmar con el id de un companero y aprobar la ficha el solo.
                envelopeReference: body.envelope_reference,
                cardsInEnvelope: body.cards_in_envelope,
              },
              staff.principal,
            );

            return { participant, submitted };
          });

          void reply.code(201);
          return {
            submission_id: outcome.submitted.submission.id,
            status: outcome.submitted.submission.status,
            participant_id: outcome.participant.participantId,
            participant_created: outcome.participant.created,
            flagged_envelope: envelopeFlagged(outcome.submitted.submission),
          };
        } catch (error) {
          // Las Official Rules excluyen a empleados y afiliados: no se le
          // cuelga un expediente de participante a una identidad de personal.
          if (error instanceof StaffIdentityNotEligibleError) {
            throw ApiErrors.amoeParticipantIneligibleStaff();
          }
          return translateAmoeError(error);
        }
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
