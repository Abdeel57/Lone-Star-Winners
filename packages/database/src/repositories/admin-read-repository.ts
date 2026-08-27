/**
 * Lecturas del PANEL. Solo lecturas, y ninguna de ellas del ledger.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE REPOSITORIO EXISTE APARTE
 * ---------------------------------------------------------------------------
 *
 * `createSweepstakesRepositories` reune los adaptadores del DOMINIO: los que
 * participan en una operacion que escribe -otorgar, revertir, ajustar,
 * exportar- y que por eso comparten unidad de trabajo, reloj y generador de
 * identificadores. Nada de lo que hay aqui escribe una fila.
 *
 * Meterlas alli las ataria a ese ciclo de vida sin ganancia y, peor, dejaria
 * la puerta abierta a que una consulta de pantalla acabase dentro de la
 * transaccion de un award porque estaba "a mano". Estas son consultas de
 * lectura, se hacen fuera de toda transaccion y no tienen por que verse.
 *
 * ---------------------------------------------------------------------------
 * TRES REGLAS QUE GOBIERNAN TODO EL ARCHIVO
 * ---------------------------------------------------------------------------
 *
 * 1. NINGUNA CIFRA DE PARTICIPACIONES SE CALCULA AQUI. El saldo lo responde
 *    `lsw_entry_balances_at`, que es donde DEC-007 escribio el predicado UNA
 *    vez -incluida la ventana de caducidad de DEC-033-. Un `SELECT
 *    sum(quantity_delta)` escrito en este archivo seria una segunda
 *    implementacion del saldo, y el dia que discrepara del motor no habria
 *    forma de saber cual miente.
 *
 * 2. EL CORREO SALE CRUDO DE AQUI Y SE ENMASCARA EN LA FRONTERA HTTP. Podria
 *    parecer mas seguro enmascararlo en la consulta, pero entonces la ruta que
 *    SI esta autorizada a ver el dato completo (`pii.view.full`) necesitaria
 *    una segunda consulta casi identica, y dos consultas que deben devolver lo
 *    mismo salvo un campo terminan divergiendo. La decision de que se publica
 *    la toma quien conoce la capacidad del actor, que es `apps/api`.
 *
 * 3. LA PAGINACION ES POR KEYSET, NUNCA POR OFFSET. Cada listado devuelve
 *    `limit` filas tal cual se le piden -quien llama pide `limit + 1` y decide
 *    si hay pagina siguiente- y avanza con una clave estable y monotona. Con
 *    `OFFSET`, una fila nueva desplaza las siguientes y el cliente se salta
 *    filas sin enterarse; en una traza de auditoria eso significa un hecho que
 *    nadie llego a ver.
 */

import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";

import {
  adjustments,
  amoeSubmissions,
  auditEvents,
  disqualifications,
  identities,
  orders,
  participants,
} from "../schema/index.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

// ---------------------------------------------------------------------------
// Formas devueltas
// ---------------------------------------------------------------------------

/**
 * Agregados de cabecera del panel.
 *
 * `activeEntries` y `participantsWithEntries` son CIFRAS DEL LEDGER, y el
 * catalogo de capacidades dice literalmente que `dashboard.read` "no devuelve
 * PII ni cifras del ledger". Por eso salen de un metodo aparte
 * (`entryTotalsFor`): quien no pueda leer el ledger no llama a ese metodo y la
 * respuesta publica `null`, que en el contrato significa "no publicado" y no
 * "cero".
 */
export interface AdminDashboardCounts {
  /** Pedidos creados en la ventana que se pida. Conteo, sin PII. */
  readonly ordersInWindow: number;
  readonly amoePendingReview: number;
  readonly adjustmentsPendingApproval: number;
}

export interface AdminEntryTotals {
  /** Suma de saldos activos de la promocion, segun `lsw_entry_balances_at`. */
  readonly activeEntries: number;
  /** Participantes con saldo activo distinto de cero en la promocion. */
  readonly participantsWithEntries: number;
}

/** Fila del listado de pedidos del panel. El correo viaja CRUDO; ver regla 2. */
export interface AdminOrderRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly participantId: string;
  /** `null` cuando la identidad no tiene correo (cuenta anonimizada). */
  readonly participantEmail: string | null;
}

export interface AdminParticipantRow {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly phoneE164: string | null;
  readonly preferredLocale: string;
  readonly status: string;
  readonly reviewState: string;
  readonly createdAt: Date;
  /** `true` si existe al menos una descalificacion vigente. */
  readonly disqualified: boolean;
}

export interface AdminAuditEventRow {
  readonly id: string;
  /** Orden total de escritura. Es tambien la clave de paginacion. */
  readonly sequenceNo: bigint;
  readonly occurredAt: Date;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly actorRoles: readonly string[];
  readonly action: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string | null;
  readonly promotionId: string | null;
  readonly reasonCode: string | null;
  readonly requestId: string | null;
}

export interface AdminOrderListOptions {
  readonly promotionId: string | null;
  readonly limit: number;
  /** `order_number` de la ultima fila devuelta, ya decodificado del cursor. */
  readonly after: string | null;
}

export interface AdminParticipantListOptions {
  readonly limit: number;
  /** `created_at` en ISO-8601 de la ultima fila devuelta. */
  readonly after: string | null;
}

export interface AdminAuditListOptions {
  readonly promotionId: string | null;
  readonly actorId: string | null;
  readonly action: string | null;
  readonly limit: number;
  /** `sequence_no` de la ultima fila devuelta, como texto decimal. */
  readonly after: string | null;
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Convierte a entero un agregado que PostgreSQL devuelve como texto.
 *
 * `count(*)` y `sum(bigint)` llegan como cadena porque un `bigint` no cabe en
 * un `number` de JavaScript. Aqui se convierte a proposito y no se propaga el
 * `bigint`: son conteos de pantalla, no cifras que entren en un hash ni en un
 * export. Las que si lo son nunca pasan por este archivo.
 */
function toCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export class DrizzleAdminReadRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /**
   * Conteos de cabecera. NINGUNO toca el ledger ni devuelve PII.
   *
   * `since` lo decide quien llama y llega como parametro explicito: DEC-011 no
   * permite leer el reloj dentro de una consulta cuyo resultado depende de el,
   * porque entonces dos cifras de la misma pantalla podrian corresponder a dos
   * instantes distintos.
   */
  public async dashboardCounts(options: {
    readonly promotionId: string | null;
    readonly ordersSince: Date;
  }): Promise<AdminDashboardCounts> {
    const promotionId = options.promotionId;

    const orderFilter: SQL | undefined =
      promotionId === null
        ? gte(orders.createdAt, options.ordersSince)
        : and(eq(orders.promotionId, promotionId), gte(orders.createdAt, options.ordersSince));

    const [orderRows, amoeRows, adjustmentRows] = await Promise.all([
      this.db
        .select({ total: sql<string>`count(*)` })
        .from(orders)
        .where(orderFilter),
      this.db
        .select({ total: sql<string>`count(*)` })
        .from(amoeSubmissions)
        .where(
          promotionId === null
            ? sql`${amoeSubmissions.status} IN ('SUBMITTED', 'PENDING_REVIEW')`
            : and(
                eq(amoeSubmissions.promotionId, promotionId),
                sql`${amoeSubmissions.status} IN ('SUBMITTED', 'PENDING_REVIEW')`,
              ),
        ),
      this.db
        .select({ total: sql<string>`count(*)` })
        .from(adjustments)
        .where(
          promotionId === null
            ? eq(adjustments.status, "PENDING_APPROVAL")
            : and(
                eq(adjustments.promotionId, promotionId),
                eq(adjustments.status, "PENDING_APPROVAL"),
              ),
        ),
    ]);

    return {
      ordersInWindow: toCount(orderRows[0]?.total),
      amoePendingReview: toCount(amoeRows[0]?.total),
      adjustmentsPendingApproval: toCount(adjustmentRows[0]?.total),
    };
  }

  /**
   * Totales de participaciones de una promocion.
   *
   * Sale de `lsw_entry_balances_at`, la funcion de DEC-007. No hay aqui ni una
   * suma sobre `entry_transactions`: el predicado del saldo esta escrito una
   * sola vez, en la migracion 0006, y este metodo lo CONSULTA.
   *
   * `at` es parametro explicito por DEC-011. Dos cifras de la misma pantalla
   * tienen que corresponder al mismo instante.
   */
  public async entryTotalsFor(promotionId: string, at: Date): Promise<AdminEntryTotals> {
    const result = await this.db.execute<{ total: string; holders: string }>(
      sql`SELECT coalesce(sum(active_entries), 0)::text AS total,
                 count(*) FILTER (WHERE active_entries <> 0)::text AS holders
            FROM lsw_entry_balances_at(${at.toISOString()}::timestamptz, ${promotionId}::uuid)`,
    );

    const row = result.rows[0];
    return {
      activeEntries: toCount(row?.total),
      participantsWithEntries: toCount(row?.holders),
    };
  }

  /**
   * Pedidos, mas recientes primero.
   *
   * El cursor es `order_number` y no `created_at`, por el mismo motivo que en
   * `DrizzleOrderRepository.listForParticipant`: es unico y monotono con la
   * creacion, y dos pedidos del mismo milisegundo no se solapan entre paginas.
   */
  public async listOrders(options: AdminOrderListOptions): Promise<readonly AdminOrderRow[]> {
    const filters: SQL[] = [];
    if (options.promotionId !== null) {
      filters.push(eq(orders.promotionId, options.promotionId));
    }
    if (options.after !== null) {
      filters.push(sql`${orders.orderNumber} < ${options.after}`);
    }

    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        participantId: orders.participantId,
        participantEmail: identities.email,
      })
      .from(orders)
      .innerJoin(participants, eq(participants.id, orders.participantId))
      .innerJoin(identities, eq(identities.id, participants.identityId))
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(orders.orderNumber))
      .limit(options.limit);

    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      participantId: row.participantId,
      participantEmail: row.participantEmail,
    }));
  }

  /** Correo crudo del comprador de un pedido concreto. `null` si no lo hay. */
  public async participantEmailForOrder(orderId: string): Promise<string | null> {
    const rows = await this.db
      .select({ email: identities.email })
      .from(orders)
      .innerJoin(participants, eq(participants.id, orders.participantId))
      .innerJoin(identities, eq(identities.id, participants.identityId))
      .where(eq(orders.id, orderId))
      .limit(1);

    return rows[0]?.email ?? null;
  }

  /**
   * Participantes, mas recientes primero.
   *
   * `disqualified` se resuelve con un `EXISTS` sobre `disqualifications` y no
   * con una columna en `participants`: una columna seria una segunda fuente de
   * verdad sobre un hecho que ya esta registrado con su motivo, su actor y su
   * instante, y que ademas es POR PROMOCION.
   */
  public async listParticipants(
    options: AdminParticipantListOptions,
  ): Promise<readonly AdminParticipantRow[]> {
    const rows = await this.db
      .select(this.participantColumns())
      .from(participants)
      .innerJoin(identities, eq(identities.id, participants.identityId))
      .where(
        options.after === null
          ? undefined
          : sql`${participants.createdAt} < ${options.after}::timestamptz`,
      )
      .orderBy(desc(participants.createdAt), desc(participants.id))
      .limit(options.limit);

    return rows.map((row) => this.toParticipantRow(row));
  }

  public async findParticipant(participantId: string): Promise<AdminParticipantRow | null> {
    const rows = await this.db
      .select(this.participantColumns())
      .from(participants)
      .innerJoin(identities, eq(identities.id, participants.identityId))
      .where(eq(participants.id, participantId))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : this.toParticipantRow(row);
  }

  private participantColumns(): {
    id: typeof participants.id;
    email: typeof identities.email;
    displayName: typeof participants.displayName;
    phoneE164: typeof participants.phoneE164;
    preferredLocale: typeof participants.preferredLocale;
    status: typeof participants.status;
    reviewState: typeof participants.reviewState;
    createdAt: typeof participants.createdAt;
    disqualified: SQL<boolean>;
  } {
    return {
      id: participants.id,
      email: identities.email,
      displayName: participants.displayName,
      phoneE164: participants.phoneE164,
      preferredLocale: participants.preferredLocale,
      status: participants.status,
      reviewState: participants.reviewState,
      createdAt: participants.createdAt,
      disqualified: sql<boolean>`EXISTS (
        SELECT 1 FROM ${disqualifications}
         WHERE ${disqualifications.participantId} = ${participants.id}
      )`,
    };
  }

  private toParticipantRow(row: {
    id: string;
    email: string | null;
    displayName: string | null;
    phoneE164: string | null;
    preferredLocale: string;
    status: string;
    reviewState: string;
    createdAt: Date;
    disqualified: boolean;
  }): AdminParticipantRow {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      phoneE164: row.phoneE164,
      preferredLocale: row.preferredLocale,
      status: row.status,
      reviewState: row.reviewState,
      createdAt: row.createdAt,
      disqualified: row.disqualified,
    };
  }

  /**
   * Traza de auditoria, la mas reciente primero.
   *
   * NO SE SELECCIONAN `before`, `after`, `reason_text`, `source_ip` NI
   * `user_agent`. Los tres primeros pueden contener dato de una persona -el
   * diff saneado es lo maximo que se guarda, y aun asi es material interno- y
   * los dos ultimos son huella de conexion. Un listado de pantalla no es el
   * sitio donde repartirlos: no se filtran por descuido porque no se piden.
   *
   * El orden es `sequence_no DESC`, que es el orden TOTAL de escritura que
   * asigna el motor. Ordenar por `occurred_at` dejaria empates -dos hechos del
   * mismo milisegundo- y la paginacion se saltaria uno de los dos.
   */
  public async listAuditEvents(
    options: AdminAuditListOptions,
  ): Promise<readonly AdminAuditEventRow[]> {
    const filters: SQL[] = [];
    if (options.promotionId !== null) {
      filters.push(eq(auditEvents.promotionId, options.promotionId));
    }
    if (options.actorId !== null) {
      filters.push(eq(auditEvents.actorId, options.actorId));
    }
    if (options.action !== null) {
      filters.push(eq(auditEvents.action, options.action));
    }
    if (options.after !== null) {
      filters.push(sql`${auditEvents.sequenceNo} < ${options.after}::bigint`);
    }

    const rows = await this.db
      .select({
        id: auditEvents.id,
        sequenceNo: auditEvents.sequenceNo,
        occurredAt: auditEvents.occurredAt,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        actorRoles: auditEvents.actorRoles,
        action: auditEvents.action,
        targetEntityType: auditEvents.targetEntityType,
        targetEntityId: auditEvents.targetEntityId,
        promotionId: auditEvents.promotionId,
        reasonCode: auditEvents.reasonCode,
        requestId: auditEvents.requestId,
      })
      .from(auditEvents)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(auditEvents.sequenceNo))
      .limit(options.limit);

    return rows.map((row) => ({
      id: row.id,
      sequenceNo: row.sequenceNo,
      occurredAt: row.occurredAt,
      actorType: row.actorType,
      actorId: row.actorId,
      actorRoles: asStringArray(row.actorRoles),
      action: row.action,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      promotionId: row.promotionId,
      reasonCode: row.reasonCode,
      requestId: row.requestId,
    }));
  }
}
