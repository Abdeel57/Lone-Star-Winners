/**
 * Lecturas del panel, detras de un puerto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UN PUERTO Y NO `new DrizzleAdminReadRepository(db)` EN CADA HANDLER
 * ---------------------------------------------------------------------------
 *
 * Por el mismo motivo que `services/ports.ts` (ver su cabecera): lo que vive en
 * el motor -la funcion de saldo de DEC-007, los indices que hacen viable el
 * keyset- se prueba contra PostgreSQL en `packages/database`; lo que NO vive en
 * el motor -que el correo salga enmascarado, que el cursor sea opaco, que la
 * forma de la respuesta sea la del contrato- se prueba en `apps/api` con dobles,
 * sin Docker.
 *
 * Sin puerto habria que elegir entre no probar ninguna de las dos mitades o
 * simular las dos, y simular una funcion SQL es escribir un test que pasa
 * siempre.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UN `WeakMap` Y NO UN CAMPO EN `AppDependencies`
 * ---------------------------------------------------------------------------
 *
 * Mismo acuerdo que `services/domain-registry.ts`, y por el mismo motivo: cada
 * modulo de rutas aporta su `buildXxxRoutes` y UNA linea en `app.ts`; ampliar la
 * interfaz compartida ademas de eso es justo el conflicto que el acuerdo evita.
 * `WeakMap` para no retener las dependencias cuando la aplicacion se descarta,
 * que es lo que pasa entre tests.
 *
 * ---------------------------------------------------------------------------
 * LA CONEXION PUEDE NO EXISTIR, Y ES LEGITIMO
 * ---------------------------------------------------------------------------
 *
 * `scripts/emit-contract.ts` construye las definiciones de ruta con
 * `database: undefined`: las definiciones son datos puros y ahi no corre ningun
 * handler. El adaptador solo GUARDA el ejecutor en su constructor. Si alguna vez
 * se tocara sin conexion, el proxy falla RUIDOSAMENTE en lugar de devolver una
 * lista vacia que alguien leeria como "no hay datos".
 */

import {
  DrizzleAdminReadRepository,
  type AdminAuditEventRow,
  type AdminAuditListOptions,
  type AdminDashboardCounts,
  type AdminEntryTotals,
  type AdminOrderListOptions,
  type AdminOrderRow,
  type AdminParticipantListOptions,
  type AdminParticipantRow,
  type Database,
} from "@lsw/database";

import type { AppDependencies } from "../app.js";

/**
 * Lo que los handlers del panel necesitan leer.
 *
 * Se declara aqui, y no se reexporta la clase, para que un test pueda sustituir
 * el conjunto sin construir un adaptador de Drizzle.
 */
export interface AdminReads {
  dashboardCounts(options: {
    readonly promotionId: string | null;
    readonly ordersSince: Date;
  }): Promise<AdminDashboardCounts>;
  entryTotalsFor(promotionId: string, at: Date): Promise<AdminEntryTotals>;
  listOrders(options: AdminOrderListOptions): Promise<readonly AdminOrderRow[]>;
  participantEmailForOrder(orderId: string): Promise<string | null>;
  listParticipants(options: AdminParticipantListOptions): Promise<readonly AdminParticipantRow[]>;
  findParticipant(participantId: string): Promise<AdminParticipantRow | null>;
  listAuditEvents(options: AdminAuditListOptions): Promise<readonly AdminAuditEventRow[]>;
}

const cache = new WeakMap<AppDependencies, AdminReads>();

const MISSING_DATABASE = new Proxy({} as Database, {
  get(_target, property): never {
    throw new Error(
      `No hay conexion a base de datos en estas dependencias, y una lectura del panel ` +
        `intento usarla (propiedad "${String(property)}"). Solo la generacion del contrato ` +
        `(scripts/emit-contract.ts) construye rutas sin conexion, y ahi no corre ningun handler.`,
    );
  },
});

export function adminReadsFor(dependencies: AppDependencies): AdminReads {
  const existing = cache.get(dependencies);
  if (existing !== undefined) {
    return existing;
  }

  const handle = dependencies.database as { db: Database } | undefined;
  const reads = new DrizzleAdminReadRepository(handle === undefined ? MISSING_DATABASE : handle.db);

  cache.set(dependencies, reads);
  return reads;
}
