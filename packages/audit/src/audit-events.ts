/**
 * Camino de ESCRITURA de la cadena de `audit_events` (DEC-007, DEC-008,
 * DEC-035, DEC-037).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE FICHERO EXISTE, HABIENDO YA `chain.ts`
 * ---------------------------------------------------------------------------
 *
 * `chain.ts` sabe hashear una FILA YA PROYECTADA. No sabe -y no debe saber-
 * como se llega de un hecho auditable a esa fila: que campos la componen, con
 * que nombres, en que formato viajan los instantes y que cadena le toca.
 *
 * Ese trayecto es exactamente donde una hash chain se rompe en la practica. El
 * fallo tipico no es criptografico, es de fontaneria: el escritor hashea
 * `occurred_at` con microsegundos y la base de datos guarda milisegundos, o
 * hashea el objeto `metadata` con las claves en un orden y lo lee con otro. La
 * cadena verifica el dia que se escribe y deja de verificar en cuanto alguien
 * la relee. Cuando eso pasa, no hay forma de saber si la discrepancia es un
 * error de formato o una manipulacion, y una evidencia ambigua no es evidencia.
 *
 * La defensa es que ESCRITOR Y VERIFICADOR construyan el payload con LA MISMA
 * funcion. `buildAuditEventPayload` es esa funcion. El adaptador de base de
 * datos no la reimplementa: le entrega los campos y recibe el hash.
 *
 * ---------------------------------------------------------------------------
 * LOS INSTANTES SE EXIGEN NORMALIZADOS, NO SE NORMALIZAN AQUI
 * ---------------------------------------------------------------------------
 *
 * `occurredAt` y `recordedAt` llegan como ISO-8601 UTC con milisegundos
 * exactos, y se rechaza cualquier otra forma. La tentacion es normalizar en
 * silencio -aceptar `+00:00`, aceptar microsegundos, redondear-, y es una
 * trampa: quien normaliza en el escritor tiene que normalizar IDENTICAMENTE en
 * el verificador, en el exportador y en cualquier tercero que reproduzca el
 * hash con una libreria estandar. Una sola de esas normalizaciones que difiera
 * produce una cadena que solo verifica con nuestro codigo, que es justo lo que
 * DEC-008 quiere evitar.
 *
 * Milisegundos y no microsegundos porque `timestamptz` guarda microsegundos y
 * JavaScript solo tiene milisegundos: si el escritor pudiera hashear un
 * instante con precision de microsegundo, la fila releida daria otro valor y la
 * cadena naceria rota. Es el mismo motivo por el que `recorded_at` no tiene
 * `DEFAULT` en la tabla.
 *
 * ---------------------------------------------------------------------------
 * DOS CADENAS, NO UNA: `promotion_id` Y EL DOMINIO `global`
 * ---------------------------------------------------------------------------
 *
 * DEC-008 encadena POR PROMOCION. Pero hay hechos auditables que no pertenecen
 * a ninguna: un cambio de rol, un inicio de sesion fallido, la creacion de una
 * cuenta de personal. Meterlos en la cadena de una promocion cualquiera seria
 * mentir sobre su alcance; dejarlos sin cadena los dejaria sin proteccion, que
 * es peor, porque son precisamente los hechos que usa quien prepara un fraude.
 *
 * Van a una cadena propia con clave `global`. La clave entra en el preimage
 * (DEC-035), asi que una fila de `global` no puede presentarse como fila de una
 * promocion ni al reves.
 */

import type { CanonicalObject, CanonicalValue } from "./canonical.js";
import {
  AUDIT_EVENT_CANONICAL_FIELDS_V1,
  CHAIN_DOMAIN_AUDIT_EVENT,
  CURRENT_CANONICALIZATION_VERSION,
  projectCanonicalPayload,
} from "./canonicalization.js";
import type { ChainDomain } from "./canonicalization.js";
import { computeChainHash, fromHex, genesisHash, toHex } from "./chain.js";
import type { StoredChainLink } from "./chain.js";
import type { AuditActorType } from "./types.js";

/**
 * Clave de la cadena de los hechos que no pertenecen a ninguna promocion.
 *
 * Es una cadena de texto y no un UUID centinela a proposito: un UUID inventado
 * podria confundirse con el de una promocion real en cualquier informe, y la
 * columna `promotion_id` de esos registros es NULL, que es la verdad.
 */
export const AUDIT_CHAIN_GLOBAL_KEY = "global";

/** Cadena a la que pertenece un hecho. Deriva de `promotion_id`, sin excepciones. */
export function auditChainKey(promotionId: string | null): string {
  return promotionId ?? AUDIT_CHAIN_GLOBAL_KEY;
}

/**
 * Inversa de `auditChainKey`.
 *
 * Hace falta porque el verificador recorre CLAVES DE CADENA y el evento
 * `INTEGRITY_CHECK` que produce lleva `promotion_id`, que es una columna `uuid`.
 * Escribir la cadena `global` en esa columna reventaria el INSERT; escribirla
 * en una promocion inventada seria peor.
 */
export function promotionIdFromChainKey(chainKey: string): string | null {
  return chainKey === AUDIT_CHAIN_GLOBAL_KEY ? null : chainKey;
}

/**
 * Forma ISO-8601 UTC con milisegundos exactos: la unica aceptada en el payload.
 *
 * Literal y no `new RegExp(...)`: en un literal las barras invertidas son las
 * de la expresion regular y no las de una cadena, que es el fallo que persigue
 * `lsw/no-unraw-regexp-source` (HO-014).
 */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function requireInstant(value: string, field: string): string {
  if (!INSTANT_PATTERN.test(value)) {
    throw new Error(
      `${field} debe ser ISO-8601 UTC con milisegundos exactos (2026-01-31T12:00:00.000Z); ` +
        `llego "${value}". No se normaliza en silencio: el escritor, el verificador y un ` +
        "tercero con una libreria estandar tienen que producir los mismos bytes.",
    );
  }
  return value;
}

/**
 * Campos de un hecho auditable, tal y como los conoce quien lo escribe.
 *
 * Es `camelCase` porque es una interfaz de TypeScript; el payload que se hashea
 * usa los nombres de columna. La traduccion entre ambos ocurre en UN sitio,
 * abajo.
 */
export interface AuditEventFields {
  readonly id: string;
  /** ISO-8601 UTC con milisegundos. Cuando ocurrio el hecho (DEC-011). */
  readonly occurredAt: string;
  /** ISO-8601 UTC con milisegundos. Cuando se registro. Lo fija quien inserta. */
  readonly recordedAt: string;
  readonly actorType: AuditActorType;
  /** Identificador interno. Nunca un correo ni un nombre. */
  readonly actorId: string | null;
  /** Roles efectivos EN EL MOMENTO de la accion. El orden entra en el hash. */
  readonly actorRoles: readonly string[];
  /** Clave del catalogo de `actions.ts`. */
  readonly action: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string | null;
  readonly promotionId: string | null;
  readonly requestId: string | null;
  /** Diff YA saneado por `redactDiff`. Nunca un objeto crudo de dominio. */
  readonly before: CanonicalObject | null;
  readonly after: CanonicalObject | null;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  /**
   * DIGEST de la direccion, jamas la direccion. El nombre de columna lo fija
   * `AUDIT_EVENT_CANONICAL_FIELDS_V1`, que es v1 y esta congelado; la
   * restriccion `audit_events_source_ip_is_digest` impide que la columna
   * guarde otra cosa.
   */
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
  readonly metadata: CanonicalObject;
}

/**
 * Payload canonico de un hecho: los 18 campos de la v1, con nombres de columna.
 *
 * La proyeccion final la hace `projectCanonicalPayload`, que EXIGE que esten
 * los 18. Un campo que se olvide aqui no produce un `null` por cortesia:
 * produce una excepcion, y el hecho no se escribe.
 */
export function buildAuditEventPayload(fields: AuditEventFields): CanonicalObject {
  const row = new Map<string, CanonicalValue>([
    ["action", fields.action],
    ["actor_id", fields.actorId],
    ["actor_roles", [...fields.actorRoles]],
    ["actor_type", fields.actorType],
    ["after", fields.after],
    ["before", fields.before],
    ["id", fields.id],
    ["metadata", fields.metadata],
    ["occurred_at", requireInstant(fields.occurredAt, "occurred_at")],
    ["promotion_id", fields.promotionId],
    ["reason_code", fields.reasonCode],
    ["reason_text", fields.reasonText],
    ["recorded_at", requireInstant(fields.recordedAt, "recorded_at")],
    ["request_id", fields.requestId],
    ["source_ip", fields.sourceIp],
    ["target_entity_id", fields.targetEntityId],
    ["target_entity_type", fields.targetEntityType],
    ["user_agent", fields.userAgent],
  ]);

  return projectCanonicalPayload(Object.fromEntries(row), AUDIT_EVENT_CANONICAL_FIELDS_V1);
}

/**
 * Puerto de encadenado de `audit_events`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ES UN PUERTO Y NO UN `import` DESDE `packages/database`
 * ---------------------------------------------------------------------------
 *
 * `packages/database` NO depende de `@lsw/audit`, igual que no depende de
 * `@lsw/tpa` (ver la cabecera de `src/repositories/tpa-ports.ts`). Anadir la
 * dependencia exige tocar `package.json` y correr `pnpm install`, y esa tarea
 * esta asignada al Team Lead en HO-028.
 *
 * La alternativa -que el adaptador recalcule el preimage con `node:crypto`-
 * seria una SEGUNDA implementacion de la cadena. Dos implementaciones de un
 * hash no son redundancia: son la garantia de que un dia diferiran, y ese dia
 * la cadena dejara de verificar sin que nadie sepa cual de las dos tenia razon.
 *
 * Con el puerto, la construccion del hash existe una sola vez -aqui- y el
 * adaptador solo pone SQL: el cerrojo, la lectura de la cabeza y el INSERT.
 */
export interface AuditEventChainPort {
  readonly domain: ChainDomain;
  readonly canonicalizationVersion: number;
  /**
   * Ancla de una cadena vacia. Se GUARDA en la primera fila en vez de dejar
   * `chain_prev_hash` a NULL, y no es cosmetico: con NULL, la restriccion
   * `UNIQUE (chain_key, chain_prev_hash)` no impediria dos filas iniciales
   * -en PostgreSQL los NULL son distintos entre si- y la cadena podria
   * bifurcarse en su primer eslabon.
   */
  genesisHashHex(chainKey: string): string;
  hashEvent(input: {
    readonly chainKey: string;
    readonly previousHashHex: string;
    readonly fields: AuditEventFields;
  }): string;
}

export function createAuditEventChainPort(): AuditEventChainPort {
  return {
    domain: CHAIN_DOMAIN_AUDIT_EVENT,
    canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
    genesisHashHex: (chainKey) => toHex(genesisHash(CHAIN_DOMAIN_AUDIT_EVENT, chainKey)),
    hashEvent: (input) =>
      toHex(
        computeChainHash({
          domain: CHAIN_DOMAIN_AUDIT_EVENT,
          promotionId: input.chainKey,
          canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
          payload: buildAuditEventPayload(input.fields),
          previousHash: fromHex(input.previousHashHex),
        }),
      ),
  };
}

/** Fila leida, tal y como la devuelve el adaptador para verificar. */
export interface StoredAuditEventRow {
  /** `sequence_no` como cadena de digitos: es `bigint` en la tabla. */
  readonly sequence: string;
  readonly canonicalizationVersion: number;
  readonly chainHashHex: string;
  readonly chainPrevHashHex: string;
  readonly fields: AuditEventFields;
}

/**
 * Convierte una fila leida en un eslabon verificable.
 *
 * Reconstruye el payload con `buildAuditEventPayload`, la MISMA funcion que uso
 * el escritor. Si el verificador tuviera la suya, la cadena solo probaria que
 * las dos coinciden consigo mismas.
 */
export function toStoredChainLink(row: StoredAuditEventRow): StoredChainLink {
  return {
    id: row.fields.id,
    sequence: row.sequence,
    canonicalizationVersion: row.canonicalizationVersion,
    row: buildAuditEventPayload(row.fields),
    storedHash: fromHex(row.chainHashHex),
    storedPreviousHash: fromHex(row.chainPrevHashHex),
  };
}
