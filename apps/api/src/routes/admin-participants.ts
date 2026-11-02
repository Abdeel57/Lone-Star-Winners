/**
 * Participantes vistos desde el panel (HO-034 punto 5).
 *
 * ---------------------------------------------------------------------------
 * TRES RUTAS, TRES CAPACIDADES, TRES FORMAS DE RESPUESTA
 * ---------------------------------------------------------------------------
 *
 *   GET /admin/participants ................. `participant.list`  PII enmascarada
 *   GET /admin/participants/:id ............. `participant.read`  PII enmascarada
 *   GET /admin/participants/:id/pii ......... `pii.view.full`     PII completa
 *
 * POR QUE LA FORMA COMPLETA ES UNA RUTA APARTE Y NO UN `?pii=full`
 *
 *   Porque el registro de rutas de DEC-015 declara la capacidad POR (metodo,
 *   camino). Un parametro de query que cambiara la capacidad exigida pondria en
 *   manos del cliente la eleccion de con que permiso se le juzga, que es
 *   exactamente lo que un registro deny-by-default existe para impedir: el
 *   autorizador se ejecuta ANTES del handler y no puede leer una decision que
 *   todavia no se ha tomado. Con dos caminos, cada forma de respuesta tiene su
 *   capacidad declarada, el manifiesto la publica y el test de contrato la ve.
 *
 * POR QUE NO SE DESENMASCARA "SI EL ACTOR TIENE LA CAPACIDAD"
 *
 *   `pii.view.full` esta marcada en el catalogo con `requiresStepUp` y
 *   `requiresReason`. Mirar la lista de capacidades del principal dentro del
 *   handler y devolver el correo entero saltaria las dos condiciones sin que
 *   nada lo delatara: el actor tendria la capacidad, pero no habria demostrado
 *   un segundo factor reciente ni dejado un motivo en la traza. Al declararla en
 *   la ruta, esas dos comprobaciones son del autorizador, que es de quien deben
 *   ser.
 *
 * ---------------------------------------------------------------------------
 * LA RUTA DE PII COMPLETA YA NO RESPONDE 403 POR CONSTRUCCION (HO-034.1)
 * ---------------------------------------------------------------------------
 *
 * Durante un tiempo si lo hizo: `session-authorizer.ts` pasaba
 * `reasonProvided: false` como constante, asi que toda capacidad con
 * `requiresReason` -y `pii.view.full` es una de ellas- se denegaba para todo el
 * mundo. La ruta se registro igualmente y NO se degrado a una capacidad mas
 * debil "para que funcionase": el 403 era la respuesta correcta mientras el
 * motivo no viajase.
 *
 * Ahora el motivo viaja. Como es un GET y no tiene cuerpo donde ponerlo, se
 * manda en la cabecera `X-LSW-Reason-Code`, con la MISMA forma que el
 * `reason_code` que se persiste en `audit_events`. Sin ella la ruta sigue
 * respondiendo 403, y eso no es un fallo: es el control funcionando.
 *
 * Sigue haciendo falta ademas un segundo factor reciente, que es la otra
 * condicion que el catalogo pone a `pii.view.full` y que nada de esto relaja.
 *
 * ---------------------------------------------------------------------------
 * `pii_masked` ES UN DATO, NO UNA DEDUCCION DEL FRONTEND
 * ---------------------------------------------------------------------------
 *
 * La respuesta dice si lo que lleva esta enmascarado. Sin ese campo, un correo a
 * medias en pantalla parece un dato corrupto y no una decision deliberada, y la
 * persona que opera no sabe si esta viendo poco porque no puede o porque el dato
 * esta mal.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import { maskEmail, maskPhone } from "../http/pii.js";
import { requireStaff, requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { adminReadsFor } from "../services/admin-reads.js";
import { domainServicesFor } from "../services/domain-registry.js";
import { normalizeUsPhone } from "../services/phone.js";
import type { AdminParticipantRow } from "@lsw/database";
import type { DomainActor } from "@lsw/sweepstakes";

const participantParamsSchema = z.object({ participant_id: z.uuid() });

/**
 * DEC-097: el celular de CONTACTO que teclea el personal. Mismo tope de forma
 * que el de la tienda; lo que cuenta es `normalizeUsPhone` (solo EE. UU.).
 */
const contactPhoneBodySchema = z.object({ phone: z.string().trim().min(7).max(32) });

const contactPhoneResponseSchema = z.object({
  participant_id: z.uuid(),
  /** El celular de contacto ya guardado, en E.164. */
  phone: z.string(),
});

/**
 * Fila del listado.
 *
 * `email` es `string` y no `string | null`: una cuenta anonimizada no tiene
 * correo, y publicar `null` obligaria al panel a inventarse que pintar. Se sirve
 * cadena vacia, que es "no hay", frente a `a***@dominio`, que es "hay y esta
 * oculto".
 */
const participantRowSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  disqualified: z.boolean(),
  /** `true` cuando el backend ha ocultado el PII de esta fila. */
  pii_masked: z.boolean(),
});

/**
 * Ficha. Anade el estado operativo, que es lo que soporte necesita para saber
 * por que alguien no puede hacer algo, y NO anade ni una linea de pedido ni una
 * cifra del ledger: para eso estan `order.read` y `entry.ledger.read`, con sus
 * propias rutas y sus propias capacidades.
 */
const participantDetailSchema = participantRowSchema.extend({
  phone: z.string().nullable(),
  preferred_locale: z.string(),
  status: z.string(),
  review_state: z.string(),
});

function toRow(row: AdminParticipantRow): {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  disqualified: boolean;
  pii_masked: boolean;
} {
  return {
    id: row.id,
    email: maskEmail(row.email) ?? "",
    display_name: row.displayName,
    created_at: row.createdAt.toISOString(),
    disqualified: row.disqualified,
    pii_masked: true,
  };
}

export function buildAdminParticipantRoutes(dependencies: AppDependencies): RouteDefinition[] {
  return [
    {
      method: "GET",
      url: "/api/v1/admin/participants",
      operationId: "listAdminParticipants",
      summary: "Participantes, con el PII enmascarado.",
      description:
        "Paginado por cursor opaco, mas recientes primero. `pii_masked` es siempre `true` en esta ruta: la forma completa vive detras de `pii.view.full`, en `/admin/participants/{participant_id}/pii`.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "participant.list" },
      schema: {
        querystring: paginationQuerySchema,
        response: {
          200: pageSchema(participantRowSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof paginationQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;

        const rows = await adminReadsFor(dependencies).listParticipants({
          limit: query.limit + 1,
          after,
        });

        const page = buildPage(rows, query.limit, (row) => ({
          sortKey: row.createdAt.toISOString(),
          id: row.id,
        }));

        return { items: page.items.map(toRow), next_cursor: page.next_cursor };
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/participants/:participant_id",
      operationId: "getAdminParticipant",
      summary: "Ficha de un participante, con el PII enmascarado.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "participant.read" },
      schema: {
        params: participantParamsSchema,
        response: {
          200: participantDetailSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof participantParamsSchema>;

        const row = await adminReadsFor(dependencies).findParticipant(params.participant_id);
        if (row === null) {
          throw ApiErrors.notFound();
        }

        return {
          ...toRow(row),
          phone: maskPhone(row.phoneE164),
          preferred_locale: row.preferredLocale,
          status: row.status,
          review_state: row.reviewState,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/participants/:participant_id/pii",
      operationId: "getAdminParticipantPii",
      summary: "Datos personales completos de un participante.",
      description:
        "Misma ficha, sin enmascarar. `pii.view.full` exige segundo factor reciente y motivo (DEC-006, DEC-027), asi que HOY responde 403 mientras el autorizador de sesion no evalue el motivo (HO-034 punto 1).",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "pii.view.full" },
      schema: {
        params: participantParamsSchema,
        response: {
          200: participantDetailSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof participantParamsSchema>;

        const row = await adminReadsFor(dependencies).findParticipant(params.participant_id);
        if (row === null) {
          throw ApiErrors.notFound();
        }

        return {
          id: row.id,
          email: row.email ?? "",
          display_name: row.displayName,
          created_at: row.createdAt.toISOString(),
          disqualified: row.disqualified,
          // `false`, y es la unica diferencia observable con la ruta de arriba:
          // quien lea la respuesta sabe que esto NO esta enmascarado.
          pii_masked: false,
          phone: row.phoneE164,
          preferred_locale: row.preferredLocale,
          status: row.status,
          review_state: row.reviewState,
        };
      },
    },

    {
      method: "PUT",
      url: "/api/v1/admin/participants/:participant_id/contact-phone",
      operationId: "setAdminParticipantContactPhone",
      summary: "Anadir o cambiar el celular de CONTACTO de un cliente.",
      description:
        "DEC-097. Para los clientes que se dieron de alta con correo y no tienen celular: activa WhatsApp, SMS y llamadas en la tarjeta del pedido. Es el celular de contacto (`participants.phone_e164`, sin verificar), NO el de acceso: no deja entrar en la cuenta; ese solo lo anade el propio cliente con un codigo SMS (`POST /me/phone/verify`). Solo numeros de EE. UU. (422 PHONE_INVALID). 409 PARTICIPANT_ANONYMIZED si el cliente borro sus datos: no se le vuelve a poner un dato personal. Cada cambio emite `participant.contact_phone.updated` con el numero anterior y el nuevo enmascarados.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "participant.contact.update" },
      schema: {
        params: participantParamsSchema,
        body: contactPhoneBodySchema,
        response: {
          200: contactPhoneResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof participantParamsSchema>;
        const body = request.body as z.infer<typeof contactPhoneBodySchema>;

        const phone = normalizeUsPhone(body.phone);
        if (phone === null) throw ApiErrors.phoneInvalid();

        const domain = domainServicesFor(dependencies);
        const result = await domain.participants.setContactPhone(params.participant_id, phone);
        if (result === null) throw ApiErrors.notFound();
        if (result === "ANONYMIZED") throw ApiErrors.participantAnonymized();

        // Es PII y la capacidad se audita: quien cambio el contacto de quien,
        // cuando, y los dos numeros ENMASCARADOS -la traza no guarda el dato
        // que protege-.
        const actor: DomainActor = { type: "ADMIN", adminUserId: staff.adminUserId };
        await domain.audit.emit({
          action: "participant.contact_phone.updated",
          actor,
          promotionId: null,
          targetEntityType: "Participant",
          targetEntityId: params.participant_id,
          reasonKey: null,
          reasonDetail: null,
          occurredAt: domain.clock.now(),
          metadata: { previous: maskPhone(result.previous), current: maskPhone(phone) },
        });

        return { participant_id: params.participant_id, phone };
      },
    },
  ];
}
