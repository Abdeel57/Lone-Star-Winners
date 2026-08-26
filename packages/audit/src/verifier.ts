/**
 * Job verificador de integridad (DEC-008).
 *
 * ---------------------------------------------------------------------------
 * DOS PREGUNTAS DISTINTAS, Y HAY QUE HACER LAS DOS
 * ---------------------------------------------------------------------------
 *
 *   1. "Es la cadena consistente consigo misma?"  -> `verifyChain`
 *   2. "Es la MISMA cadena que la de aquel dia?"  -> `compareWithSeal`
 *
 * Un verificador que solo hiciera la primera daria un informe verde a una base
 * de datos reescrita entera, que es precisamente el escenario contra el que
 * DEC-008 existe. Por eso el veredicto de este modulo no puede ser "INTACT"
 * cuando no hay sello: en ese caso es `UNSEALED`, un estado propio, visible y
 * distinto de "todo bien".
 *
 * ---------------------------------------------------------------------------
 * EL VERIFICADOR NO TOCA LA BASE DE DATOS
 * ---------------------------------------------------------------------------
 *
 * Recibe las filas y el sello, y devuelve un informe mas un `AuditEvent` sin
 * escribir. Quien lo ejecuta -`apps/api`, propiedad de `backend`- decide con
 * que credenciales lee y por donde escribe. Asi el nucleo de la verificacion
 * es una funcion pura, se puede probar con filas manipuladas a mano, y un
 * tercero puede ejecutarla sobre un volcado sin acceso al sistema.
 *
 * Tampoco lee el reloj: `occurredAt` llega como parametro (DEC-011). El
 * instante de un registro de auditoria es un dato del hecho, no una
 * conveniencia del proceso que lo escribe.
 */

import { AUDIT_ACTIONS } from "./actions.js";
import { CURRENT_CANONICALIZATION_VERSION } from "./canonicalization.js";
import type { ChainDomain } from "./canonicalization.js";
import { toHex, verifyChain } from "./chain.js";
import type { ChainVerificationResult, StoredChainLink } from "./chain.js";
import { compareWithSeal } from "./sealing.js";
import type { ChainHeadSeal, ChainHeadSealStore, SealComparison } from "./sealing.js";
import type { AuditActor, AuditEvent } from "./types.js";

/** `AuditEvent` antes de que la base de datos le ponga id, sello y hash. */
export type AuditEventDraft = Omit<AuditEvent, "id" | "recordedAt" | "hash" | "previousHash">;

/**
 * `INTACT`      cadena consistente Y anclada a un sello externo que coincide.
 * `UNSEALED`    cadena consistente, pero sin anclaje: no se puede descartar
 *               una reescritura completa. NO es un aprobado.
 * `COMPROMISED` hay roturas, o el sello externo no coincide.
 */
export type ChainIntegrityVerdict = "INTACT" | "UNSEALED" | "COMPROMISED";

/** Codigos estables de motivo (DEC-022: enum, nunca prosa traducible). */
export const INTEGRITY_REASON_CODES = Object.freeze({
  CHAIN_INTACT: "integrity.chain_intact",
  CHAIN_UNSEALED: "integrity.chain_unsealed",
  CHAIN_BROKEN: "integrity.chain_broken",
  SEAL_MISMATCH: "integrity.seal_mismatch",
  HEAD_SEALED: "integrity.head_sealed",
} as const);

export interface ChainIntegrityReport {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  readonly occurredAt: string;
  readonly verdict: ChainIntegrityVerdict;
  readonly chain: ChainVerificationResult;
  readonly seal: SealComparison;
  /** Listo para `AuditSink.record`. Quien lo ejecuta decide cuando escribirlo. */
  readonly auditEvent: AuditEventDraft;
}

export interface ChainIntegrityCheckInput {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  /** Filas de la promocion, ordenadas por `sequence_no` ascendente. */
  readonly links: readonly StoredChainLink[];
  /** Ultimo sello externo conocido, o `null` si nunca se sello. */
  readonly seal: ChainHeadSeal | null;
  readonly occurredAt: string;
  readonly actor: AuditActor;
  readonly requestId?: string | null;
}

/**
 * Head que la cadena tenia cuando alcanzaba `length` filas.
 *
 * Se toma del `chain_hash` GUARDADO de esa fila, no de uno recalculado: lo que
 * se quiere comparar con el sello es lo que la base de datos afirma hoy sobre
 * aquel punto. Si alguien reescribio el pasado, esa afirmacion cambio, y de eso
 * se trata.
 */
function headAtLength(links: readonly StoredChainLink[], length: number): string | null {
  if (length <= 0 || length > links.length) {
    return null;
  }
  const link = links.at(length - 1);
  return link === undefined ? null : toHex(link.storedHash);
}

export function runChainIntegrityCheck(input: ChainIntegrityCheckInput): ChainIntegrityReport {
  const chain = verifyChain({
    domain: input.domain,
    promotionId: input.promotionId,
    links: input.links,
  });

  const seal = compareWithSeal({
    seal: input.seal,
    observedLinkCount: input.links.length,
    observedHeadAtSealedLength:
      input.seal === null ? null : headAtLength(input.links, input.seal.linkCount),
    observedHeadHash: chain.observedHeadHash,
  });

  const sealDisagrees = seal.verdict === "HISTORY_REWRITTEN" || seal.verdict === "TRUNCATED";
  const verdict: ChainIntegrityVerdict =
    !chain.ok || sealDisagrees
      ? "COMPROMISED"
      : seal.verdict === "NEVER_SEALED"
        ? "UNSEALED"
        : "INTACT";

  const reasonCode = !chain.ok
    ? INTEGRITY_REASON_CODES.CHAIN_BROKEN
    : sealDisagrees
      ? INTEGRITY_REASON_CODES.SEAL_MISMATCH
      : verdict === "UNSEALED"
        ? INTEGRITY_REASON_CODES.CHAIN_UNSEALED
        : INTEGRITY_REASON_CODES.CHAIN_INTACT;

  const auditEvent: AuditEventDraft = {
    occurredAt: input.occurredAt,
    actor: input.actor,
    action:
      verdict === "COMPROMISED" ? AUDIT_ACTIONS.INTEGRITY_FAILURE : AUDIT_ACTIONS.INTEGRITY_CHECK,
    targetEntityType: input.domain,
    targetEntityId: null,
    promotionId: input.promotionId,
    requestId: input.requestId ?? null,
    before: null,
    after: null,
    reasonCode,
    reasonText: null,
    sourceIp: null,
    userAgent: null,
    // El evento lleva el resumen y los primeros fallos, no la cadena entera:
    // un `AuditEvent` de varios megabytes deja de leerse, y el detalle
    // completo se reproduce ejecutando el verificador sobre el mismo volcado.
    metadata: {
      verdict,
      link_count: chain.linkCount,
      observed_head_hash: chain.observedHeadHash,
      break_count: chain.breaks.length,
      first_breaks: chain.breaks.slice(0, 10),
      seal_verdict: seal.verdict,
      sealed_head_hash: seal.sealedHeadHash,
      sealed_link_count: seal.sealedLinkCount,
      seal_detail: seal.detail,
    },
    canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
  };

  return {
    domain: input.domain,
    promotionId: input.promotionId,
    occurredAt: input.occurredAt,
    verdict,
    chain,
    seal,
    auditEvent,
  };
}

/**
 * Puerto de lectura del job. Lo implementa `apps/api` sobre la base de datos.
 *
 * `loadLinks` devuelve la cadena COMPLETA de la promocion. Verificar solo la
 * cola seria mas barato y no serviria: la manipulacion que importa esta en el
 * pasado, que es donde nadie mira.
 */
export interface ChainIntegrityJobPort {
  listPromotionIds(domain: ChainDomain): Promise<readonly string[]>;
  loadLinks(domain: ChainDomain, promotionId: string): Promise<readonly StoredChainLink[]>;
}

export interface ChainIntegrityJobInput {
  readonly domain: ChainDomain;
  readonly port: ChainIntegrityJobPort;
  readonly sealStore: ChainHeadSealStore;
  readonly occurredAt: string;
  readonly actor: AuditActor;
}

export interface ChainIntegrityJobResult {
  readonly reports: readonly ChainIntegrityReport[];
  readonly compromisedPromotionIds: readonly string[];
  readonly unsealedPromotionIds: readonly string[];
}

/**
 * Recorre todas las promociones de un dominio.
 *
 * Si el almacen de sellos no esta configurado, `latestSeal` LANZA. El job no lo
 * trata como fallo: lo trata como "sin sello", que es la verdad, y el veredicto
 * resultante es `UNSEALED`. La alternativa -abortar el job entero- dejaria de
 * verificar la consistencia interna, que es lo unico que si se puede
 * comprobar hoy, y ademas esconderia el hecho de que no hay anclaje.
 */
export async function runChainIntegrityJob(
  input: ChainIntegrityJobInput,
): Promise<ChainIntegrityJobResult> {
  const reports: ChainIntegrityReport[] = [];

  for (const promotionId of await input.port.listPromotionIds(input.domain)) {
    const links = await input.port.loadLinks(input.domain, promotionId);

    let seal: ChainHeadSeal | null = null;
    try {
      seal = await input.sealStore.latestSeal(input.domain, promotionId);
    } catch {
      seal = null;
    }

    reports.push(
      runChainIntegrityCheck({
        domain: input.domain,
        promotionId,
        links,
        seal,
        occurredAt: input.occurredAt,
        actor: input.actor,
      }),
    );
  }

  return {
    reports,
    compromisedPromotionIds: reports
      .filter((report) => report.verdict === "COMPROMISED")
      .map((report) => report.promotionId),
    unsealedPromotionIds: reports
      .filter((report) => report.verdict === "UNSEALED")
      .map((report) => report.promotionId),
  };
}

/**
 * Sella el head actual y devuelve el `AuditEvent` correspondiente.
 *
 * Se sella el head OBSERVADO, y solo si la cadena verifica: sellar una cadena
 * rota convertiria la rotura en el nuevo punto de referencia y borraria la
 * unica prueba de que hubo un antes distinto.
 */
export async function sealChainHead(input: {
  readonly domain: ChainDomain;
  readonly promotionId: string;
  readonly links: readonly StoredChainLink[];
  readonly sealStore: ChainHeadSealStore;
  readonly canonicalizationVersion: number;
  readonly sealedBy: string;
  readonly occurredAt: string;
  readonly actor: AuditActor;
}): Promise<{ readonly seal: ChainHeadSeal; readonly auditEvent: AuditEventDraft }> {
  const chain = verifyChain({
    domain: input.domain,
    promotionId: input.promotionId,
    links: input.links,
  });

  if (!chain.ok || chain.observedHeadHash === null) {
    throw new Error(
      `No se sella el head de ${input.promotionId}: la cadena presenta ` +
        `${String(chain.breaks.length)} rotura(s). Sellar una cadena rota fijaria la ` +
        "manipulacion como punto de referencia.",
    );
  }

  const lastLink = input.links.at(-1);
  /* c8 ignore next 3 -- una cadena con head no vacio siempre tiene ultima fila */
  if (lastLink === undefined) {
    throw new Error("Cadena sin filas: no hay head que sellar.");
  }

  const seal = await input.sealStore.seal({
    domain: input.domain,
    promotionId: input.promotionId,
    headHash: chain.observedHeadHash,
    linkCount: chain.linkCount,
    lastSequence: lastLink.sequence,
    canonicalizationVersion: input.canonicalizationVersion,
    sealedBy: input.sealedBy,
  });

  return {
    seal,
    auditEvent: {
      occurredAt: input.occurredAt,
      actor: input.actor,
      action: AUDIT_ACTIONS.CHAIN_HEAD_SEALED,
      targetEntityType: input.domain,
      targetEntityId: null,
      promotionId: input.promotionId,
      requestId: null,
      before: null,
      after: null,
      reasonCode: INTEGRITY_REASON_CODES.HEAD_SEALED,
      reasonText: null,
      sourceIp: null,
      userAgent: null,
      metadata: {
        head_hash: seal.headHash,
        link_count: seal.linkCount,
        last_sequence: seal.lastSequence,
        store_id: seal.storeId,
        external_reference: seal.externalReference,
        sealed_at: seal.sealedAt,
      },
      canonicalizationVersion: input.canonicalizationVersion,
    },
  };
}
