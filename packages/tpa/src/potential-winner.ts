/**
 * Ganador potencial: maquina de estados del expediente.
 *
 * ---------------------------------------------------------------------------
 * SELECCIONADO NO ES GANADOR
 * ---------------------------------------------------------------------------
 *
 * Entre que sale un ordinal y que alguien recibe un premio hay un expediente:
 * contacto, documentacion, revision de elegibilidad. Los requisitos exactos los
 * fija el abogado del cliente y NO estan aqui: este modulo solo garantiza que
 * el expediente exista, que avance por pasos declarados y que ningun paso se
 * pueda saltar por comodidad.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES REGLAS QUE ESTE FICHERO IMPONE
 * ---------------------------------------------------------------------------
 *
 *  1. NADIE SE SUSTITUYE EN SILENCIO. Descalificar no borra ni reescribe al
 *     seleccionado: cambia su estado, conserva el historico completo y OBLIGA a
 *     pasar por `ALTERNATE_REQUIRED` antes de que exista un alternate. El
 *     alternate es un expediente NUEVO que apunta al anterior.
 *
 *     Es la version, en este dominio, del principio #7: los hechos incomodos se
 *     compensan con movimientos, nunca con un DELETE.
 *
 *  2. EL HISTORICO ES ACUMULATIVO. Cada transicion anade una entrada con quien,
 *     cuando y por que. Las entradas no se editan. Un expediente que solo
 *     guardara su estado actual no permitiria responder "cuando se le
 *     descalifico y quien lo decidio", que es la primera pregunta que hara
 *     cualquiera que revise el caso.
 *
 *  3. PUBLICAR ES OTRA COSA. `CONFIRMED` no publica. La publicacion exige el
 *     flag `winner_publication_enabled` -apagado por defecto, DEC-032- y una
 *     accion humana con su propia capacidad. Nunca es automatica.
 */

export type PotentialWinnerStatus =
  | "SELECTED"
  | "CONTACT_PENDING"
  | "CONTACTED"
  | "DOCUMENTS_PENDING"
  | "ELIGIBILITY_REVIEW"
  | "VERIFIED"
  | "DISQUALIFIED"
  | "ALTERNATE_REQUIRED"
  | "CONFIRMED";

export type PotentialWinnerSource = "INTERNAL_DRAW" | "EXTERNAL_ADMINISTRATOR";

export interface PotentialWinnerHistoryEntry {
  readonly from: PotentialWinnerStatus | null;
  readonly to: PotentialWinnerStatus;
  readonly occurredAt: string;
  readonly actorId: string;
  /** Codigo estable (DEC-022): enum, nunca prosa traducible. */
  readonly reasonCode: string;
  readonly reasonText: string | null;
}

export interface PotentialWinner {
  readonly id: string;
  readonly promotionId: string;
  readonly drawingEventId: string | null;
  readonly source: PotentialWinnerSource;
  /** Identificador interno. Nunca nombre ni correo: este registro se ensena. */
  readonly participantReference: string;
  readonly entryReference: string;
  /** 1 = primer seleccionado; 2 = primer alternate; etc. */
  readonly rank: number;
  readonly status: PotentialWinnerStatus;
  readonly replacesPotentialWinnerId: string | null;
  readonly statusChangedAt: string;
  readonly statusReasonCode: string | null;
  readonly history: readonly PotentialWinnerHistoryEntry[];
}

/**
 * Transiciones permitidas.
 *
 * `DISQUALIFIED` es alcanzable desde cualquier estado que no sea terminal: una
 * causa de inelegibilidad puede aparecer en cualquier momento del expediente,
 * incluso despues de verificar. Lo que no puede es aparecer despues de
 * confirmar, porque entonces ya no es un ganador potencial y el caso se maneja
 * fuera de esta maquina.
 */
const TRANSITIONS: ReadonlyMap<PotentialWinnerStatus, readonly PotentialWinnerStatus[]> = new Map([
  ["SELECTED", ["CONTACT_PENDING", "DISQUALIFIED"]],
  ["CONTACT_PENDING", ["CONTACTED", "DISQUALIFIED"]],
  ["CONTACTED", ["DOCUMENTS_PENDING", "DISQUALIFIED"]],
  ["DOCUMENTS_PENDING", ["ELIGIBILITY_REVIEW", "DISQUALIFIED"]],
  ["ELIGIBILITY_REVIEW", ["VERIFIED", "DISQUALIFIED"]],
  ["VERIFIED", ["CONFIRMED", "DISQUALIFIED"]],
  // Una descalificacion no reabre el expediente: lo unico que puede seguirla es
  // reconocer que hace falta un alternate.
  ["DISQUALIFIED", ["ALTERNATE_REQUIRED"]],
  // Terminales. El alternate es OTRO expediente, no la continuacion de este.
  ["ALTERNATE_REQUIRED", []],
  ["CONFIRMED", []],
] as const);

export const POTENTIAL_WINNER_TERMINAL_STATUSES: readonly PotentialWinnerStatus[] = Object.freeze([
  "ALTERNATE_REQUIRED",
  "CONFIRMED",
]);

export function allowedTransitionsFrom(
  status: PotentialWinnerStatus,
): readonly PotentialWinnerStatus[] {
  return TRANSITIONS.get(status) ?? [];
}

export class PotentialWinnerTransitionError extends Error {
  public readonly code = "winner.invalid_transition";
  public readonly from: PotentialWinnerStatus;
  public readonly to: PotentialWinnerStatus;

  public constructor(from: PotentialWinnerStatus, to: PotentialWinnerStatus, detail: string) {
    super(detail);
    this.name = "PotentialWinnerTransitionError";
    this.from = from;
    this.to = to;
  }
}

export interface PotentialWinnerTransitionInput {
  readonly to: PotentialWinnerStatus;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly reasonText?: string | null;
}

/**
 * Aplica una transicion y devuelve un expediente NUEVO.
 *
 * No muta el anterior. En un dominio donde el historico es la evidencia, un
 * objeto que se modifica en sitio es una invitacion a que alguien guarde solo
 * el ultimo estado.
 */
export function transitionPotentialWinner(
  winner: PotentialWinner,
  input: PotentialWinnerTransitionInput,
): PotentialWinner {
  const allowed = allowedTransitionsFrom(winner.status);

  if (input.reasonCode.trim() === "") {
    throw new PotentialWinnerTransitionError(
      winner.status,
      input.to,
      "Toda transicion exige un codigo de motivo. Un cambio de estado sin motivo es un cambio " +
        "que nadie podra explicar cuando se pregunte.",
    );
  }

  if (!allowed.includes(input.to)) {
    throw new PotentialWinnerTransitionError(
      winner.status,
      input.to,
      `Transicion no permitida ${winner.status} -> ${input.to}. Desde ${winner.status} solo se ` +
        `puede pasar a: ${allowed.length === 0 ? "(ninguno: estado terminal)" : allowed.join(", ")}.`,
    );
  }

  const entry: PotentialWinnerHistoryEntry = {
    from: winner.status,
    to: input.to,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText ?? null,
  };

  return {
    ...winner,
    status: input.to,
    statusChangedAt: input.occurredAt,
    statusReasonCode: input.reasonCode,
    history: [...winner.history, entry],
  };
}

export interface CreatePotentialWinnerInput {
  readonly id: string;
  readonly promotionId: string;
  readonly drawingEventId: string | null;
  readonly source: PotentialWinnerSource;
  readonly participantReference: string;
  readonly entryReference: string;
  readonly rank: number;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly replacesPotentialWinnerId?: string | null;
}

/** Expediente recien abierto, en `SELECTED`, con su primera entrada de historico. */
export function createPotentialWinner(input: CreatePotentialWinnerInput): PotentialWinner {
  return {
    id: input.id,
    promotionId: input.promotionId,
    drawingEventId: input.drawingEventId,
    source: input.source,
    participantReference: input.participantReference,
    entryReference: input.entryReference,
    rank: input.rank,
    status: "SELECTED",
    replacesPotentialWinnerId: input.replacesPotentialWinnerId ?? null,
    statusChangedAt: input.occurredAt,
    statusReasonCode: input.reasonCode,
    history: [
      {
        from: null,
        to: "SELECTED",
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
        reasonText: null,
      },
    ],
  };
}

export class AlternateNotAllowedError extends Error {
  public readonly code = "winner.alternate_not_allowed";

  public constructor(detail: string) {
    super(detail);
    this.name = "AlternateNotAllowedError";
  }
}

export interface CreateAlternateInput {
  readonly id: string;
  readonly drawingEventId: string | null;
  readonly participantReference: string;
  readonly entryReference: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly reasonCode: string;
}

/**
 * Abre el expediente del alternate.
 *
 * Exige que el anterior este en `ALTERNATE_REQUIRED`, y no simplemente en
 * `DISQUALIFIED`. Son dos decisiones distintas y las toma gente distinta:
 * "esta persona no es elegible" es una conclusion sobre un expediente;
 * "hace falta seleccionar a otra" es una decision sobre la promocion, que
 * depende de las Official Rules -puede que exijan repetir el sorteo, puede que
 * definan un orden de alternates, puede que el premio quede desierto-. Obligar
 * a pasar por el segundo estado impide que la primera decision arrastre a la
 * segunda por inercia.
 *
 * El alternate NO hereda el historico: es un expediente propio. Lo que hereda
 * es el puntero `replacesPotentialWinnerId`, que es lo que permite reconstruir
 * la cadena entera sin mezclar dos casos en una sola lista.
 */
export function createAlternateFor(
  previous: PotentialWinner,
  input: CreateAlternateInput,
): PotentialWinner {
  if (previous.status !== "ALTERNATE_REQUIRED") {
    throw new AlternateNotAllowedError(
      `El expediente anterior esta en ${previous.status} y no en ALTERNATE_REQUIRED. Nadie se ` +
        "sustituye en silencio: primero se descalifica con motivo, despues se decide -y se " +
        "registra- que hace falta un alternate.",
    );
  }
  if (previous.participantReference === input.participantReference) {
    throw new AlternateNotAllowedError(
      "El alternate no puede ser el mismo participante que acaba de ser descalificado.",
    );
  }

  return createPotentialWinner({
    id: input.id,
    promotionId: previous.promotionId,
    drawingEventId: input.drawingEventId,
    source: previous.source,
    participantReference: input.participantReference,
    entryReference: input.entryReference,
    rank: previous.rank + 1,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
    replacesPotentialWinnerId: previous.id,
  });
}

export class WinnerPublicationNotAllowedError extends Error {
  public readonly code: string;

  public constructor(code: string, detail: string) {
    super(detail);
    this.name = "WinnerPublicationNotAllowedError";
    this.code = code;
  }
}

/**
 * Dos condiciones, y las dos son necesarias: el expediente esta `CONFIRMED` y
 * el flag de publicacion esta encendido.
 *
 * El flag no se lee aqui: llega evaluado, y `null` -"no se consulto"- se trata
 * como negativa. Publicar el nombre de una persona por no haber podido
 * consultar una tabla es exactamente la clase de error que no se puede
 * deshacer.
 */
export function assertWinnerMayBePublished(input: {
  readonly winner: PotentialWinner;
  readonly publicationEnabled: boolean | null;
}): void {
  if (input.publicationEnabled === null) {
    throw new WinnerPublicationNotAllowedError(
      "winner.publication_flag_not_evaluated",
      "No se pudo evaluar `winner_publication_enabled`. Sin respuesta no se publica: una " +
        "publicacion no se puede retirar del sitio al que ya llego.",
    );
  }
  if (!input.publicationEnabled) {
    throw new WinnerPublicationNotAllowedError(
      "winner.publication_disabled",
      "`winner_publication_enabled` esta apagado (DEC-032). Si y como se publica un ganador es " +
        "una decision de las Official Rules, no del codigo.",
    );
  }
  if (input.winner.status !== "CONFIRMED") {
    throw new WinnerPublicationNotAllowedError(
      "winner.not_confirmed",
      `El expediente esta en ${input.winner.status}. Solo se publica un ganador CONFIRMED: ` +
        "seleccionado no es ganador, y publicarlo antes convertiria una candidatura en un " +
        "anuncio que despues habria que desmentir.",
    );
  }
}
