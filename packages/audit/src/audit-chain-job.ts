/**
 * Job de verificacion de las cadenas de `audit_events` (DEC-008, DEC-037).
 *
 * ---------------------------------------------------------------------------
 * QUE ANADE ESTO SOBRE `runChainIntegrityJob`
 * ---------------------------------------------------------------------------
 *
 * `verifier.ts` es generico sobre los tres dominios de cadena. Este fichero fija
 * el dominio `audit_events` y anade lo que un job de verdad necesita y una
 * funcion pura no puede tener:
 *
 *   1. UN VEREDICTO GLOBAL. El job recorre N cadenas -una por promocion mas la
 *      `global`- y quien lo ejecuta necesita UNA respuesta, no N. El veredicto
 *      del conjunto es el PEOR de los individuales: una sola cadena
 *      `COMPROMISED` hace `COMPROMISED` al conjunto. Cualquier otra agregacion
 *      -mayoria, porcentaje- diria "casi todo bien" sobre un sistema en el que
 *      alguien manipulo evidencia.
 *
 *   2. LA ESCRITURA DEL PROPIO REGISTRO. La comprobacion de integridad es ella
 *      misma un hecho auditable: quien la lanzo, cuando, sobre que, con que
 *      resultado. Si no se escribiera, un atacante con acceso podria ejecutar
 *      el verificador, ver que le ha pillado, y no dejar rastro de haberlo
 *      ejecutado.
 *
 *      El registro se escribe en la MISMA cadena que se acaba de verificar, y
 *      eso es correcto: extiende la cadena con un eslabon mas, y la siguiente
 *      verificacion lo cubrira.
 *
 *   3. EL CONTRATO DE FALLO. `recordEvent` puede fallar -la base de datos, la
 *      transaccion-. El job NO se lo traga: propaga. Un verificador de
 *      integridad que se come sus propios errores es un adorno.
 *
 * ---------------------------------------------------------------------------
 * SIN SELLO EXTERNO EL VEREDICTO ES `UNSEALED`, NUNCA `INTACT` (DEC-037)
 * ---------------------------------------------------------------------------
 *
 * No hay almacen write-once configurado todavia, asi que el resultado esperado
 * HOY es `UNSEALED` en todas las cadenas. Eso no es un fallo del job: es el job
 * diciendo la verdad. La cadena es consistente consigo misma y eso no descarta
 * una reescritura completa y coherente, que es justo lo que el sello detecta.
 *
 * Cuando `verdict` sea `UNSEALED` en produccion, la accion correcta no es
 * silenciar la linea: es montar el almacen de `sealing.ts`.
 *
 * ---------------------------------------------------------------------------
 * COMO SE EJECUTA
 * ---------------------------------------------------------------------------
 *
 * Como funcion, desde donde sea: un manejador de pg-boss (DEC-020), un script
 * CLI o un test. No abre conexiones, no lee el reloj y no elige credenciales:
 * recibe el puerto de lectura, el almacen de sellos y el instante. Asi el mismo
 * codigo verifica en produccion y sobre un volcado entregado a un tercero.
 */

import { AUDIT_ACTIONS } from "./actions.js";
import { promotionIdFromChainKey } from "./audit-events.js";
import { CHAIN_DOMAIN_AUDIT_EVENT } from "./canonicalization.js";
import type { ChainHeadSealStore } from "./sealing.js";
import type { AuditActor } from "./types.js";
import { runChainIntegrityJob } from "./verifier.js";
import type {
  ChainIntegrityJobPort,
  ChainIntegrityReport,
  ChainIntegrityVerdict,
  AuditEventDraft,
} from "./verifier.js";

/** Nombre del job, estable, para registrarlo en pg-boss (DEC-020). */
export const AUDIT_CHAIN_VERIFICATION_JOB = "audit.verify-chains";

export interface VerifyAuditChainsInput {
  /** Lectura de las cadenas. Lo implementa el adaptador de base de datos. */
  readonly port: ChainIntegrityJobPort;
  /**
   * Almacen write-once de sellos. Hoy es
   * `createUnconfiguredChainHeadSealStore()`, que se niega, y el job lo traduce
   * a `UNSEALED` en vez de a un fallo (DEC-037).
   */
  readonly sealStore: ChainHeadSealStore;
  /** DEC-011: el instante llega como parametro. Nadie lee el reloj aqui. */
  readonly occurredAt: string;
  readonly actor: AuditActor;
  /**
   * Escritura del registro de la propia comprobacion. Opcional SOLO para poder
   * ejecutar el verificador sobre un volcado de solo lectura -el caso del
   * tercero que audita-. En produccion se pasa siempre.
   */
  readonly recordEvent?: (event: AuditEventDraft) => Promise<void>;
}

export interface VerifyAuditChainsResult {
  /** El PEOR veredicto individual. */
  readonly verdict: ChainIntegrityVerdict;
  readonly checkedChainCount: number;
  readonly reports: readonly ChainIntegrityReport[];
  readonly compromisedChainKeys: readonly string[];
  readonly unsealedChainKeys: readonly string[];
  /** Registros escritos, o los que se habrian escrito sin `recordEvent`. */
  readonly events: readonly AuditEventDraft[];
}

/** El peor de dos veredictos. `COMPROMISED` > `UNSEALED` > `INTACT`. */
function worse(left: ChainIntegrityVerdict, right: ChainIntegrityVerdict): ChainIntegrityVerdict {
  if (left === "COMPROMISED" || right === "COMPROMISED") {
    return "COMPROMISED";
  }
  if (left === "UNSEALED" || right === "UNSEALED") {
    return "UNSEALED";
  }
  return "INTACT";
}

/**
 * Verifica TODAS las cadenas del dominio `audit_events`.
 *
 * Una cadena sin filas se informa igualmente, con `linkCount` a cero. Omitirla
 * dejaria indistinguibles "esta promocion no genero eventos" y "los eventos de
 * esta promocion desaparecieron", que es exactamente la diferencia que un
 * verificador existe para detectar.
 */
export async function verifyAuditChains(
  input: VerifyAuditChainsInput,
): Promise<VerifyAuditChainsResult> {
  const job = await runChainIntegrityJob({
    domain: CHAIN_DOMAIN_AUDIT_EVENT,
    port: input.port,
    sealStore: input.sealStore,
    occurredAt: input.occurredAt,
    actor: input.actor,
  });

  const events: AuditEventDraft[] = [];
  let verdict: ChainIntegrityVerdict = "INTACT";

  for (const report of job.reports) {
    verdict = worse(verdict, report.verdict);

    // El borrador que produce el verificador lleva la CLAVE DE CADENA en
    // `promotionId`, y la columna es `uuid`. La cadena `global` se traduce a
    // NULL; la clave real viaja igualmente en `targetEntityId` para que el
    // registro diga sobre que se ejecuto.
    const event: AuditEventDraft = {
      ...report.auditEvent,
      action:
        report.verdict === "COMPROMISED"
          ? AUDIT_ACTIONS.INTEGRITY_FAILURE
          : AUDIT_ACTIONS.INTEGRITY_CHECK,
      promotionId: promotionIdFromChainKey(report.promotionId),
      targetEntityId: report.promotionId,
      metadata: { ...report.auditEvent.metadata, chain_key: report.promotionId },
    };
    events.push(event);

    if (input.recordEvent !== undefined) {
      // Sin `try`: si el registro de la comprobacion no se puede escribir, el
      // job falla. Un verificador que informa "todo bien" sin haber podido
      // dejar constancia de que se ejecuto no ha verificado nada comprobable.
      await input.recordEvent(event);
    }
  }

  return {
    verdict,
    checkedChainCount: job.reports.length,
    reports: job.reports,
    compromisedChainKeys: job.compromisedPromotionIds,
    unsealedChainKeys: job.unsealedPromotionIds,
    events,
  };
}
