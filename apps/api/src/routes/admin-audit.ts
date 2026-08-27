/**
 * Traza de auditoria, en el panel (HO-034 punto 5).
 *
 * ---------------------------------------------------------------------------
 * SOLO LECTURA, Y NO POR CONVENCION
 * ---------------------------------------------------------------------------
 *
 * Aqui no hay -ni puede haber- una ruta que edite o borre una fila de
 * auditoria. No es una decision de este archivo: el rol de base de datos de la
 * aplicacion no tiene el privilegio y un trigger lanza excepcion aunque lo
 * tuviera (DEC-007, DEC-008). Una traza que la interfaz pudiera escribir a mano
 * dejaria de ser evidencia.
 *
 * La VERIFICACION de la cadena de hashes no esta en este modulo a proposito: es
 * otra capacidad (`audit.integrity.verify`) y por tanto otra ruta. Mezclarlas
 * daria a quien solo puede leer la traza la posibilidad de disparar una
 * verificacion, que es una operacion distinta con otro coste y otra lectura.
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE PUBLICA, Y POR QUE
 * ---------------------------------------------------------------------------
 *
 * `before`, `after`, `reason_text`, `source_ip` y `user_agent` NO se sirven, y
 * ni siquiera se seleccionan en la consulta (ver `admin-read-repository.ts`).
 * Los tres primeros son material interno -el diff, aun saneado, describe datos
 * de una persona- y los dos ultimos son huella de conexion. DEC-014 hace lo
 * demas: el serializador no deja salir lo que el esquema no declara, asi que
 * anadirlos exigiria escribirlos aqui a mano.
 *
 * `actor_email` viaja SIEMPRE `null`. La tabla guarda `actor_id`, un
 * identificador interno, y su propia documentacion dice "nunca un correo ni un
 * nombre": resolverlo contra `identities` en la lectura metería en la traza
 * justo el dato que la escritura decidio no guardar. El frontend ya declara el
 * campo como `string | null` y pinta el identificador. Si algun dia se quiere
 * el nombre de la persona, es una decision con su DEC y su capacidad, no un
 * `JOIN` anadido de paso.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN ES `sequence_no`, NO `occurred_at`
 * ---------------------------------------------------------------------------
 *
 * `sequence_no` es el orden TOTAL de escritura que asigna el motor. Con
 * `occurred_at` habria empates -dos hechos del mismo milisegundo- y la
 * paginacion por keyset se saltaria uno de los dos: en una traza de auditoria,
 * un hecho que nadie llega a ver es exactamente el fallo que la traza existe
 * para impedir.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { adminReadsFor } from "../services/admin-reads.js";

/**
 * Filtros del listado.
 *
 * `action` se valida con la forma de una clave de capacidad y no contra el
 * catalogo cerrado: la columna guarda tambien acciones del sistema que no son
 * capacidades, y rechazar aqui una accion legitima haria invisible en la
 * pantalla justo el hecho que alguien vino a buscar. La forma acotada basta para
 * que el valor no sea texto libre.
 */
const auditQuerySchema = paginationQuerySchema.extend({
  promotion_id: z.uuid().optional(),
  actor_id: z.string().min(1).max(200).optional(),
  action: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u)
    .max(120)
    .optional(),
});

const auditEventSchema = z.object({
  id: z.uuid(),
  occurred_at: z.string(),
  /** `HUMAN` o `SYSTEM`. Distinguirlos es el punto de la traza. */
  actor_type: z.string(),
  actor_id: z.string().nullable(),
  /** Siempre `null`. Ver la cabecera: la tabla no guarda correos. */
  actor_email: z.string().nullable(),
  actor_roles: z.array(z.string()),
  /** Capacidad ejercida, como clave estable. */
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  promotion_id: z.uuid().nullable(),
  reason_key: z.string().nullable(),
  request_id: z.string().nullable(),
});

export function buildAdminAuditRoutes(dependencies: AppDependencies): RouteDefinition[] {
  return [
    {
      method: "GET",
      url: "/api/v1/admin/audit-events",
      operationId: "listAdminAuditEvents",
      summary: "Traza de auditoria, la mas reciente primero.",
      description:
        "Solo lectura (DEC-007). Filtrable por promocion, actor y accion. No publica `before`, `after`, `reason_text`, `source_ip` ni `user_agent`, y `actor_email` es siempre `null`: la tabla guarda identificadores internos, nunca correos.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "audit.read" },
      schema: {
        querystring: auditQuerySchema,
        response: {
          200: pageSchema(auditEventSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof auditQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;

        const rows = await adminReadsFor(dependencies).listAuditEvents({
          promotionId: query.promotion_id ?? null,
          actorId: query.actor_id ?? null,
          action: query.action ?? null,
          limit: query.limit + 1,
          after,
        });

        const page = buildPage(rows, query.limit, (row) => ({
          sortKey: row.sequenceNo.toString(10),
          id: row.id,
        }));

        return {
          items: page.items.map((row) => ({
            id: row.id,
            occurred_at: row.occurredAt.toISOString(),
            actor_type: row.actorType,
            actor_id: row.actorId,
            actor_email: null,
            actor_roles: [...row.actorRoles],
            action: row.action,
            entity_type: row.targetEntityType,
            entity_id: row.targetEntityId,
            promotion_id: row.promotionId,
            reason_key: row.reasonCode,
            request_id: row.requestId,
          })),
          next_cursor: page.next_cursor,
        };
      },
    },
  ];
}
