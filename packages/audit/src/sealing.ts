/**
 * Sellado externo del `chain_head_hash` (DEC-008).
 *
 * ---------------------------------------------------------------------------
 * EL AGUJERO QUE ESTE FICHERO TAPA
 * ---------------------------------------------------------------------------
 *
 * La hash chain de `chain.ts` detecta que UNA fila fue alterada. No detecta
 * que TODAS lo fueran de forma coherente.
 *
 * Quien tenga acceso total a la base de datos -un administrador de sistemas, un
 * atacante que llegue hasta ahi, o el propio operador de la promocion- puede
 * cambiar una fila de marzo y recalcular los hashes de todas las posteriores.
 * El resultado es una cadena internamente perfecta: `verifyChain` la aprueba,
 * porque no tiene con que discrepar. La cadena solo prueba consistencia
 * interna, y la consistencia interna es exactamente lo que un atacante con
 * permisos de escritura puede fabricar.
 *
 * La unica defensa es que el valor del head en una fecha pasada exista FUERA de
 * su alcance. Si el head del 3 de marzo esta sellado en un almacen write-once
 * de otro dominio de confianza, la reescritura de marzo cambia el head de hoy y
 * tambien el que se sello aquel dia, y la discrepancia aparece sola.
 *
 * Sin este anclaje, DEC-008 seria append-only con pasos extra. CON el anclaje
 * es tamper-EVIDENT, que es lo que un tercero necesita para afirmar algo.
 *
 * ---------------------------------------------------------------------------
 * ESTADO: EL CONTRATO EXISTE, EL DESTINO NO
 * ---------------------------------------------------------------------------
 *
 * El almacen concreto -bucket con object-lock e inmutabilidad, servicio de
 * timestamping RFC 3161, notario de terceros, log de transparencia- es una
 * decision de infraestructura y de coste que el cliente no ha tomado. Se
 * escribe el contrato ahora y en abstracto, por la misma razon que el
 * adaptador del administrador externo en `packages/tpa`: cuando se elija, se
 * implementa un adaptador y no se toca el dominio.
 *
 * La implementacion por defecto SE NIEGA. Un stub que devolviera exito seria
 * peor que no tener nada: dejaria un registro que dice "sellado" sin que nadie
 * fuera de la base de datos tenga copia de ese valor, y la evidencia mas
 * peligrosa es la que parece existir.
 *
 * REQUISITOS NO NEGOCIABLES del almacen que se elija:
 *   - write-once real, verificable por el proveedor, no por convencion;
 *   - credenciales que el rol de la aplicacion NO pueda usar para sobrescribir;
 *   - retencion al menos igual a la de los registros que sella;
 *   - sello con instante propio del almacen, no el que le pase el cliente.
 */

import { fromHex, hashesEqual } from "./chain.js";
import type { ChainDomain } from "./canonicalization.js";

/** Sello ya escrito en el almacen externo. */
export interface ChainHeadSeal {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  /** Head en hexadecimal minusculas. */
  readonly headHash: string;
  /** Cuantas filas cubria el head en el momento del sello. */
  readonly linkCount: number;
  /** `sequence_no` de la ultima fila cubierta, como cadena de digitos. */
  readonly lastSequence: string;
  readonly canonicalizationVersion: number;
  /** Instante que declara EL ALMACEN, no el cliente. */
  readonly sealedAt: string;
  readonly sealedBy: string;
  /** Identificador del almacen. Un sello sin origen no prueba nada. */
  readonly storeId: string;
  /** Referencia devuelta por el almacen: es el acuse de recibo. */
  readonly externalReference: string;
}

export type ChainHeadSealRequest = Omit<
  ChainHeadSeal,
  "sealedAt" | "storeId" | "externalReference"
>;

export interface ChainHeadSealStore {
  readonly storeId: string;
  /** Escribe un sello. Debe fallar si ya existe uno para la misma clave. */
  seal(request: ChainHeadSealRequest): Promise<ChainHeadSeal>;
  /** Ultimo sello conocido de una cadena, o `null` si nunca se sello. */
  latestSeal(domain: ChainDomain, promotionId: string): Promise<ChainHeadSeal | null>;
  /** Historico completo, en orden ascendente de `lastSequence`. */
  listSeals(domain: ChainDomain, promotionId: string): Promise<readonly ChainHeadSeal[]>;
}

export class ChainSealStoreNotConfiguredError extends Error {
  public constructor(operation: string) {
    super(
      `No hay almacen write-once de sellos configurado; '${operation}' no puede ejecutarse. ` +
        "Sin sellado externo la hash chain detecta la alteracion de una fila pero NO la " +
        "reescritura completa del historico (DEC-008).",
    );
    this.name = "ChainSealStoreNotConfiguredError";
  }
}

/**
 * Almacen por defecto: falla en cerrado.
 *
 * Que exista este objeto no debilita nada. Lo que lo debilitaria es que
 * devolviera un sello inventado, porque entonces el informe de integridad
 * diria "head sellado" y nadie iria a comprobar donde.
 *
 * Rechaza de forma SINCRONA aunque los metodos declaren `Promise`, igual que
 * `createUnconfiguredTpaAdapter` en `@lsw/tpa`. Una promesa rechazada se puede
 * perder por el camino -un `.catch` vacio, un `void`, un `allSettled`- y
 * entonces "no hay almacen configurado" acabaria pareciendo un fallo
 * transitorio de red. Una excepcion sincrona no se traga. Dentro de una
 * funcion `async` se convierte igualmente en rechazo, asi que los llamadores
 * que hacen `await` no notan diferencia.
 */
export function createUnconfiguredChainHeadSealStore(): ChainHeadSealStore {
  const refuse = (operation: string): never => {
    throw new ChainSealStoreNotConfiguredError(operation);
  };

  return {
    storeId: "unconfigured",
    seal: () => refuse("seal"),
    latestSeal: () => refuse("latestSeal"),
    listSeals: () => refuse("listSeals"),
  };
}

export type SealComparisonVerdict =
  "MATCHES" | "NEVER_SEALED" | "AHEAD_OF_SEAL" | "HISTORY_REWRITTEN" | "TRUNCATED";

export interface SealComparison {
  readonly verdict: SealComparisonVerdict;
  readonly sealedHeadHash: string | null;
  readonly observedHeadHash: string | null;
  readonly sealedLinkCount: number | null;
  readonly observedLinkCount: number;
  readonly detail: string;
}

/**
 * Compara el estado observado de la cadena con el ultimo sello externo.
 *
 * ESTA es la comprobacion que atrapa la reescritura completa. `verifyChain`
 * responde "la cadena es consistente"; esta funcion responde "la cadena es la
 * MISMA que la de aquel dia", que es una pregunta distinta y la unica que un
 * tercero puede oponer a quien controla la base de datos.
 *
 * Se le pasa el prefijo observado hasta `sealedLinkCount` filas: el head actual
 * cubre mas filas que el sello -eso es lo normal, la cadena crece-, asi que
 * compararlos directamente daria siempre diferencia. Lo que debe coincidir es
 * el head que la cadena TENIA cuando alcanzo el numero de filas sellado.
 */
export function compareWithSeal(input: {
  readonly seal: ChainHeadSeal | null;
  readonly observedLinkCount: number;
  /** Head de la cadena truncada a `seal.linkCount` filas, en hexadecimal. */
  readonly observedHeadAtSealedLength: string | null;
  readonly observedHeadHash: string | null;
}): SealComparison {
  const { seal, observedLinkCount, observedHeadAtSealedLength, observedHeadHash } = input;

  if (seal === null) {
    return {
      verdict: "NEVER_SEALED",
      sealedHeadHash: null,
      observedHeadHash,
      sealedLinkCount: null,
      observedLinkCount,
      detail:
        "La cadena nunca se sello fuera de la base de datos. Es consistente consigo misma y " +
        "eso es todo lo que se puede afirmar: una reescritura completa seria indetectable.",
    };
  }

  if (observedLinkCount < seal.linkCount) {
    return {
      verdict: "TRUNCATED",
      sealedHeadHash: seal.headHash,
      observedHeadHash,
      sealedLinkCount: seal.linkCount,
      observedLinkCount,
      detail:
        `El sello cubre ${String(seal.linkCount)} filas y hoy se observan ` +
        `${String(observedLinkCount)}. Faltan filas que existieron.`,
    };
  }

  if (observedHeadAtSealedLength === null) {
    return {
      verdict: "TRUNCATED",
      sealedHeadHash: seal.headHash,
      observedHeadHash,
      sealedLinkCount: seal.linkCount,
      observedLinkCount,
      detail: "No se pudo reconstruir el head en la longitud sellada.",
    };
  }

  if (!hashesEqual(fromHex(observedHeadAtSealedLength), fromHex(seal.headHash))) {
    return {
      verdict: "HISTORY_REWRITTEN",
      sealedHeadHash: seal.headHash,
      observedHeadHash,
      sealedLinkCount: seal.linkCount,
      observedLinkCount,
      detail:
        "El head en la longitud sellada NO coincide con el sello externo. La cadena verifica " +
        "consigo misma, luego fue recalculada entera: alguien reescribio el historico.",
    };
  }

  return {
    verdict: observedLinkCount === seal.linkCount ? "MATCHES" : "AHEAD_OF_SEAL",
    sealedHeadHash: seal.headHash,
    observedHeadHash,
    sealedLinkCount: seal.linkCount,
    observedLinkCount,
    detail:
      observedLinkCount === seal.linkCount
        ? "El head coincide con el sello externo."
        : `El prefijo sellado coincide; la cadena crecio en ${String(observedLinkCount - seal.linkCount)} filas desde el sello.`,
  };
}
