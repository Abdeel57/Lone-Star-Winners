/**
 * Adaptadores en memoria del resto de puertos.
 *
 * Sirven para dos cosas y solo dos: ejercitar el dominio en tests sin base de
 * datos, y dejar escrita la FORMA que tendra que cumplir el adaptador Drizzle
 * de la ronda siguiente (migraciones 0020+).
 *
 * Ninguno de ellos lee el reloj: los instantes llegan como parametro, igual que
 * en el dominio (DEC-011).
 */

import type { EntrySourceType } from "../enums.js";
import type { EntryNumberRange } from "../ledger.js";
import type {
  EntryBatchRecord,
  EntryNumberFormat,
  EntryNumberPort,
} from "../ports/entry-numbers.js";
import type { ParticipantIdentityPort, ParticipantIdentitySnapshot } from "../ports/identity.js";
import type { PromotionContext, PromotionContextPort } from "../ports/promotion-context.js";
import type {
  CalculationSnapshotInput,
  CalculationSnapshotRecord,
  CalculationSnapshotRepository,
} from "../ports/snapshot-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

/**
 * Snapshots de calculo en memoria.
 *
 * `save` es IDEMPOTENTE por `(promotionId, sourceType, sourceRef,
 * engineVersion)`, igual que la restriccion
 * `entry_calculation_snapshots_unique_source`: recalcular la misma fuente con
 * el mismo motor tiene que dar el mismo resultado, asi que guardarlo dos veces
 * solo crearia dos versiones de la misma verdad. Devolver el existente -en vez
 * de fallar- es lo que permite que un reintento de award encuentre su snapshot
 * y siga adelante hasta chocar contra la idempotencia del ledger, que es donde
 * debe chocar.
 */
export class InMemoryCalculationSnapshotRepository implements CalculationSnapshotRepository {
  private readonly byId = new Map<string, CalculationSnapshotRecord>();
  private readonly bySource = new Map<string, CalculationSnapshotRecord>();

  private static key(
    promotionId: string,
    sourceType: EntrySourceType,
    sourceRef: string,
    engineVersion: number,
  ): string {
    return `${promotionId} ${sourceType} ${sourceRef} ${String(engineVersion)}`;
  }

  public save(input: CalculationSnapshotInput): Promise<CalculationSnapshotRecord> {
    const key = InMemoryCalculationSnapshotRepository.key(
      input.promotionId,
      input.sourceType,
      input.sourceRef,
      input.engineVersion,
    );
    const existing = this.bySource.get(key);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    const record: CalculationSnapshotRecord = Object.freeze({ ...input });
    this.byId.set(record.id, record);
    this.bySource.set(key, record);
    return Promise.resolve(record);
  }

  public findById(id: string): Promise<CalculationSnapshotRecord | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  public findBySource(
    promotionId: string,
    sourceType: EntrySourceType,
    sourceRef: string,
    engineVersion: number,
  ): Promise<CalculationSnapshotRecord | null> {
    return Promise.resolve(
      this.bySource.get(
        InMemoryCalculationSnapshotRepository.key(
          promotionId,
          sourceType,
          sourceRef,
          engineVersion,
        ),
      ) ?? null,
    );
  }

  public all(): readonly CalculationSnapshotRecord[] {
    return [...this.byId.values()];
  }
}

/**
 * Pozo de numeros en memoria.
 *
 * Reproduce las dos garantias que importan: la secuencia SOLO AVANZA -un
 * reversal no devuelve numeros al pozo, porque reutilizar un identificador
 * haria que significase dos cosas en dos momentos- y dos bloques de la misma
 * promocion NO SE SOLAPAN, que en PostgreSQL lo garantiza una exclusion GiST.
 */
export class InMemoryEntryNumberPort implements EntryNumberPort {
  private readonly nextNumber = new Map<string, bigint>();
  private readonly formats = new Map<string, EntryNumberFormat>();
  private readonly batches: EntryBatchRecord[] = [];

  public constructor(formats: ReadonlyMap<string, EntryNumberFormat> = new Map()) {
    for (const [promotionId, format] of formats) {
      this.formats.set(promotionId, format);
      this.nextNumber.set(promotionId, 1n);
    }
  }

  public allocateRange(promotionId: string, quantity: number): Promise<EntryNumberRange> {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return Promise.reject(new RangeError("Un rango de entries exige una cantidad positiva."));
    }
    const start = this.nextNumber.get(promotionId);
    if (start === undefined) {
      return Promise.reject(
        new RangeError(`La promocion ${promotionId} no tiene secuencia de numeros inicializada.`),
      );
    }
    const end = start + BigInt(quantity);
    this.nextNumber.set(promotionId, end);
    return Promise.resolve({ start, end });
  }

  public saveBatch(record: EntryBatchRecord): Promise<EntryBatchRecord> {
    const overlaps = this.batches.some(
      (batch) =>
        batch.promotionId === record.promotionId &&
        batch.range.start < record.range.end &&
        record.range.start < batch.range.end,
    );
    if (overlaps) {
      return Promise.reject(
        new RangeError(
          `DEC-009: el bloque de numeros se solapa con otro de la promocion ${record.promotionId}.`,
        ),
      );
    }
    if (record.range.end - record.range.start !== BigInt(record.quantity)) {
      return Promise.reject(
        new RangeError("El rango declarado no coincide con la cantidad del bloque."),
      );
    }
    const frozen: EntryBatchRecord = Object.freeze({ ...record });
    this.batches.push(frozen);
    return Promise.resolve(frozen);
  }

  public listBatchesForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryBatchRecord[]> {
    return Promise.resolve(
      this.batches.filter(
        (batch) => batch.promotionId === promotionId && batch.participantId === participantId,
      ),
    );
  }

  public getFormat(promotionId: string): Promise<EntryNumberFormat | null> {
    return Promise.resolve(this.formats.get(promotionId) ?? null);
  }

  public all(): readonly EntryBatchRecord[] {
    return this.batches;
  }
}

/**
 * Contexto de promocion en memoria.
 *
 * Guarda tambien las configuraciones de versiones ARCHIVADAS, porque DEC-007
 * exige que un reversal se juzgue con las reglas de entonces y esas reglas
 * pueden llevar meses sin estar vigentes.
 */
export class InMemoryPromotionContextPort implements PromotionContextPort {
  private readonly contexts = new Map<string, PromotionContext>();
  private readonly rulesConfigs = new Map<string, unknown>();

  public register(context: PromotionContext): void {
    this.contexts.set(context.promotionId, context);
    this.rulesConfigs.set(context.rulesVersionId, context.rulesConfig);
  }

  /** Registra una version de reglas historica, sin hacerla vigente. */
  public registerRulesVersion(rulesVersionId: string, config: unknown): void {
    this.rulesConfigs.set(rulesVersionId, config);
  }

  public getContext(promotionId: string): Promise<PromotionContext | null> {
    return Promise.resolve(this.contexts.get(promotionId) ?? null);
  }

  public getRulesConfig(rulesVersionId: string): Promise<unknown> {
    if (!this.rulesConfigs.has(rulesVersionId)) {
      return Promise.reject(
        new RangeError(`DEC-012: version de reglas desconocida: ${rulesVersionId}`),
      );
    }
    return Promise.resolve(this.rulesConfigs.get(rulesVersionId));
  }
}

/** Identidad en memoria. Solo el instante de verificacion; nada mas del modulo de identidad. */
export class InMemoryParticipantIdentityPort implements ParticipantIdentityPort {
  private readonly snapshots = new Map<string, ParticipantIdentitySnapshot>();

  public set(participantId: string, emailVerifiedAt: Date | null): void {
    this.snapshots.set(participantId, { participantId, emailVerifiedAt });
  }

  public getIdentitySnapshot(participantId: string): Promise<ParticipantIdentitySnapshot | null> {
    return Promise.resolve(this.snapshots.get(participantId) ?? null);
  }
}

/**
 * Unidad de trabajo en memoria.
 *
 * ES UN PASO A TRAVES, Y ESO ESTA DICHO A PROPOSITO EN VEZ DE DISIMULADO.
 *
 * No hay rollback: revertir escrituras en memoria seria simular una garantia
 * que el adaptador real obtiene de PostgreSQL, y un doble que simula garantias
 * hace que los tests midan al doble en vez de al dominio.
 *
 * El dominio no depende del rollback para ser correcto, y esa es la propiedad
 * que de verdad importa: la idempotencia la impone una restriccion de unicidad
 * (DEC-009), no una transaccion; `save` de snapshots es idempotente por su
 * clave; y un award que choca contra la idempotencia del ledger devuelve el
 * resultado existente en vez de dejar basura a medias.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  public depth = 0;

  public async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.depth += 1;
    try {
      return await work();
    } finally {
      this.depth -= 1;
    }
  }
}
