/**
 * Almacen de auditoria EN MEMORIA, para probar el algoritmo de encadenado.
 *
 * ---------------------------------------------------------------------------
 * QUE PRUEBA ESTO Y QUE NO. IMPORTA LA DIFERENCIA
 * ---------------------------------------------------------------------------
 *
 * SI prueba: que el algoritmo de `DrizzleAuditEventRepository.append` -tomar el
 * cerrojo, leer la cabeza, hashear con el puerto real, insertar respetando la
 * restriccion unica- produce una cadena que `verifyChain` acepta, que una fila
 * alterada deja de cuadrar, y que dos escritores concurrentes no consiguen
 * bifurcarla.
 *
 * NO prueba -y no lo pretende- que `pg_advisory_xact_lock` serialice de verdad,
 * ni que el indice `UNIQUE (chain_key, chain_prev_hash)` exista en la base de
 * datos, ni que el trigger `audit_events_validate_insert` rechace un eslabon
 * suelto. DEC-018 es explicito: eso no se simula. Se comprueba contra
 * PostgreSQL real en
 * `packages/database/test/integration/audit-events.int.test.ts`.
 *
 * La linea esta donde tiene que estar: aqui se simula un ALMACEN, no una
 * GARANTIA. Lo que este fichero reproduce fielmente son las DOS REGLAS que el
 * motor impone -serializacion por clave de cadena y unicidad del antecesor- para
 * poder demostrar que el algoritmo depende de ellas, y en cual falla si falta.
 *
 * El hash NO se simula: se usa `createAuditEventChainPort()`, el de produccion.
 * Un fixture que calculara sus propios hashes demostraria que dos
 * implementaciones coinciden entre si, que no es lo que hay que demostrar.
 */

import { auditChainKey, createAuditEventChainPort, toStoredChainLink } from "@lsw/audit";
import type {
  AuditEventChainPort,
  AuditEventFields,
  StoredAuditEventRow,
  StoredChainLink,
} from "@lsw/audit";

export class ChainForkRejectedError extends Error {
  public constructor(chainKey: string, previousHashHex: string) {
    super(
      `UNIQUE (chain_key, chain_prev_hash) rechaza el eslabon: ya hay una fila en la cadena ` +
        `${chainKey} que declara venir de ${previousHashHex}.`,
    );
    this.name = "ChainForkRejectedError";
  }
}

export interface InMemoryAppendResult {
  readonly sequence: string;
  readonly chainHashHex: string;
  readonly chainPrevHashHex: string;
}

export interface InMemoryAuditChainStoreOptions {
  /**
   * `false` reproduce un escritor que SE SALTA el cerrojo consultivo.
   *
   * Existe para poder demostrar dos cosas a la vez: que sin cerrojo dos
   * escritores concurrentes chocan, y que aun asi NO bifurcan, porque la
   * restriccion unica los detiene. Un test que solo probara el camino feliz no
   * diria cual de las dos capas esta haciendo el trabajo.
   */
  readonly useLock?: boolean;
  readonly port?: AuditEventChainPort;
}

export class InMemoryAuditChainStore {
  private readonly rows: StoredAuditEventRow[] = [];
  private readonly chainKeys: string[] = [];
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly port: AuditEventChainPort;
  private readonly useLock: boolean;
  private nextSequence = 1;

  public constructor(options: InMemoryAuditChainStoreOptions = {}) {
    this.port = options.port ?? createAuditEventChainPort();
    this.useLock = options.useLock ?? true;
  }

  /** Mismos cuatro pasos que el adaptador Drizzle, en el mismo orden. */
  public async append(fields: AuditEventFields): Promise<InMemoryAppendResult> {
    const chainKey = auditChainKey(fields.promotionId);
    if (!this.useLock) {
      return await this.unlockedAppend(chainKey, fields);
    }
    return await this.withChainLock(chainKey, () => this.unlockedAppend(chainKey, fields));
  }

  private async unlockedAppend(
    chainKey: string,
    fields: AuditEventFields,
  ): Promise<InMemoryAppendResult> {
    const previousHashHex = this.headHash(chainKey) ?? this.port.genesisHashHex(chainKey);

    // Punto de conmutacion EXPLICITO entre leer la cabeza y escribir. En
    // produccion ese hueco existe -es una ida y vuelta a la base de datos- y es
    // exactamente donde se cuela el segundo escritor. Un test sin este hueco
    // seria secuencial disfrazado de concurrente.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const chainHashHex = this.port.hashEvent({ chainKey, previousHashHex, fields });

    if (
      this.rows.some(
        (row, index) =>
          this.chainKeyAt(index) === chainKey && row.chainPrevHashHex === previousHashHex,
      )
    ) {
      throw new ChainForkRejectedError(chainKey, previousHashHex);
    }

    const sequence = String(this.nextSequence);
    this.nextSequence += 1;

    this.rows.push({
      sequence,
      canonicalizationVersion: this.port.canonicalizationVersion,
      chainHashHex,
      chainPrevHashHex: previousHashHex,
      fields,
    });
    this.chainKeys.push(chainKey);

    return { sequence, chainHashHex, chainPrevHashHex: previousHashHex };
  }

  /** Cerrojo por clave de cadena: serializa a los escritores de esa cadena. */
  private withChainLock<T>(chainKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.lockTails.get(chainKey) ?? Promise.resolve();
    const result = previous.then(work, work);
    this.lockTails.set(
      chainKey,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private chainKeyAt(index: number): string | undefined {
    return this.chainKeys.at(index);
  }

  public headHash(chainKey: string): string | null {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (this.chainKeyAt(index) === chainKey) {
        return this.rows.at(index)?.chainHashHex ?? null;
      }
    }
    return null;
  }

  public listChainKeys(): readonly string[] {
    return [...new Set(this.chainKeys)].sort();
  }

  public readChain(chainKey: string): readonly StoredAuditEventRow[] {
    return this.rows.filter((_row, index) => this.chainKeyAt(index) === chainKey);
  }

  public links(chainKey: string): readonly StoredChainLink[] {
    return this.readChain(chainKey).map(toStoredChainLink);
  }

  /**
   * Reescribe una fila SIN tocar su hash: eso es una manipulacion.
   *
   * Existe solo en el doble en memoria, y no puede existir en el adaptador
   * real: la tabla no admite UPDATE (DEC-007, tres capas). Aqui hace falta para
   * poder comprobar que el verificador se da cuenta.
   */
  public tamperWith(chainKey: string, index: number, overrides: Partial<AuditEventFields>): void {
    const chain = this.readChain(chainKey);
    const target = chain.at(index);
    if (target === undefined) {
      throw new Error(`No hay fila ${String(index)} en la cadena ${chainKey}.`);
    }
    const position = this.rows.indexOf(target);
    this.rows.splice(position, 1, { ...target, fields: { ...target.fields, ...overrides } });
  }
}

const PROMOTION_ID = "00000000-0000-4000-8000-00000000aaaa";

export const AUDIT_TEST_PROMOTION_ID = PROMOTION_ID;

/**
 * Hecho auditable completo y valido.
 *
 * Lleva los 18 campos de `AUDIT_EVENT_CANONICAL_FIELDS_V1`; si le faltara uno,
 * `projectCanonicalPayload` lanzaria, que es justo lo que debe pasar.
 */
export function buildAuditFields(
  index: number,
  overrides: Partial<AuditEventFields> = {},
): AuditEventFields {
  const suffix = index.toString(10).padStart(4, "0");
  const minute = (index % 60).toString(10).padStart(2, "0");

  return {
    id: `00000000-0000-4000-8000-0000000e${suffix}`,
    occurredAt: `2026-03-01T12:${minute}:00.000Z`,
    recordedAt: `2026-03-01T12:${minute}:01.000Z`,
    actorType: "STAFF",
    actorId: `00000000-0000-4000-8000-0000000a${suffix}`,
    actorRoles: ["promotions_manager"],
    action: "entry.adjustment_approved",
    targetEntityType: "Adjustment",
    targetEntityId: `00000000-0000-4000-8000-0000000d${suffix}`,
    promotionId: PROMOTION_ID,
    requestId: `req_${suffix}`,
    before: null,
    after: null,
    reasonCode: "MANUAL_ADJUSTMENT_APPROVED",
    reasonText: null,
    sourceIp: null,
    userAgent: null,
    metadata: { index },
    ...overrides,
  };
}
