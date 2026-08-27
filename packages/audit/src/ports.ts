/**
 * Adaptadores de `@lsw/audit` para los puertos de `@lsw/tpa`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE FICHERO EXISTE, Y POR QUE NO HAY UN `import` ENTRE LOS DOS
 * ---------------------------------------------------------------------------
 *
 * `@lsw/tpa` necesita tres cosas que viven aqui: la forma canonica, la hash
 * chain y el generador reproducible del artefacto. La tentacion evidente es que
 * `@lsw/tpa` dependa de `@lsw/audit` y las llame. No lo hace, y la razon no es
 * de gusto:
 *
 *   - `@lsw/tpa` es DOMINIO. Su servicio de sorteo decide si se puede sortear y
 *     que ordinal sale; no debe conocer SHA-256 ni RFC 8785, igual que no
 *     conoce PostgreSQL. Lo que necesita lo declara como PUERTO y lo recibe
 *     montado.
 *   - Con puertos, el mismo servicio se prueba con un hasher de juguete -para
 *     comprobar que llama a lo que dice llamar- y se ejecuta en produccion con
 *     este, que es el de verdad.
 *
 * La compatibilidad es ESTRUCTURAL: las funciones de aqui encajan en los
 * puertos de `@lsw/tpa` porque tienen la forma que esos puertos declaran, sin
 * que ninguno de los dos paquetes importe al otro. Quien los une es
 * `apps/api` -y, hoy, `tests/security`-, que es el unico sitio donde tiene
 * sentido decidir con que implementacion concreta corre el dominio.
 *
 * Si manana el paquete pasa a depender del otro, esto seguira funcionando; lo
 * que se habra perdido es la posibilidad de probar el dominio sin arrastrar la
 * criptografia.
 */

import { canonicalizeToBytes } from "./canonical.js";
import type { CanonicalObject } from "./canonical.js";
import {
  CHAIN_DOMAIN_DRAWING_EVENT,
  CURRENT_CANONICALIZATION_VERSION,
} from "./canonicalization.js";
import { computeChainHash, fromHex, hashesEqual, toHex, verifyChain } from "./chain.js";
import type { StoredChainLink } from "./chain.js";
import { buildExportArtifact } from "./export-artifact.js";
import type { ExportArtifact, ExportArtifactRequest } from "./export-artifact.js";

/**
 * Encadenador de registros de sorteo (DEC-017 sobre DEC-008).
 *
 * `previousHashHex` a `null` significa "primera fila de esta promocion", y el
 * genesis lo deriva `computeChainHash` del par (dominio, promocion). No es
 * ceros: ver la cabecera de `chain.ts`.
 */
export function createDrawingEventChainPort(): {
  readonly domain: string;
  readonly canonicalizationVersion: number;
  hashRecord(input: {
    readonly promotionId: string;
    /**
     * `unknown` y no `CanonicalValue` a proposito: el que llama es un dominio
     * que no conoce esta canonicalizacion, y su payload viene de una fila. La
     * validacion NO se pierde -`canonicalizeToBytes` recorre cada valor y lanza
     * ante un `undefined`, un `Date` o un decimal-, simplemente ocurre en
     * ejecucion, que es donde tiene que ocurrir cuando el dato es ajeno.
     */
    readonly payload: Readonly<Record<string, unknown>>;
    readonly previousHashHex: string | null;
  }): string;
} {
  return {
    domain: CHAIN_DOMAIN_DRAWING_EVENT,
    canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
    hashRecord: (input) =>
      toHex(
        computeChainHash({
          domain: CHAIN_DOMAIN_DRAWING_EVENT,
          promotionId: input.promotionId,
          canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
          // El unico cast del modulo, y esta en la frontera: justo antes de una
          // funcion que valida en ejecucion todo lo que el tipo prometia.
          payload: input.payload as CanonicalObject,
          previousHash: input.previousHashHex === null ? null : fromHex(input.previousHashHex),
        }),
      ),
  };
}

/** Verifica la cadena de sorteos de una promocion. Funcion pura sobre filas ya leidas. */
export function verifyDrawingEventChain(input: {
  readonly promotionId: string;
  readonly links: readonly StoredChainLink[];
}): ReturnType<typeof verifyChain> {
  return verifyChain({
    domain: CHAIN_DOMAIN_DRAWING_EVENT,
    promotionId: input.promotionId,
    links: input.links,
  });
}

/** Generador del artefacto, montado como puerto para `@lsw/tpa`. */
export function createExportArtifactPort(): {
  build(request: ExportArtifactRequest): ExportArtifact;
} {
  return { build: (request) => buildExportArtifact(request) };
}

/**
 * Cerrojo 4 de DEC-017: el sorteo no confia en el `content_digest` guardado,
 * lo RECALCULA desde los registros y compara.
 *
 * La diferencia entre leer el hash y recalcularlo es toda la diferencia. El
 * guardado esta en la misma base de datos que los datos que resume: quien pueda
 * cambiar unos puede cambiar el otro, y entonces el hash certifica la version
 * manipulada. Recalcular desde el ledger obliga a que las dos manipulaciones
 * sean coherentes entre si, y ademas coherentes con el sello externo si lo hay.
 *
 * La comparacion es en tiempo constante por higiene, no porque aqui haya un
 * secreto: es el mismo criterio que en `chain.ts`.
 */
export function verifyContentDigest(input: {
  readonly request: ExportArtifactRequest;
  readonly expectedContentDigest: string;
}): {
  readonly matches: boolean;
  readonly recomputedContentDigest: string;
  readonly expectedContentDigest: string;
} {
  const recomputed = buildExportArtifact(input.request).contentDigest;
  // Un digest guardado con basura dentro no debe hacer LANZAR a la comprobacion:
  // debe hacerla decir que no. Un cerrojo que revienta en vez de negarse acaba
  // envuelto en un try/catch que "no era importante".
  const wellFormed = /^[0-9a-f]{64}$/u.test(input.expectedContentDigest);
  return {
    matches: wellFormed && hashesEqual(fromHex(recomputed), fromHex(input.expectedContentDigest)),
    recomputedContentDigest: recomputed,
    expectedContentDigest: input.expectedContentDigest,
  };
}

/**
 * Forma canonica de un objeto arbitrario, como bytes.
 *
 * Se reexporta con nombre propio para que `@lsw/tpa` pueda declarar un puerto
 * "serializador canonico" sin nombrar RFC 8785 en su dominio.
 */
export function canonicalBytes(value: CanonicalObject): Uint8Array {
  return canonicalizeToBytes(value);
}
