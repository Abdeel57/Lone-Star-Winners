/**
 * El ejecutor: `db` o la transaccion viva, sin que quien llama tenga que
 * saberlo.
 *
 * ---------------------------------------------------------------------------
 * EL FALLO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR
 * ---------------------------------------------------------------------------
 *
 * El puerto `UnitOfWork` de `@lsw/sweepstakes` es `withTransaction(() => ...)`
 * y no `withTransaction((tx) => ...)`. Su cabecera explica por que: un objeto
 * de transaccion que viaja como parametro se puede olvidar en UNA llamada, y
 * esa llamada saldria de la transaccion sin que nada lo avisara. En el pipeline
 * de award eso significa un snapshot de calculo guardado fuera de la
 * transaccion que escribe la fila del ledger: si la fila falla, el snapshot
 * queda huerfano y describe un calculo que no tuvo efecto.
 *
 * Con un ambito lexico el olvido deja de ser posible, pero entonces el
 * adaptador necesita otra forma de saber que hay una transaccion viva. Eso es
 * `AsyncLocalStorage`: el contexto viaja con la cadena de `await` y no por
 * parametro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `AsyncLocalStorage` Y NO UNA VARIABLE DE MODULO
 * ---------------------------------------------------------------------------
 *
 * Una variable de modulo la comparten TODAS las peticiones del proceso. Con dos
 * peticiones concurrentes -que es el caso normal, no el excepcional- la segunda
 * sobrescribiria la transaccion de la primera y las escrituras acabarian
 * repartidas entre dos transacciones al azar. `AsyncLocalStorage` da un valor
 * por cadena de ejecucion, que es exactamente el alcance que hace falta.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";

import type * as schema from "../schema/index.js";

type Schema = typeof schema;

/**
 * Cualquier cosa capaz de ejecutar consultas: la conexion o una transaccion.
 *
 * Los dos tipos son estructuralmente distintos en Drizzle, asi que la union es
 * la unica forma de escribir un repositorio que funcione en ambos contextos sin
 * duplicarlo.
 */
export type DbExecutor =
  | NodePgDatabase<Schema>
  | PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

const transactionStorage = new AsyncLocalStorage<DbExecutor>();

/**
 * Devuelve la transaccion viva, si la hay, y si no la conexion.
 *
 * Todo repositorio de este directorio llama a esto en CADA operacion, nunca
 * guarda el resultado en una propiedad: guardarlo lo ataria al ejecutor que
 * hubiera en el momento de construirlo, que es precisamente el que no vale.
 */
export function currentExecutor(fallback: DbExecutor): DbExecutor {
  return transactionStorage.getStore() ?? fallback;
}

/**
 * Implementacion del puerto `UnitOfWork`.
 *
 * `withTransaction` ANIDADA reutiliza la transaccion existente en vez de abrir
 * una segunda: `AwardService` llama a `withTransaction` y dentro de el
 * `ReversalService` podria llamar otra vez. Con dos transacciones reales, la
 * interna confirmaria por su cuenta y la garantia de atomicidad del conjunto se
 * perderia sin que nadie lo notara. Drizzle abriria un SAVEPOINT, que no es lo
 * mismo: un SAVEPOINT liberado no deshace lo que la externa ya escribio.
 */
export class DrizzleUnitOfWork {
  private readonly db: NodePgDatabase<Schema>;

  public constructor(db: NodePgDatabase<Schema>) {
    this.db = db;
  }

  public async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    const existing = transactionStorage.getStore();
    if (existing !== undefined) {
      return await work();
    }

    return await this.db.transaction(async (tx) => transactionStorage.run(tx, work));
  }
}

/**
 * Ejecuta dentro de una transaccion concreta. Solo lo usan los tests y el
 * propio `DrizzleUnitOfWork`; el codigo de dominio no debe verlo.
 */
export function runInExecutor<T>(executor: DbExecutor, work: () => Promise<T>): Promise<T> {
  return transactionStorage.run(executor, work);
}

/** `true` si hay una transaccion viva en esta cadena de ejecucion. */
export function isInTransaction(): boolean {
  return transactionStorage.getStore() !== undefined;
}
