/**
 * `AMOESubmission`: el envio, su huella y su cola de revision.
 *
 * ---------------------------------------------------------------------------
 * LA HUELLA NO INCLUYE AL PARTICIPANTE, Y ES DELIBERADO
 * ---------------------------------------------------------------------------
 *
 * `fingerprint = SHA256(promocion | modalidad | payload normalizado)`.
 *
 * La tentacion es meter el `participant_id` dentro. Con el dentro, la huella
 * solo detecta "esta persona envio dos veces lo mismo", que es justo el caso
 * que YA cubre el limite por periodo. Sin el, detecta ademas el caso que el
 * limite por periodo no puede ver: el MISMO envio presentado desde dos cuentas
 * distintas -un codigo reutilizado, una carta fotocopiada, un formulario
 * clonado por un script-.
 *
 * Son dos controles con dos alcances distintos y los dos hacen falta:
 *
 *   huella          -> unicidad del ENVIO dentro de la promocion
 *   limite/periodo  -> cuantos envios admite una PERSONA en una ventana
 *
 * ---------------------------------------------------------------------------
 * LA NORMALIZACION FORMA PARTE DE LA HUELLA
 * ---------------------------------------------------------------------------
 *
 * Sin normalizar, dos envios identicos con un espacio de mas, mayusculas
 * distintas o el mismo nombre tecleado en macOS (NFD) y en Windows (NFC)
 * producirian huellas distintas y el control no serviria para nada. Se aplica
 * NFC, se colapsa el espacio en blanco y se pasa a minusculas, en ese orden.
 *
 * NFC es la misma eleccion que hace `packages/audit` para la canonicalizacion
 * (DEC-035), por el mismo motivo.
 */

import { createHash } from "node:crypto";

import type { AmoeSubmissionStatus, AmoeMode } from "../enums.js";
import type { JsonObject } from "../json.js";

/**
 * Contenido de un envio.
 *
 * Es un mapa de clave a texto -no un objeto con forma fija- porque las cuatro
 * modalidades piden datos distintos y cual aplica lo dira el abogado. Las
 * claves requeridas las declara `identity_requirements` en la configuracion.
 */
export type AmoePayload = Readonly<Record<string, string>>;

/** Normaliza UN valor. Ver la cabecera para el porque de cada paso. */
export function normalizeAmoeValue(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * Longitud delante de cada campo, en vez de un separador.
 *
 * Un separador exige que exista un caracter que no pueda aparecer en el
 * contenido, y aqui no lo hay: el payload es texto libre que teclea una
 * persona. Sin longitudes, {a: "bc"} y {ab: "c"} se concatenan a la misma
 * cadena y producen la misma huella, de modo que dos envios distintos se
 * trataran como duplicados -o, segun la politica configurada, uno legitimo
 * quedara rechazado por culpa de otro-.
 *
 * Es la misma razon por la que el preimage de la hash chain lleva longitudes
 * explicitas (DEC-035).
 */
function lengthPrefixed(value: string): string {
  return `${value.length.toString(10)}:${value}`;
}

/**
 * Huella deterministica de un envio.
 *
 * Las claves se ordenan antes de serializar: dos envios con los mismos campos
 * en distinto orden son el mismo envio, y una huella que dependiera del orden
 * de insercion del objeto seria trivial de eludir.
 */
export function amoeFingerprint(promotionId: string, mode: AmoeMode, payload: AmoePayload): string {
  const normalized = Object.entries(payload)
    .map(([key, value]) => [normalizeAmoeValue(key), normalizeAmoeValue(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${lengthPrefixed(key)}${lengthPrefixed(value)}`)
    .join("");

  return createHash("sha256")
    .update(
      `LSW/AMOE/FINGERPRINT/v1${lengthPrefixed(promotionId)}${lengthPrefixed(mode)}${normalized}`,
      "utf8",
    )
    .digest("hex");
}

export interface AmoeSubmission {
  readonly id: string;
  readonly promotionId: string;
  readonly participantId: string;
  readonly mode: AmoeMode;
  readonly status: AmoeSubmissionStatus;
  readonly fingerprint: string;
  /**
   * Cubo del periodo en el que cae el envio, en la zona legal de la promocion.
   * Se persiste en vez de recalcularse: la zona legal de una promocion podria
   * corregirse, y un limite ya evaluado no debe cambiar de resultado despues.
   */
  readonly periodBucket: string;
  readonly payload: AmoePayload;
  readonly submittedAt: Date;
  readonly rulesVersionId: string;
  /** Revision. `null` mientras nadie la haya mirado. */
  readonly reviewedByAdminUserId: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewReasonKey: string | null;
  readonly reviewNotes: string | null;
  /** Fila de ledger que genero la aprobacion. `null` hasta entonces. */
  readonly entryTransactionId: string | null;
  readonly metadata: JsonObject;
}

export interface AmoeSubmissionRepository {
  save(submission: AmoeSubmission): Promise<AmoeSubmission>;
  /** Reemplaza la fila. Un envio SI es mutable: no es material del ledger. */
  update(submission: AmoeSubmission): Promise<AmoeSubmission>;
  findById(id: string): Promise<AmoeSubmission | null>;
  findByFingerprint(promotionId: string, fingerprint: string): Promise<AmoeSubmission | null>;
  /** Envios que cuentan para el limite: todo lo que no este rechazado ni cancelado. */
  countInPeriod(promotionId: string, participantId: string, periodBucket: string): Promise<number>;
  listPendingReview(promotionId: string): Promise<readonly AmoeSubmission[]>;
  listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly AmoeSubmission[]>;
}

/**
 * Estados que consumen cuota del limite por periodo.
 *
 * Un envio rechazado o cancelado NO consume: si consumiera, un rechazo por un
 * dato mal tecleado dejaria a la persona sin poder participar ese dia, y la via
 * gratuita quedaria cerrada por un error administrativo.
 *
 * `PENDING_REVIEW` SI consume, aunque todavia no haya generado participaciones.
 * Si no consumiera, bastaria con enviar cien veces mientras la cola avanza para
 * saltarse el limite entero.
 */
const COUNTED_TOWARDS_LIMIT: ReadonlySet<AmoeSubmissionStatus> = new Set<AmoeSubmissionStatus>([
  "SUBMITTED",
  "PENDING_REVIEW",
  "APPROVED",
]);

export function countsTowardsLimit(status: AmoeSubmissionStatus): boolean {
  return COUNTED_TOWARDS_LIMIT.has(status);
}

export class InMemoryAmoeSubmissionRepository implements AmoeSubmissionRepository {
  private readonly byId = new Map<string, AmoeSubmission>();

  public save(submission: AmoeSubmission): Promise<AmoeSubmission> {
    const frozen: AmoeSubmission = Object.freeze({ ...submission });
    this.byId.set(frozen.id, frozen);
    return Promise.resolve(frozen);
  }

  public update(submission: AmoeSubmission): Promise<AmoeSubmission> {
    return this.save(submission);
  }

  public findById(id: string): Promise<AmoeSubmission | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  public findByFingerprint(
    promotionId: string,
    fingerprint: string,
  ): Promise<AmoeSubmission | null> {
    for (const submission of this.byId.values()) {
      if (submission.promotionId === promotionId && submission.fingerprint === fingerprint) {
        return Promise.resolve(submission);
      }
    }
    return Promise.resolve(null);
  }

  public countInPeriod(
    promotionId: string,
    participantId: string,
    bucket: string,
  ): Promise<number> {
    let count = 0;
    for (const submission of this.byId.values()) {
      if (
        submission.promotionId === promotionId &&
        submission.participantId === participantId &&
        submission.periodBucket === bucket &&
        countsTowardsLimit(submission.status)
      ) {
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  public listPendingReview(promotionId: string): Promise<readonly AmoeSubmission[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter(
          (submission) =>
            submission.promotionId === promotionId && submission.status === "PENDING_REVIEW",
        )
        .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime()),
    );
  }

  public listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly AmoeSubmission[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter(
          (submission) =>
            submission.promotionId === promotionId && submission.participantId === participantId,
        )
        .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime()),
    );
  }

  public all(): readonly AmoeSubmission[] {
    return [...this.byId.values()];
  }
}
