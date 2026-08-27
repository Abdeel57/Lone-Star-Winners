/**
 * Cabecera del panel: agregados de lectura, y nada mas (HO-034 punto 5).
 *
 * ---------------------------------------------------------------------------
 * QUE HACE ESTA RUTA Y, SOBRE TODO, QUE NO HACE
 * ---------------------------------------------------------------------------
 *
 * Devuelve conteos. No escribe nada, no configura nada y no toca la promocion:
 * el ciclo de vida de una promocion, sus versiones de reglas y cualquier tope
 * del pool son de otras rutas, con sus propias capacidades. Un panel que pudiera
 * cambiar algo desde su portada convertiria la pantalla de resumen en la de
 * mayor superficie de escritura del sistema.
 *
 * ---------------------------------------------------------------------------
 * POR QUE LAS CIFRAS DEL LEDGER SALEN `null` PARA ALGUNOS ACTORES
 * ---------------------------------------------------------------------------
 *
 * El catalogo de DEC-027 describe `dashboard.read` con estas palabras:
 *
 *     "Entrar al panel y ver sus agregados de cabecera. NO DEVUELVE PII NI
 *      CIFRAS DEL LEDGER: la reconciliacion vive detras de reconciliation.read."
 *
 * Asi que `active_entries` y `participants` -que son saldo del ledger- solo se
 * pueblan cuando el actor tiene ADEMAS `entry.ledger.read`. Quien no la tenga
 * recibe `null`, que en el contrato significa "no publicado" y no "cero": el
 * frontend ya declara los dos campos como `number | null`.
 *
 * ESTO NO ES UNA RAMA DE AUTORIZACION ESCONDIDA EN UN HANDLER. La ruta declara
 * su capacidad en el registro y el autorizador decide si se entra; lo de aqui es
 * lo contrario de una concesion: es NO publicar un dato que la capacidad de la
 * ruta no cubre, decidido en la unica direccion segura -por defecto, `null`-.
 * La alternativa era una segunda ruta bajo `entry.ledger.read` que devolviera
 * dos numeros, y un panel que hace dos peticiones para pintar una cabecera
 * ensena una mitad antes que la otra.
 *
 * ---------------------------------------------------------------------------
 * `as_of` NO ES DECORACION
 * ---------------------------------------------------------------------------
 *
 * Todas las cifras se calculan contra el MISMO instante, tomado una vez del
 * reloj de dominio (DEC-011). Sin el, dos consultas consecutivas podrian
 * corresponder a dos instantes distintos y la pantalla mostraria un conjunto de
 * numeros que nunca fue cierto a la vez.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { errorEnvelopeSchema } from "../http/errors.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { promotionStatusSchema } from "../http/schemas.js";
import { adminReadsFor } from "../services/admin-reads.js";
import { domainServicesFor } from "../services/domain-registry.js";

/** Ventana de "pedidos recientes" de la cabecera. Es presentacion, no una regla. */
const ORDERS_WINDOW_HOURS = 24;
const ORDERS_WINDOW_MS = ORDERS_WINDOW_HOURS * 60 * 60 * 1000;

const dashboardSchema = z.object({
  /** `null` cuando no hay ninguna promocion activa; es un estado normal. */
  promotion_id: z.uuid().nullable(),
  promotion_status: promotionStatusSchema.nullable(),
  /** Saldo activo del ledger. `null` sin `entry.ledger.read`. Ver la cabecera. */
  active_entries: z.number().int().nullable(),
  /** Participantes con saldo activo. `null` sin `entry.ledger.read`. */
  participants: z.number().int().nullable(),
  orders_last_24h: z.number().int().nullable(),
  amoe_pending_review: z.number().int().nullable(),
  adjustments_pending_approval: z.number().int().nullable(),
  /** Instante UNICO al que corresponden todas las cifras. ISO-8601 UTC. */
  as_of: z.string(),
});

export function buildAdminDashboardRoutes(dependencies: AppDependencies): RouteDefinition[] {
  return [
    {
      method: "GET",
      url: "/api/v1/admin/dashboard",
      operationId: "getAdminDashboard",
      summary: "Agregados de cabecera del panel.",
      description:
        "Solo lectura agregada. `active_entries` y `participants` son cifras del ledger y llegan `null` si el actor no tiene ademas `entry.ledger.read`, tal y como describe `dashboard.read` en el catalogo de DEC-027.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "dashboard.read" },
      schema: {
        response: {
          200: dashboardSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const reads = adminReadsFor(dependencies);
        const domain = domainServicesFor(dependencies);

        // UNA lectura del reloj para toda la respuesta (DEC-011).
        const asOf = domain.clock.now();
        const promotion = await dependencies.repositories.promotions.findActive();
        const promotionId = promotion === null ? null : promotion.id;

        const counts = await reads.dashboardCounts({
          promotionId,
          ordersSince: new Date(asOf.getTime() - ORDERS_WINDOW_MS),
        });

        /*
         * `includes` sobre las capacidades del principal, no una segunda tabla
         * de roles. `capabilitiesForRoles` de `@lsw/security` es quien las
         * resolvio (ver `services/staff-principal.ts`), asi que aqui no hay
         * ninguna politica: hay una pregunta sobre una lista ya resuelta.
         */
        const mayReadLedger = staff.capabilities.includes("entry.ledger.read");

        const totals =
          mayReadLedger && promotionId !== null
            ? await reads.entryTotalsFor(promotionId, asOf)
            : null;

        return {
          promotion_id: promotionId,
          promotion_status: promotion === null ? null : promotion.status,
          active_entries: totals === null ? null : totals.activeEntries,
          participants: totals === null ? null : totals.participantsWithEntries,
          orders_last_24h: counts.ordersInWindow,
          amoe_pending_review: counts.amoePendingReview,
          adjustments_pending_approval: counts.adjustmentsPendingApproval,
          as_of: asOf.toISOString(),
        };
      },
    },
  ];
}
