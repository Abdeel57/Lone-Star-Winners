/**
 * Adaptador Drizzle de `audit_events` (DEC-007, DEC-008, DEC-035, HO-028).
 *
 * ---------------------------------------------------------------------------
 * AQUI NO SE CALCULA NINGUN HASH
 * ---------------------------------------------------------------------------
 *
 * Este archivo pone SQL: el cerrojo, la lectura de la cabeza, el INSERT y la
 * lectura de la cadena. La construccion del preimage de DEC-035 vive en
 * `@lsw/audit` y llega por un PUERTO.
 *
 * No es purismo arquitectonico. `packages/database` no depende de `@lsw/audit`
 * -igual que no depende de `@lsw/tpa`, ver la cabecera de `tpa-ports.ts`- y la
 * salida facil seria recalcular el preimage aqui con `node:crypto`. Eso serian
 * DOS implementaciones del mismo hash, y dos implementaciones de un hash no son
 * redundancia: son la garantia de que un dia diferiran. Ese dia la cadena
 * dejaria de verificar y nadie sabria cual de las dos tenia razon, que es la
 * peor situacion posible para una evidencia.
 *
 * Con el puerto, quien monta la aplicacion elige la implementacion -y en los
 * tests se puede montar una de juguete para comprobar que el adaptador llama a
 * lo que dice llamar- pero solo existe UNA construccion del hash.
 *
 * ---------------------------------------------------------------------------
 * SIN PUERTO NO SE ESCRIBE. NO HAY MODO DEGRADADO
 * ---------------------------------------------------------------------------
 *
 * Si no hay `chainPort`, `append` LANZA. La tentacion es escribir la fila con
 * `chain_hash` nulo "hasta que se monte la cadena". Seria el peor de los
 * mundos: un historico que parece auditado y no lo esta, y que ademas no se
 * puede arreglar despues porque la tabla no admite UPDATE.
 *
 * Mismo criterio que `createUnconfiguredChainHeadSealStore` en `@lsw/audit` y
 * que `createUnconfiguredTpaAdapter` en `@lsw/tpa`: la implementacion por
 * defecto se niega.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL CERROJO ANTES DE LEER LA CABEZA, Y NO SOLO EL INDICE UNICO
 * ---------------------------------------------------------------------------
 *
 * `UNIQUE (chain_key, chain_prev_hash)` ya hace IMPOSIBLE la bifurcacion. Pero
 * sin cerrojo, dos escritores concurrentes leerian la misma cabeza y el segundo
 * fallaria por violacion de unicidad: correcto, y a la vez inutilizable, porque
 * cada operacion administrativa concurrente sobre la misma promocion se
 * convertiria en un error que alguien tendria que reintentar.
 *
 * Con el cerrojo tomado ANTES de leer, el segundo escritor espera, lee la
 * cabeza que dejo el primero y encadena bien. El indice unico deja de ser el
 * mecanismo y pasa a ser la red: si algun dia alguien escribe por otro camino y
 * se salta el cerrojo, la bifurcacion sigue siendo imposible.
 *
 * El cerrojo es `xact`: se libera al terminar la transaccion. Si esta hace
 * rollback, se suelta con ella y la cabeza vuelve a ser la anterior.
 */

import { asc, desc, eq, sql } from "drizzle-orm";

import { auditEvents } from "../schema/audit-events.js";
import { currentExecutor, isInTransaction, type DbExecutor } from "./executor.js";

// ---------------------------------------------------------------------------
// Puertos, declarados aqui a proposito
//
// Mismos nombres de campo y mismas uniones de literales que `@lsw/audit`. Al
// ser estructuralmente identicos, `createAuditEventChainPort()` de aquel
// paquete es asignable a `AuditEventChainPort` sin conversion, y el dia que la
// dependencia exista el compilador lo confirmara -o dira donde han divergido-
// en el punto de montaje.
// ---------------------------------------------------------------------------

export type AuditActorTypeValue = "PARTICIPANT" | "STAFF" | "SYSTEM" | "ANONYMOUS";

/** Objeto JSON simple. La canonicalizacion valida el contenido al hashear. */
export type AuditJsonObject = Readonly<Record<string, unknown>>;

/**
 * Campos de un hecho auditable.
 *
 * Los instantes viajan como ISO-8601 UTC con milisegundos, NO como `Date`, y
 * eso es intencionado: es exactamente la cadena que entra en el hash. Si el
 * puerto recibiera un `Date`, el adaptador y el verificador tendrian que
 * convertirlo a texto por su cuenta, y dos conversiones son dos formas de que
 * el instante hasheado deje de ser el guardado.
 */
export interface AuditEventFieldsInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorType: AuditActorTypeValue;
  readonly actorId: string | null;
  readonly actorRoles: readonly string[];
  readonly action: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string | null;
  readonly promotionId: string | null;
  readonly requestId: string | null;
  readonly before: AuditJsonObject | null;
  readonly after: AuditJsonObject | null;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  /** DIGEST, jamas la direccion. Un CHECK de la tabla lo impone. */
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
  readonly metadata: AuditJsonObject;
}

/** Puerto de encadenado. Lo implementa `createAuditEventChainPort()`. */
export interface AuditEventChainPort {
  readonly canonicalizationVersion: number;
  genesisHashHex(chainKey: string): string;
  hashEvent(input: {
    readonly chainKey: string;
    readonly previousHashHex: string;
    readonly fields: AuditEventFieldsInput;
  }): string;
}

/** Fila leida, lista para `toStoredChainLink()` de `@lsw/audit`. */
export interface StoredAuditEventRowRecord {
  readonly sequence: string;
  readonly canonicalizationVersion: number;
  readonly chainKey: string;
  readonly chainHashHex: string;
  readonly chainPrevHashHex: string;
  readonly fields: AuditEventFieldsInput;
}

export interface AppendedAuditEventRecord {
  readonly id: string;
  readonly sequence: string;
  readonly chainKey: string;
  readonly chainHashHex: string;
  readonly chainPrevHashHex: string;
}

/** Clave de la cadena de los hechos sin promocion. Igual que en `@lsw/audit`. */
export const AUDIT_CHAIN_GLOBAL_KEY = "global";

/**
 * Cadena a la que pertenece un hecho.
 *
 * Se repite aqui porque el adaptador no puede importarla, y no puede divergir
 * porque la restriccion `audit_events_chain_key_matches_promotion` la comprueba
 * en cada INSERT: una divergencia no seria un error silencioso, seria una fila
 * rechazada.
 */
export function auditChainKeyFor(promotionId: string | null): string {
  return promotionId ?? AUDIT_CHAIN_GLOBAL_KEY;
}

export class AuditChainNotConfiguredError extends Error {
  public constructor() {
    super(
      "No hay puerto de encadenado de auditoria configurado; no se puede escribir un AuditEvent. " +
        "El hash de DEC-008 lo construye `@lsw/audit` y llega por puerto: escribir la fila sin el " +
        "dejaria un historico que parece auditado y no lo esta, en una tabla que no admite UPDATE. " +
        "Montaje pendiente en HO-028 (dependencia `@lsw/audit` en `apps/api`).",
    );
    this.name = "AuditChainNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// Lectura de filas
// ---------------------------------------------------------------------------

type Row = typeof auditEvents.$inferSelect;

/**
 * Valida que un valor leido de una columna `jsonb` es un objeto.
 *
 * La restriccion CHECK de la tabla ya lo garantiza, asi que llegar aqui con
 * otra cosa significa que la fila se escribio saltandose la tabla. Se lanza en
 * vez de devolver `{}`: un objeto vacio inventado se hashearia distinto del
 * contenido real y convertiria una manipulacion en "la cadena esta rota", sin
 * decir por que.
 */
function requireJsonObject(value: unknown, column: string, id: string): AuditJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `audit_events.${column} del evento ${id} no es un objeto JSON. La restriccion CHECK de la ` +
        "tabla lo impide, asi que esta fila no se escribio por el camino normal.",
    );
  }
  return value as AuditJsonObject;
}

function optionalJsonObject(value: unknown, column: string, id: string): AuditJsonObject | null {
  return value === null || value === undefined ? null : requireJsonObject(value, column, id);
}

function requireStringArray(value: unknown, column: string, id: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(
      `audit_events.${column} del evento ${id} no es un array de cadenas. La restriccion CHECK ` +
        "de la tabla lo impide.",
    );
  }
  return value as readonly string[];
}

function toFields(row: Row): AuditEventFieldsInput {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorType: row.actorType,
    actorId: row.actorId,
    actorRoles: requireStringArray(row.actorRoles, "actor_roles", row.id),
    action: row.action,
    targetEntityType: row.targetEntityType,
    targetEntityId: row.targetEntityId,
    promotionId: row.promotionId,
    requestId: row.requestId,
    before: optionalJsonObject(row.before, "before", row.id),
    after: optionalJsonObject(row.after, "after", row.id),
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    sourceIp: row.sourceIp,
    userAgent: row.userAgent,
    metadata: requireJsonObject(row.metadata, "metadata", row.id),
  };
}

function toStoredRow(row: Row): StoredAuditEventRowRecord {
  return {
    sequence: row.sequenceNo.toString(),
    canonicalizationVersion: row.canonicalizationVersion,
    chainKey: row.chainKey,
    chainHashHex: row.chainHash,
    chainPrevHashHex: row.chainPrevHash,
    fields: toFields(row),
  };
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export interface DrizzleAuditEventRepositoryOptions {
  /**
   * Puerto de encadenado. Sin el, `append` se niega.
   *
   * Se monta con `createAuditEventChainPort()` de `@lsw/audit` en el unico
   * sitio donde tiene sentido decidir la implementacion concreta.
   */
  readonly chainPort?: AuditEventChainPort;
}

export class DrizzleAuditEventRepository {
  private readonly fallback: DbExecutor;
  private readonly chainPort: AuditEventChainPort | null;

  public constructor(executor: DbExecutor, options: DrizzleAuditEventRepositoryOptions = {}) {
    this.fallback = executor;
    this.chainPort = options.chainPort ?? null;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /** `true` si este repositorio puede escribir. Lo consulta quien lo monta. */
  public get isConfigured(): boolean {
    return this.chainPort !== null;
  }

  /**
   * Anade un eslabon a la cadena de su promocion. Nunca actualiza.
   *
   * Los cuatro pasos, en este orden y sin atajos:
   *
   *   1. cerrojo consultivo sobre la clave de cadena;
   *   2. lectura de la cabeza -o el genesis si la cadena esta vacia-;
   *   3. hash por el puerto, sobre los MISMOS valores que se van a escribir;
   *   4. INSERT.
   *
   * Invertir 1 y 2 es exactamente el fallo que el cerrojo existe para impedir.
   */
  public async append(fields: AuditEventFieldsInput): Promise<AppendedAuditEventRecord> {
    const chainPort = this.chainPort;
    if (chainPort === null) {
      throw new AuditChainNotConfiguredError();
    }

    if (!isInTransaction()) {
      // El cerrojo es `xact`: fuera de una transaccion se libera al instante y
      // no serializa nada. Y hay una razon mas fuerte todavia: un AuditEvent se
      // escribe en la MISMA transaccion que el hecho que audita (principio 12).
      // Si no hay transaccion viva, o bien el hecho ya se confirmo sin su
      // registro, o bien se confirmara aunque el registro falle.
      throw new Error(
        "Un AuditEvent exige una transaccion viva: se escribe en la misma transaccion que el " +
          "hecho que audita, y el cerrojo de la cadena es un pg_advisory_xact_lock que fuera de " +
          "transaccion no serializa nada.",
      );
    }

    const chainKey = auditChainKeyFor(fields.promotionId);

    await this.lockChain(chainKey);

    const previousHashHex = (await this.headHash(chainKey)) ?? chainPort.genesisHashHex(chainKey);
    const chainHashHex = chainPort.hashEvent({ chainKey, previousHashHex, fields });

    const inserted = await this.db
      .insert(auditEvents)
      .values({
        // DEC-035 / DEC-047: los valores del preimage, explicitos. Ninguna de
        // estas columnas tiene DEFAULT, asi que el olvido no compila.
        id: fields.id,
        chainKey,
        occurredAt: new Date(fields.occurredAt),
        recordedAt: new Date(fields.recordedAt),
        actorType: fields.actorType,
        actorId: fields.actorId,
        actorRoles: [...fields.actorRoles],
        action: fields.action,
        targetEntityType: fields.targetEntityType,
        targetEntityId: fields.targetEntityId,
        promotionId: fields.promotionId,
        requestId: fields.requestId,
        before: fields.before,
        after: fields.after,
        reasonCode: fields.reasonCode,
        reasonText: fields.reasonText,
        sourceIp: fields.sourceIp,
        userAgent: fields.userAgent,
        metadata: fields.metadata,
        canonicalizationVersion: chainPort.canonicalizationVersion,
        chainPrevHash: previousHashHex,
        chainHash: chainHashHex,
      })
      .returning({
        id: auditEvents.id,
        sequenceNo: auditEvents.sequenceNo,
        chainKey: auditEvents.chainKey,
        chainHash: auditEvents.chainHash,
        chainPrevHash: auditEvents.chainPrevHash,
      });

    const row = inserted[0];
    if (row === undefined) {
      throw new Error("El INSERT en audit_events no devolvio ninguna fila.");
    }

    return {
      id: row.id,
      sequence: row.sequenceNo.toString(),
      chainKey: row.chainKey,
      chainHashHex: row.chainHash,
      chainPrevHashHex: row.chainPrevHash,
    };
  }

  /**
   * Serializa a los escritores de LA MISMA cadena, y solo de esa.
   *
   * `hashtext` de los dos identificadores, igual que en `lsw_allocate_entry_range`,
   * en el trigger de reversals y en la reclamacion de webhooks: una sola tecnica
   * de cerrojo consultivo en todo el proyecto, para que dos partes no elijan
   * claves que colisionen entre si. El trigger `audit_events_validate_insert`
   * toma exactamente este mismo par.
   */
  private async lockChain(chainKey: string): Promise<void> {
    await this.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('lsw_audit_chain'), hashtext(${chainKey}))`,
    );
  }

  /** Cabeza de la cadena, o `null` si todavia no hay ninguna fila. */
  public async headHash(chainKey: string): Promise<string | null> {
    const rows = await this.db
      .select({ chainHash: auditEvents.chainHash })
      .from(auditEvents)
      .where(eq(auditEvents.chainKey, chainKey))
      .orderBy(desc(auditEvents.sequenceNo))
      .limit(1);

    return rows[0]?.chainHash ?? null;
  }

  /**
   * Cadena COMPLETA de una clave, en orden de `sequence_no`.
   *
   * Completa y no la cola: la manipulacion que importa esta en el pasado, que
   * es donde nadie mira. Es el puerto de lectura de `verifyAuditChains()`.
   */
  public async readChain(chainKey: string): Promise<readonly StoredAuditEventRowRecord[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.chainKey, chainKey))
      .orderBy(asc(auditEvents.sequenceNo));

    return rows.map(toStoredRow);
  }

  /**
   * Todas las claves de cadena con al menos una fila.
   *
   * Ordenadas para que dos ejecuciones del verificador recorran lo mismo en el
   * mismo orden: un informe de integridad que cambia de orden entre ejecuciones
   * es incomodo de comparar, y comparar dos informes es justo lo que se hace
   * cuando se sospecha de algo.
   */
  public async listChainKeys(): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ chainKey: auditEvents.chainKey })
      .from(auditEvents)
      .orderBy(asc(auditEvents.chainKey));

    return rows.map((row) => row.chainKey);
  }
}
