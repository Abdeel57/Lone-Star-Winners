/**
 * Puertos de `@lsw/tpa`.
 *
 * ---------------------------------------------------------------------------
 * QUE ES UN PUERTO AQUI, Y POR QUE TODO ESTE PAQUETE ES DOMINIO PURO
 * ---------------------------------------------------------------------------
 *
 * Este paquete decide dos cosas que un tercero puede tener que revisar dentro
 * de dos anos: si se podia sortear, y que salio. Nada de eso debe depender de
 * si la base de datos es PostgreSQL, de si el reloj del servidor va adelantado
 * o de que libreria calcula SHA-256.
 *
 * Por eso el dominio no abre conexiones, no lee el reloj, no genera bytes
 * aleatorios y no serializa ficheros. Lo pide todo por estos puertos, y quien
 * los monta -`apps/api` en produccion, `tests/security` en las pruebas- decide
 * con que. La consecuencia practica es que los cinco cerrojos de DEC-017 se
 * pueden probar EN NEGATIVO uno a uno, con un puerto roto cada vez, que es la
 * unica forma de saber que un cerrojo cierra: verlo negarse.
 *
 * ---------------------------------------------------------------------------
 * TRES PUERTOS QUE NO SON LO QUE PARECEN
 * ---------------------------------------------------------------------------
 *
 * `FeatureFlagPort` devuelve `boolean | null`, y `null` NO es `false`. Es "no
 * se ha consultado", y el dominio lo trata como negativa con motivo propio. La
 * diferencia importa el dia que la consulta del flag falle: un `catch` que
 * devolviera `false` seria correcto por accidente, y uno que devolviera `true`
 * seria un desastre silencioso. Con `null` no hay que adivinar cual ocurrio.
 *
 * `Csprng` entrega BYTES, no numeros. Si entregase "un entero entre 1 y N", el
 * sesgo de reduccion viviria en la implementacion -distinta en cada adaptador,
 * imposible de probar desde el dominio- en vez de en un unico sitio con
 * rechazo de muestreo. Ver `random.ts`.
 *
 * `AccessControlPort` no reimplementa RBAC: lo consulta. El catalogo de
 * capacidades, el step-up y la segunda aprobacion viven en `@lsw/security`, que
 * es su unica fuente de verdad. Lo que el dominio SI calcula es el hecho que
 * ese catalogo no puede conocer: si la segunda aprobacion existe, la dio otra
 * persona y sigue dentro de su TTL.
 */

import type { ExportDeliveryMethod, ExportSnapshotManifest } from "./snapshot.js";

// ---------------------------------------------------------------------------
// Tiempo
// ---------------------------------------------------------------------------

/**
 * Reloj.
 *
 * DEC-011: el dominio nunca lee el reloj por su cuenta -la regla de lint lo
 * prohibe en este paquete-. Un instante es un DATO del hecho registrado, y como
 * tal entra por un puerto: en un test se congela, y en produccion viene de un
 * solo sitio en vez de estar esparcido por veinte llamadas.
 */
export interface Clock {
  /** Instante actual en ISO-8601 UTC, con milisegundos. */
  now(): string;
}

// ---------------------------------------------------------------------------
// Aleatoriedad
// ---------------------------------------------------------------------------

/**
 * Fuente de bytes criptograficamente segura (DEC-017, cerrojo 5).
 *
 * El contrato es estricto a proposito: DEBE devolver exactamente `length`
 * bytes. El dominio lo comprueba en cada llamada y se niega a sortear si no se
 * cumple. Una fuente que devuelve de menos -o que devuelve siempre lo mismo- no
 * es un fallo transitorio del que recuperarse: es el escenario en el que el
 * resultado deja de ser aleatorio, y el unico comportamiento aceptable es no
 * sortear.
 */
export interface Csprng {
  randomBytes(length: number): Uint8Array;
}

// ---------------------------------------------------------------------------
// Configuracion legalmente material
// ---------------------------------------------------------------------------

export interface FeatureFlagPort {
  /**
   * Valor PERSISTIDO del flag (DEC-013 / DEC-032). Nunca una variable de
   * entorno: un flag legalmente material tiene que dejar rastro de quien lo
   * cambio y por que, y un fichero de entorno no deja ninguno.
   *
   * `null` = no evaluado. Ver la cabecera.
   */
  isEnabled(key: string, promotionId: string | null): Promise<boolean | null>;
}

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

export type AccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly detail: string };

export interface AccessControlRequest {
  /** Identificador del catalogo de `@lsw/security` (por ejemplo `draw.initiate`). */
  readonly capability: string;
  readonly actorId: string;
  readonly actorRoles: readonly string[];
  /** Segundos desde el ultimo MFA verificado; `null` si no hay ninguno. */
  readonly secondsSinceLastMfa: number | null;
  readonly reasonProvided: boolean;
  /** Lo calcula el dominio, no el catalogo: ver la cabecera. */
  readonly secondApprovalGranted: boolean;
  readonly featureFlagEnabled: boolean | null;
}

export interface AccessControlPort {
  decide(request: AccessControlRequest): Promise<AccessDecision>;
}

// ---------------------------------------------------------------------------
// Universo elegible
// ---------------------------------------------------------------------------

/**
 * Tramo contiguo de ordinales que pertenece a un lote de entries.
 *
 * Los ordinales son 1-based y AMBOS extremos son inclusivos. El universo de una
 * promocion es la union de los tramos: debe empezar en 1, no dejar hueco, no
 * solaparse y terminar exactamente en `total_eligible_entries`. El dominio lo
 * comprueba antes de sortear, porque un hueco significa que un ordinal valido
 * no pertenece a nadie y un solapamiento que pertenece a dos.
 *
 * `provenance` viaja con el tramo porque las entries de compra y las de AMOE
 * comparten universo pero NO pierden su origen (principio #9). El sorteo no
 * distingue entre ellas -no debe-, pero el registro del resultado si dice de
 * donde venia la que salio.
 */
export interface EntryBatchRange {
  readonly batchId: string;
  readonly participantReference: string;
  readonly provenance: string;
  readonly firstOrdinal: number;
  readonly lastOrdinal: number;
}

export interface SnapshotRepository {
  findManifest(snapshotId: string): Promise<ExportSnapshotManifest | null>;
  /**
   * RECALCULA el digest de contenido desde los registros de origen (cerrojo 4).
   *
   * No devuelve el guardado. Devolver el guardado convertiria el cerrojo en una
   * comparacion de un valor consigo mismo, que es la forma mas comoda de tener
   * una comprobacion que nunca falla.
   */
  recomputeContentDigest(snapshotId: string): Promise<string>;
  loadEntryRanges(snapshotId: string): Promise<readonly EntryBatchRange[]>;
}

// ---------------------------------------------------------------------------
// Integridad (se monta con `@lsw/audit`)
// ---------------------------------------------------------------------------

/** Objeto canonicalizable: enteros seguros, sin `undefined`, sin `Date`. */
export type RecordPayload = Readonly<Record<string, unknown>>;

/**
 * Encadenador de registros inmutables.
 *
 * Lo implementa `createDrawingEventChainPort()` de `@lsw/audit`. El dominio
 * solo sabe que existe algo que convierte (payload, hash anterior) en un hash
 * nuevo, y que dos payloads distintos no pueden dar el mismo.
 */
export interface RecordChainPort {
  readonly domain: string;
  readonly canonicalizationVersion: number;
  hashRecord(input: {
    readonly promotionId: string;
    readonly payload: RecordPayload;
    readonly previousHashHex: string | null;
  }): string;
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export interface AuditActorRef {
  readonly type: "PARTICIPANT" | "STAFF" | "SYSTEM" | "ANONYMOUS";
  readonly id: string | null;
  readonly roles: readonly string[];
}

/**
 * `AuditEvent` antes de que la base de datos le ponga id, sello y hash.
 *
 * Tiene la misma forma que el `AuditEventDraft` de `@lsw/audit` a proposito:
 * asi un `AuditSink` real lo acepta sin conversion y sin que este paquete
 * dependa de aquel. Si los dos se separan, el compilador lo dira en el punto de
 * montaje, que es donde debe decirlo.
 */
export interface AuditEventDraft {
  readonly occurredAt: string;
  readonly actor: AuditActorRef;
  readonly action: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string | null;
  readonly promotionId: string | null;
  readonly requestId: string | null;
  readonly before: RecordPayload | null;
  readonly after: RecordPayload | null;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
  readonly metadata: RecordPayload;
  readonly canonicalizationVersion: number;
}

export interface AuditRecorder {
  record(event: AuditEventDraft): Promise<void>;
}

// ---------------------------------------------------------------------------
// Anclaje externo del snapshot
// ---------------------------------------------------------------------------

export interface SnapshotSealRequest {
  readonly snapshotId: string;
  readonly promotionId: string;
  readonly contentDigest: string;
  readonly merkleRoot: string;
  readonly recordCount: number;
  readonly sealedBy: string;
}

export interface SnapshotSeal extends SnapshotSealRequest {
  /** Instante que declara EL ALMACEN, no el cliente. */
  readonly sealedAt: string;
  readonly storeId: string;
  readonly externalReference: string;
}

/**
 * Almacen write-once donde el digest del snapshot queda fuera del alcance de
 * quien administra la base de datos.
 *
 * Sin el, el snapshot es inmutable "porque el codigo no lo modifica", que es
 * una afirmacion sobre nuestras intenciones y no una prueba. Con el, cambiar el
 * snapshot obliga a cambiar tambien algo que vive en otro dominio de confianza.
 */
export interface SnapshotSealStore {
  readonly storeId: string;
  seal(request: SnapshotSealRequest): Promise<SnapshotSeal>;
  latest(snapshotId: string): Promise<SnapshotSeal | null>;
}

export class SnapshotSealStoreNotConfiguredError extends Error {
  public constructor(operation: string) {
    super(
      `No hay almacen write-once configurado; la operacion '${operation}' no puede ejecutarse. ` +
        "Sin anclaje externo, la inmutabilidad del snapshot depende de que nadie con acceso a la " +
        "base de datos quiera cambiarlo (DEC-008, DEC-016).",
    );
    this.name = "SnapshotSealStoreNotConfiguredError";
  }
}

/**
 * Almacen por defecto: se niega, de forma SINCRONA.
 *
 * Sincrona porque una promesa rechazada se pierde con facilidad -un `.catch`
 * vacio, un `void`, un `allSettled`- y entonces "no hay almacen" se confunde
 * con un fallo de red transitorio. Dentro de un `async` se convierte igualmente
 * en rechazo, asi que quien hace `await` no nota la diferencia.
 */
export function createUnconfiguredSnapshotSealStore(): SnapshotSealStore {
  const refuse = (operation: string): never => {
    throw new SnapshotSealStoreNotConfiguredError(operation);
  };
  return {
    storeId: "unconfigured",
    seal: () => refuse("seal"),
    latest: () => refuse("latest"),
  };
}

// ---------------------------------------------------------------------------
// Empaquetado y entrega
// ---------------------------------------------------------------------------

/** Miembro del paquete de export. Los bytes ya estan calculados. */
export interface ExportPackageMember {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/**
 * Empaquetador. Es un puerto porque el contenedor -ZIP, TAR, un prefijo en un
 * bucket- lo impone el administrador externo, que aun no esta elegido
 * (`docs/LEGAL_PENDING.md`), y porque el paquete debe poder generarse igual sin
 * ninguno.
 */
export interface ArchivePort {
  readonly formatId: string;
  readonly fileExtension: string;
  pack(members: readonly ExportPackageMember[]): Uint8Array;
}

export interface DeliveryAttempt {
  readonly externalReference: string;
  readonly deliveredAt: string;
  /** Hash que el destinatario dice haber recibido, si lo devuelve. */
  readonly acknowledgedSha256: string | null;
}

/**
 * Canal de entrega real. Su AUSENCIA es el estado por defecto, y es lo que
 * mantiene al adaptador en dry-run.
 */
export interface DeliveryChannel {
  readonly channelId: string;
  readonly method: ExportDeliveryMethod;
  send(input: {
    readonly manifest: ExportSnapshotManifest;
    readonly fileName: string;
    readonly payload: Uint8Array;
  }): Promise<DeliveryAttempt>;
}
