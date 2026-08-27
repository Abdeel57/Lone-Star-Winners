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
 * LIMITACION DECLARADA: LA RUTA DE PII COMPLETA HOY RESPONDE 403 (HO-034.1)
 * ---------------------------------------------------------------------------
 *
 * `session-authorizer.ts` pasa `reasonProvided: false` a `authorize()`, asi que
 * toda capacidad con `requiresReason` -y `pii.view.full` es una de ellas- se
 * deniega hoy. La ruta se registra igualmente y NO se degrada a una capacidad
 * mas debil para "que funcione": el 403 es la respuesta correcta mientras el
 * motivo no viaje. Se levantara sola cuando se cierre HO-034 punto 1, que es de
 * otra sesion.
 *
 * Las otras dos rutas no dependen de eso: `participant.list` y
 * `participant.read` no exigen motivo ni step-up.
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
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { adminReadsFor } from "../services/admin-reads.js";
import type { AdminParticipantRow } from "@lsw/database";

const participantParamsSchema = z.object({ participant_id: z.uuid() });

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
  ];
}
