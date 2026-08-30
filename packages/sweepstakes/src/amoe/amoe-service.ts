/**
 * Via AMOE: envio, revision y aprobacion.
 *
 * ---------------------------------------------------------------------------
 * LA PROPIEDAD MAS IMPORTANTE DE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 *
 * Una participacion AMOE aprobada entra en EL MISMO ledger, con la MISMA forma
 * y bajo las MISMAS reglas que una de compra. Lo unico que la distingue es
 * `source_type = 'AMOE'`.
 *
 * No hay una tabla de AMOE, ni un contador aparte, ni un saldo paralelo. El
 * principio 9 exige un unico universo elegible con procedencia conservada, y
 * `CLAUDE.md` seccion 4 prohibe expresamente dos modelos de entries. La
 * consecuencia practica es que el `ExportSnapshot` que reciba el third-party
 * administrator sale de una sola consulta y cuadra por construccion.
 *
 * ---------------------------------------------------------------------------
 * DOS CONTROLES DISTINTOS CONTRA EL ABUSO
 * ---------------------------------------------------------------------------
 *
 *   HUELLA          unicidad del ENVIO dentro de la promocion. Detecta el mismo
 *                   contenido presentado dos veces, aunque sea desde cuentas
 *                   distintas.
 *   LIMITE/PERIODO  cuantos envios admite una PERSONA en una ventana, contada
 *                   en la zona legal de la promocion (DEC-011).
 *
 * Ninguno cubre al otro y por eso estan los dos.
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE DECIDE AQUI
 * ---------------------------------------------------------------------------
 *
 * Ni la modalidad, ni cuantas participaciones da un envio, ni si hace falta
 * revision, ni la ventana, ni el limite. Todo sale de `PromotionRulesVersion.config`
 * (DEC-012) y sigue en `TBD` en `docs/LEGAL_PENDING.md` -> "AMOE mechanism".
 * El subsistema esta completo y el flag `amoe_enabled` arranca apagado
 * (DEC-032): asi cumple el principio 8 sin haber elegido nada por el abogado.
 */

import { computeBalanceAt } from "../balance/predicate.js";
import { EntryLimitsConfigError, readPerParticipantMax } from "../calculation/config.js";
import type { AmoeSubmissionStatus } from "../enums.js";
import { SWEEPSTAKES_CAPABILITIES } from "../capabilities.js";
import { isSweepstakesError, SweepstakesError } from "../errors.js";
import type { JsonObject } from "../json.js";
import { ENTRY_REASON_KEYS, entrySourceRef } from "../ledger.js";
import {
  actorColumns,
  principalHasCapability,
  principalIsStaff,
  type Principal,
} from "../ports/actor.js";
import type { AuditSink } from "../ports/audit-sink.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { LedgerRepository, LedgerTransaction } from "../ports/ledger-repository.js";
import { isIdempotencyConflict } from "../ports/ledger-repository.js";
import type { PromotionContext, PromotionContextPort } from "../ports/promotion-context.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { ENTRY_CALCULATION_ENGINE_VERSION } from "../engine-version.js";
import {
  amoeRequiredFields,
  readAmoeConfig,
  AmoeConfigError,
  type AmoeConfig,
  type AmoeInstructions,
  type AmoeMailInConfig,
  type AmoeRequiredField,
} from "./config.js";
import { periodBucket } from "./period.js";
import {
  amoeFingerprint,
  type AmoePayload,
  type AmoeSubmission,
  type AmoeSubmissionRepository,
} from "./submission.js";

export interface AmoeSubmitInput {
  readonly promotionId: string;
  readonly participantId: string;
  readonly payload: AmoePayload;
}

/**
 * Una ficha postal tecleada por un operador (DEC-054 punto 4).
 *
 * `participantId` ya viene resuelto: quien llama busca al participante por el
 * email de la ficha y, si no existe, lo crea. Esa resolucion es de identidad y
 * no de participaciones, asi que no ocurre aqui.
 */
export interface AmoeTranscribeInput extends AmoeSubmitInput {
  /**
   * Referencia del sobre tal y como la anota el operador. Texto libre y opaco
   * para el sistema: sirve para que un revisor pueda volver al papel.
   */
  readonly envelopeReference: string | null;
  /**
   * Cuantas fichas venian en ese sobre, segun el operador.
   *
   * El sistema NO cuenta sobres: nadie mas que quien lo abrio sabe cuantas
   * cartas traia. Lo que hace con este numero es compararlo con
   * `mail_in.max_cards_per_envelope` y MARCAR el envio si lo supera, para que
   * una persona decida. `null` = el operador no lo anoto.
   */
  readonly cardsInEnvelope: number | null;
}

export type AmoeSubmitOutcome =
  | { readonly status: "PENDING_REVIEW"; readonly submission: AmoeSubmission }
  /**
   * El envio se registro y la concesion AUTOMATICA no cupo en el tope.
   *
   * Es un desenlace y no una excepcion porque las dos cosas son ciertas a la
   * vez: la ficha existe y esta en la cola, y no se concedio nada. Con una
   * excepcion, la transaccion del llamante revertiria tambien el registro
   * del envio, que es exactamente lo que no debe pasar.
   */
  | {
      readonly status: "CAP_REACHED_PENDING_REVIEW";
      readonly submission: AmoeSubmission;
      readonly details: JsonObject;
    }
  | {
      readonly status: "APPROVED";
      readonly submission: AmoeSubmission;
      readonly transaction: LedgerTransaction;
      readonly entries: number;
    };

/**
 * Vista publica de la configuracion AMOE, para `/promotions/:id/amoe-config`.
 *
 * NO expone la configuracion entera. Un participante no necesita saber la
 * politica de duplicados ni el detalle de la revision, y publicarlas seria
 * regalar el mapa de los controles antifraude.
 */
export interface AmoeConfigView {
  readonly enabled: boolean;
  readonly promotionId: string;
  readonly mode: AmoeConfig["mode"] | null;
  readonly windowStartsAt: string | null;
  readonly windowEndsAt: string | null;
  readonly entriesPerApprovedSubmission: number | null;
  readonly requiresReview: boolean | null;
  readonly identityRequirements: readonly string[];
  readonly maxPerParticipantPerPeriod: number | null;
  readonly limitPeriod: AmoeConfig["limit"]["period"] | null;
  /**
   * Los campos del formulario, ya resueltos. `null` con la via apagada.
   *
   * Se sirven en LAS CUATRO modalidades y no solo en `ONLINE_FORM`, porque
   * `identity_requirements` lo exige el dominio en cualquier envio que entre
   * por la API: un envio de `MAIL_IN_REVIEW` transcrito por un operador
   * necesita las mismas claves. Que modalidad merece un formulario en pantalla
   * lo decide la interfaz; que claves exige el sistema lo decide esto.
   */
  readonly requiredFields: readonly AmoeRequiredField[] | null;
  /**
   * Texto legalmente controlante, en los dos idiomas, o `null`.
   *
   * `null` significa "el abogado no ha publicado instrucciones", nunca "no hay
   * instrucciones": el sistema no rellena ese hueco. Una promocion
   * `MAIL_IN_REVIEW` con `instructions: null` es una configuracion incompleta
   * y la interfaz remite a las Reglas Oficiales en vez de inventarse un sobre.
   */
  readonly instructions: AmoeInstructions | null;
  readonly externalUrl: string | null;
  /**
   * Plazos y limite por sobre de la via postal, o `null`.
   *
   * Se publica en las cuatro modalidades por la misma razon que
   * `requiredFields`: quien decide que pinta la interfaz es la interfaz. Una
   * promocion que no sea postal simplemente no lo declara, y `null` significa
   * "no hay plazos publicados", nunca "no hay plazos".
   */
  readonly mailIn: AmoeMailInConfig | null;
}

/**
 * Proyeccion de lo que haria una aprobacion, para quien la decide.
 *
 * Las tres cifras salen del ledger y de la configuracion, JAMAS de una resta en
 * el cliente: quien aprueba tiene que ver antes, cambio y despues, y las tres
 * tienen que venir de la misma lectura para que no se contradigan.
 */
export interface AmoeApprovalProjection {
  /** Saldo activo del participante en la promocion, al instante de la lectura. */
  readonly entriesBefore: number;
  /**
   * Lo que otorgaria ESTE envio, segun la version de reglas BAJO LA QUE SE
   * ENVIO. `null` si esa version ya no declara configuracion AMOE legible: la
   * aprobacion fallaria, y ensenar una cifra que no se va a cumplir seria peor
   * que no ensenar ninguna.
   */
  readonly entriesIfApproved: number | null;
  /** `entriesBefore + entriesIfApproved`, o `null` por el mismo motivo. */
  readonly entriesAfterIfApproved: number | null;
  /**
   * Si el tope por participante gobierna ESTA aprobacion (DEC-052 punto 5).
   *
   * Es `true` cuando `entry_caps_enabled` esta encendido Y la version de reglas
   * del envio declara `entry_limits.per_participant_max`. Viaja explicito para
   * que la interfaz pueda distinguir "no se recorta nada" de "no hay tope": con
   * solo las cifras, un envio que cabe entero y uno que no esta sujeto a tope
   * se verian igual, y el revisor no sabria si mañana podria recortarse.
   */
  readonly capApplies: boolean;
  /**
   * Lo que otorgaria este envio DESPUES de aplicar el tope. `null` por el mismo
   * motivo que `entriesIfApproved`. Con `capApplies: false` coincide con el.
   *
   * Es la unica cifra que el revisor deberia leer como "lo que va a pasar": la
   * de antes del tope existe para que se vea el recorte, no para prometerlo.
   */
  readonly entriesIfApprovedAfterCap: number | null;
}

/**
 * El tope por participante aplicable a una concesion, ya resuelto.
 *
 * `limit: null` cubre los DOS casos en los que no se recorta nada -flag
 * apagado, o version de reglas sin tope declarado- porque para quien concede
 * son el mismo caso: no hay techo que respetar. Distinguirlos importa en la
 * PROYECCION, y alli se distingue con `capApplies`.
 */
interface EntryCapState {
  readonly limit: number | null;
}

/**
 * Recorte por tope por participante. La MISMA aritmetica que el motor.
 *
 * Vive en una funcion con nombre y no repetida en dos sitios porque la
 * concesion y la proyeccion tienen que dar exactamente el mismo numero: si la
 * pantalla del revisor dijera 2,000 y la aprobacion concediera 1,000, el
 * revisor estaria decidiendo sobre una cifra que no existe.
 */
function applyPerParticipantCap(
  requested: number,
  entriesBefore: number,
  limit: number | null,
): { readonly granted: number; readonly trimmed: boolean } {
  if (limit === null) {
    return { granted: requested, trimmed: false };
  }
  const headroom = Math.max(0, limit - entriesBefore);
  return headroom < requested
    ? { granted: headroom, trimmed: true }
    : { granted: requested, trimmed: false };
}

export interface AmoeServiceDependencies {
  readonly submissions: AmoeSubmissionRepository;
  readonly ledger: LedgerRepository;
  readonly promotions: PromotionContextPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditSink;
  readonly unitOfWork: UnitOfWork;
}

export class AmoeService {
  private readonly deps: AmoeServiceDependencies;

  public constructor(dependencies: AmoeServiceDependencies) {
    this.deps = dependencies;
  }

  /**
   * Lo que puede ver un participante sin haber enviado nada.
   *
   * Con el flag apagado devuelve `enabled: false` y nada mas, sin filtrar
   * ninguna configuracion: si la via no existe, sus parametros tampoco son
   * asunto de nadie.
   */
  public async configView(promotionId: string): Promise<AmoeConfigView> {
    const context = await this.requireContext(promotionId);
    if (!context.flags.amoe_enabled) {
      return {
        enabled: false,
        // `promotionId` es la UNICA excepcion, y viaja tambien con la via
        // apagada: es el dato que el cliente acaba de usar para preguntar, no
        // un parametro de la configuracion. Devolverlo no revela nada, y sin el
        // una respuesta desacoplada de su peticion no se puede correlacionar.
        promotionId: context.promotionId,
        mode: null,
        windowStartsAt: null,
        windowEndsAt: null,
        entriesPerApprovedSubmission: null,
        requiresReview: null,
        identityRequirements: [],
        maxPerParticipantPerPeriod: null,
        limitPeriod: null,
        requiredFields: null,
        instructions: null,
        externalUrl: null,
        mailIn: null,
      };
    }
    const config = this.readConfig(context);
    return {
      enabled: true,
      promotionId: context.promotionId,
      mode: config.mode,
      windowStartsAt: config.submission_window.starts_at,
      windowEndsAt: config.submission_window.ends_at,
      entriesPerApprovedSubmission: config.entries_per_approved_submission,
      requiresReview: config.requires_review,
      identityRequirements: config.identity_requirements,
      maxPerParticipantPerPeriod: config.limit.max_per_participant_per_period,
      limitPeriod: config.limit.period,
      requiredFields: amoeRequiredFields(config),
      // `?? null` y no el valor directo: la clave es opcional en la
      // configuracion, asi que puede llegar `undefined`, y `undefined` no
      // sobrevive a `JSON.stringify` -el campo desapareceria de la respuesta en
      // vez de llegar nulo-. Ausente y nulo tienen que significar lo mismo en
      // el cable, no una la ausencia del campo y otra su nulidad.
      instructions: config.instructions ?? null,
      externalUrl: config.external_url ?? null,
      mailIn: config.mail_in ?? null,
    };
  }

  /**
   * Que pasaria si se aprobara cada uno de estos envios.
   *
   * SE CALCULA AQUI Y NO EN EL PANEL. La cifra de "despues" es una suma sobre
   * el saldo del ledger con la cantidad que fija la version de reglas del
   * envio; hacerla en el cliente seria una segunda implementacion del motor,
   * que es exactamente lo que el escaner `no-client-entry-math` del frontend
   * existe para impedir.
   *
   * DOS CACHES, Y NO SON UNA OPTIMIZACION COSMETICA. Una cola de revision con
   * treinta envios de la misma persona haria treinta lecturas del historial
   * completo del ledger. Ademas de caro, cada lectura ocurre en un instante
   * distinto, y dos filas de la misma pantalla podrian ensenar saldos previos
   * distintos para el mismo participante. Con una sola lectura por
   * participante, la pantalla es coherente consigo misma.
   *
   * El saldo previo NO es acumulativo entre filas: cada proyeccion contesta
   * "si apruebo ESTE", no "si los apruebo todos". Aprobar dos seguidos exige
   * releer, y por eso la respuesta lleva su instante.
   */
  public async approvalProjections(
    submissions: readonly AmoeSubmission[],
  ): Promise<ReadonlyMap<string, AmoeApprovalProjection>> {
    const now = this.deps.clock.now();
    const balances = new Map<string, number>();
    const grants = new Map<string, number | null>();
    const caps = new Map<string, EntryCapState | null>();
    const projections = new Map<string, AmoeApprovalProjection>();

    for (const submission of submissions) {
      const balanceKey = `${submission.promotionId} ${submission.participantId}`;
      let entriesBefore = balances.get(balanceKey);
      if (entriesBefore === undefined) {
        const history = await this.deps.ledger.listForParticipant(
          submission.promotionId,
          submission.participantId,
        );
        entriesBefore = computeBalanceAt(
          history,
          submission.promotionId,
          submission.participantId,
          now,
        ).activeEntries;
        balances.set(balanceKey, entriesBefore);
      }

      let entriesIfApproved = grants.get(submission.rulesVersionId);
      if (entriesIfApproved === undefined) {
        entriesIfApproved = await this.grantSizeUnderRulesVersion(submission.rulesVersionId);
        grants.set(submission.rulesVersionId, entriesIfApproved);
      }

      const capKey = `${submission.promotionId} ${submission.rulesVersionId}`;
      let cap = caps.get(capKey);
      if (cap === undefined) {
        cap = await this.readableCapState(submission.promotionId, submission.rulesVersionId);
        caps.set(capKey, cap);
      }

      projections.set(submission.id, {
        entriesBefore,
        entriesIfApproved,
        entriesAfterIfApproved:
          entriesIfApproved === null ? null : entriesBefore + entriesIfApproved,
        // Una configuracion de topes ilegible se pinta como `false`. Es
        // deliberado: la aprobacion de esa fila va a fallar de todos modos, y
        // lo que el revisor necesita ver es que no hay cifra que prometer
        // -`entriesIfApprovedAfterCap: null`-, no un "hay tope, valor
        // desconocido" que no le sirve para decidir nada.
        capApplies: cap !== null && cap.limit !== null,
        entriesIfApprovedAfterCap:
          entriesIfApproved === null || cap === null
            ? null
            : applyPerParticipantCap(entriesIfApproved, entriesBefore, cap.limit).granted,
      });
    }

    return projections;
  }

  /**
   * Cuantas participaciones vale un envio bajo una version de reglas concreta.
   *
   * `null` -y no una excepcion- cuando esa version no declara AMOE legible: la
   * cola de revision tiene que poder pintarse aunque una de sus filas apunte a
   * una configuracion rota, y con una excepcion aqui una sola fila mala dejaria
   * al revisor sin pantalla. La aprobacion de ESA fila seguira fallando, que es
   * donde el fallo importa.
   */
  private async grantSizeUnderRulesVersion(rulesVersionId: string): Promise<number | null> {
    try {
      const raw = await this.deps.promotions.getRulesConfig(rulesVersionId);
      const config = readAmoeConfig(raw);
      return config?.entries_per_approved_submission ?? null;
    } catch (error) {
      if (error instanceof AmoeConfigError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Estado del tope por participante para una concesion concreta.
   *
   * DOS FUENTES, LEIDAS EN ESTE ORDEN Y NO EN OTRO:
   *
   *   1. `entry_caps_enabled` del contexto de la promocion (DEC-032). Con el
   *      flag apagado no hay tope que aplicar, y la version de reglas ni se
   *      lee: leerla igualmente convertiria una configuracion rota en un fallo
   *      de una via que en ese momento no depende de ella.
   *   2. `entry_limits.per_participant_max` de la version de reglas DEL ENVIO,
   *      no de la vigente. Es el mismo principio que gobierna la cantidad
   *      concedida: si entre el envio y la revision se publicara una version
   *      con otro tope, aplicar el nuevo cambiaria retroactivamente lo que
   *      valia un envio ya hecho.
   */
  private async capState(promotionId: string, rulesVersionId: string): Promise<EntryCapState> {
    const context = await this.requireContext(promotionId);
    if (!context.flags.entry_caps_enabled) {
      return { limit: null };
    }
    const raw = await this.deps.promotions.getRulesConfig(rulesVersionId);
    return { limit: readPerParticipantMax(raw) };
  }

  /**
   * Igual que `capState`, pero `null` en vez de excepcion si la rebanada de
   * topes no se puede leer.
   *
   * Es para la COLA DE REVISION, por el mismo motivo que
   * `grantSizeUnderRulesVersion`: una fila con la configuracion rota no puede
   * dejar al revisor sin pantalla. La aprobacion de esa fila seguira fallando,
   * que es donde el fallo importa.
   */
  private async readableCapState(
    promotionId: string,
    rulesVersionId: string,
  ): Promise<EntryCapState | null> {
    try {
      return await this.capState(promotionId, rulesVersionId);
    } catch (error) {
      if (error instanceof EntryLimitsConfigError) {
        return null;
      }
      throw error;
    }
  }

  public async submit(input: AmoeSubmitInput): Promise<AmoeSubmitOutcome> {
    return await this.submitInternal(input, null);
  }

  /**
   * Transcripcion de una ficha postal por un operador (DEC-054 punto 4).
   *
   * REUTILIZA `submit` ENTERO, y eso es lo importante: misma ventana, misma
   * huella, mismo limite por periodo y misma politica de duplicados. Una
   * segunda via de escritura con sus propios controles seria una via por la que
   * saltarselos, y ademas exactamente el "segundo modelo de entries" que
   * `CLAUDE.md` seccion 4 prohibe.
   *
   * Lo unico que anade es procedencia: quien la tecleo, de que sobre salio y
   * cuantas fichas venian. Ese primer dato no es decorativo -decide quien NO
   * puede aprobarla-, y por eso viaja en `metadata` y no en un log.
   */
  public async submitOnBehalf(
    input: AmoeTranscribeInput,
    principal: Principal,
  ): Promise<AmoeSubmitOutcome> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeSubmissionTranscribe);

    // QUIEN TECLEA SALE DEL PRINCIPAL, NUNCA DEL CUERPO.
    //
    // Este identificador no es un dato mas de la ficha: es el que decide quien
    // NO puede aprobarla despues (`assertNotSelfTranscribed`). Aceptarlo como
    // parametro dejaria que quien transcribe escribiera el id de un companero
    // y aprobara la ficha el solo, es decir, que el dato de entrada de un
    // control lo eligiera justo quien va a eludirlo. Ademas falsificaria el
    // actor en los dos eventos de auditoria, que son el unico registro que
    // responde "quien hizo esto".
    if (principal.actor.type !== "ADMIN") {
      throw new SweepstakesError("CAPABILITY_REQUIRED", {
        capability: SWEEPSTAKES_CAPABILITIES.amoeSubmissionTranscribe,
        reason: "admin_actor_required",
      });
    }

    return await this.submitInternal(input, {
      transcribedByAdminUserId: principal.actor.adminUserId,
      envelopeReference: input.envelopeReference,
      cardsInEnvelope: input.cardsInEnvelope,
    });
  }

  private async submitInternal(
    input: AmoeSubmitInput,
    transcription: {
      readonly transcribedByAdminUserId: string;
      readonly envelopeReference: string | null;
      readonly cardsInEnvelope: number | null;
    } | null,
  ): Promise<AmoeSubmitOutcome> {
    const context = await this.requireContext(input.promotionId);
    if (!context.flags.amoe_enabled) {
      throw new SweepstakesError("AMOE_NOT_ENABLED", { promotion_id: input.promotionId });
    }
    const config = this.readConfig(context);

    // La MODALIDAD decide quien puede escribir por esta via, y se comprueba
    // antes que nada. Con `MAIL_IN_REVIEW` la participacion llega en un sobre y
    // la teclea un operador con `amoe.submission.transcribe`; con
    // `EXTERNAL_INSTRUCTIONS` ocurre fuera del sistema. Aceptar un envio propio
    // en esos casos crearia participaciones por un metodo que las Official
    // Rules vigentes no ofrecen.
    this.assertModeAdmits(config, transcription !== null, input.promotionId);

    const now = this.deps.clock.now();

    this.assertWindowOpen(config, now);
    this.assertPayloadComplete(config, input.payload);

    // MINIMIZACION: solo se guarda lo que las Official Rules PIDEN.
    //
    // assertPayloadComplete comprueba que ESTEN las claves requeridas; las
    // de mas se guardaban tal cual, y la tabla acababa almacenando datos
    // personales que nadie pidio. La huella se calcula sobre el payload YA
    // proyectado, para que dos envios que solo difieran en campos que el
    // sistema no pide sigan siendo el mismo envio.
    const payload = this.projectPayload(config, input.payload);

    const fingerprint = amoeFingerprint(input.promotionId, config.mode, payload);
    const duplicateOf = await this.deps.submissions.findByFingerprint(
      input.promotionId,
      fingerprint,
    );

    if (duplicateOf !== null && config.duplicate_policy === "REJECT") {
      throw new SweepstakesError("AMOE_DUPLICATE_SUBMISSION", {
        promotion_id: input.promotionId,
        existing_submission_id: duplicateOf.id,
      });
    }

    const bucket = periodBucket(now, context.legalTimeZone, config.limit.period);
    const limit = config.limit.max_per_participant_per_period;
    if (limit !== null) {
      const used = await this.deps.submissions.countInPeriod(
        input.promotionId,
        input.participantId,
        bucket,
      );
      if (used >= limit) {
        throw new SweepstakesError("AMOE_PERIOD_LIMIT_REACHED", {
          limit,
          period: config.limit.period,
          period_bucket: bucket,
        });
      }
    }

    // Un sobre con mas fichas de las admitidas NO se rechaza: entra marcado y
    // lo mira una persona. Las Official Rules dicen cuantas fichas caben en un
    // sobre, no que fichas anular cuando llegan de mas, y el sistema no elige
    // por su cuenta cual de las tres sobra (pregunta 6 de `LEGAL_PENDING.md`).
    const envelopeLimit = config.mail_in?.max_cards_per_envelope ?? null;
    const cardsInEnvelope = transcription?.cardsInEnvelope ?? null;
    const flaggedEnvelope =
      cardsInEnvelope !== null && envelopeLimit !== null && cardsInEnvelope > envelopeLimit;

    // Un duplicado marcado va SIEMPRE a revision humana, aunque la
    // configuracion no exija revision para los envios normales: la politica
    // `FLAG_FOR_REVIEW` no tendria ningun efecto si el envio marcado se
    // aprobara solo.
    const flaggedDuplicate = duplicateOf !== null;
    const needsReview = config.requires_review || flaggedDuplicate || flaggedEnvelope;

    const metadata: JsonObject = {
      ...(flaggedDuplicate
        ? {
            duplicate_of_submission_id: duplicateOf.id,
            duplicate_policy: config.duplicate_policy,
          }
        : {}),
      ...(transcription === null
        ? {}
        : {
            transcribed_by_admin_user_id: transcription.transcribedByAdminUserId,
            envelope_reference: transcription.envelopeReference,
            cards_in_envelope: transcription.cardsInEnvelope,
          }),
      ...(flaggedEnvelope ? { flag: "ENVELOPE_LIMIT_EXCEEDED" } : {}),
    };

    const submission = await this.deps.submissions.save({
      id: this.deps.ids.next(),
      promotionId: input.promotionId,
      participantId: input.participantId,
      mode: config.mode,
      status: needsReview ? "PENDING_REVIEW" : "SUBMITTED",
      fingerprint,
      periodBucket: bucket,
      payload,
      submittedAt: now,
      rulesVersionId: context.rulesVersionId,
      reviewedByAdminUserId: null,
      reviewedAt: null,
      reviewReasonKey: null,
      reviewNotes: null,
      entryTransactionId: null,
      metadata,
    });

    await this.deps.audit.emit({
      action: "amoe.submission.created",
      // Una transcripcion la hace un ADMINISTRADOR sobre el expediente de otra
      // persona. Registrarla como si la hubiera enviado el participante seria
      // falsear el actor en el unico registro que responde "quien hizo esto".
      actor:
        transcription === null
          ? { type: "PARTICIPANT", participantId: input.participantId }
          : { type: "ADMIN", adminUserId: transcription.transcribedByAdminUserId },
      promotionId: input.promotionId,
      targetEntityType: "AMOESubmission",
      targetEntityId: submission.id,
      reasonKey: null,
      reasonDetail: null,
      occurredAt: now,
      metadata: {
        mode: config.mode,
        requires_review: needsReview,
        flagged_duplicate: flaggedDuplicate,
        period_bucket: bucket,
        transcribed: transcription !== null,
      },
    });

    if (transcription !== null) {
      // Evento PROPIO ademas del anterior, y no en lugar de el. `created` es el
      // hecho del envio -lo que cuenta para el limite y para la cola-;
      // `transcribed` es el hecho administrativo, y es el que un revisor de
      // cumplimiento busca cuando pregunta "cuantas fichas de papel entraron y
      // quien las tecleo". Con un solo evento habria que filtrar por metadata
      // para responder eso.
      await this.deps.audit.emit({
        action: "amoe.submission.transcribed",
        actor: { type: "ADMIN", adminUserId: transcription.transcribedByAdminUserId },
        promotionId: input.promotionId,
        targetEntityType: "AMOESubmission",
        targetEntityId: submission.id,
        reasonKey: null,
        reasonDetail: null,
        occurredAt: now,
        metadata: {
          envelope_reference: transcription.envelopeReference,
          cards_in_envelope: transcription.cardsInEnvelope,
          max_cards_per_envelope: envelopeLimit,
          flagged_envelope: flaggedEnvelope,
          participant_id: input.participantId,
        },
      });
    }

    if (needsReview) {
      return { status: "PENDING_REVIEW", submission };
    }

    // Sin revision configurada, la aprobacion es automatica y la ejecuta el
    // sistema. Se registra como actor SYSTEM, no como el participante: no fue
    // una persona quien la aprobo, y la auditoria no debe sugerir lo contrario.
    try {
      return await this.grant(submission, config, { type: "SYSTEM" }, null, null);
    } catch (error) {
      if (!isSweepstakesError(error, "AMOE_ENTRY_CAP_REACHED")) {
        throw error;
      }
      // El tope impide la concesion AUTOMATICA, no el envio. La ficha es valida
      // y ya esta registrada; lo que no puede hacer el sistema es decidir solo
      // que se queda sin efecto. Pasa a la cola y el error se propaga para que
      // quien la envio sepa que no se concedio nada todavia.
      // EL RESCATE TIENE QUE PERSISTIR, ASI QUE NO SE RELANZA.
      //
      // Antes se relanzaba, y con una transaccion REAL en el llamante esa
      // excepcion revertia tambien el save del envio y sus dos eventos: no
      // quedaba ni la ficha ni el rastro, justo lo contrario de lo que el
      // comentario prometia. Solo se sostenia con el doble en memoria, que
      // no revierte nada.
      //
      // Ahora se devuelve un desenlace propio: las dos cosas son ciertas a
      // la vez -la ficha existe y esta en la cola, y no se concedio nada- y
      // quien llama decide como lo presenta.
      const pending = await this.deps.submissions.update({
        ...submission,
        status: "PENDING_REVIEW",
      });
      await this.deps.audit.emit({
        action: "amoe.submission.cap_reached",
        actor: { type: "SYSTEM" },
        promotionId: input.promotionId,
        targetEntityType: "AMOESubmission",
        targetEntityId: pending.id,
        reasonKey: null,
        reasonDetail: null,
        occurredAt: now,
        metadata: { ...error.details },
      });
      return {
        status: "CAP_REACHED_PENDING_REVIEW",
        submission: pending,
        details: error.details,
      };
    }
  }

  /**
   * Cola de revision. Exige `amoe.review.read`.
   *
   * SIN FILTRO ES LA COLA DE TRABAJO, Y ESE SIGUE SIENDO EL CASO NORMAL
   *
   *   `status === null` -y `"PENDING_REVIEW"`, que es su valor por defecto en
   *   la ruta- devuelven lo que ESPERA DECISION: `SUBMITTED` y
   *   `PENDING_REVIEW`. Es la lectura que abre el revisor, y no cambia.
   *
   * CON FILTRO ES UNA CONSULTA DE EXPEDIENTE, NO UNA COLA
   *
   *   Cualquier otro estado consulta ese estado exacto. Sin esta via, un envio
   *   decidido desaparecia de toda lectura administrativa y con el se iban
   *   `granted_entries` y `applied_cap` -lo unico que explica por que una
   *   aprobacion concedio menos de lo anunciado-. La capacidad exigida es la
   *   misma porque la pregunta es la misma: mirar expedientes AMOE.
   */
  public async reviewQueue(
    promotionId: string,
    principal: Principal,
    status: AmoeSubmissionStatus | null = null,
  ): Promise<readonly AmoeSubmission[]> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeReviewRead);
    if (status === null || status === "PENDING_REVIEW") {
      return await this.deps.submissions.listPendingReview(promotionId);
    }
    return await this.deps.submissions.listByStatus(promotionId, status);
  }

  /**
   * Aprueba un envio y genera las participaciones.
   *
   * La cantidad sale de la version de reglas BAJO LA QUE SE ENVIO, no de la
   * vigente hoy. Si entre el envio y la revision se publicara una version nueva
   * con otra cantidad, aplicar la nueva cambiaria retroactivamente lo que valia
   * un envio ya hecho. Es el mismo principio que DEC-007 aplica a los reversals.
   */
  public async approve(
    submissionId: string,
    principal: Principal,
    notes: string | null = null,
  ): Promise<AmoeSubmitOutcome> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeReviewApprove);
    const submission = await this.requireReviewable(submissionId);
    this.assertNotSelfTranscribed(submission, principal.actor);
    const config = await this.configOfSubmission(submission);
    return await this.grant(submission, config, principal.actor, notes, submission.rulesVersionId);
  }

  /**
   * Quien transcribio una ficha postal no la aprueba (DEC-054 punto 4).
   *
   * NO ES UNA REGLA DE RUTA, y por eso no vive en el autorizador de `apps/api`:
   * depende de un dato del registro -quien lo tecleo- que la ruta no conoce.
   * Es la misma separacion de funciones que ya rige los ajustes manuales
   * (`ADJUSTMENT_SELF_APPROVAL_FORBIDDEN`), y por el mismo motivo: sin ella,
   * una sola persona podria pasar de escribir una ficha inventada a concederse
   * participaciones sin que nadie mas la viera.
   *
   * Solo aplica a las transcripciones. Un envio propio del participante no
   * lleva `transcribed_by_admin_user_id`, y ahi la separacion la garantiza el
   * ambito: un participante no puede aprobar nada.
   */
  private assertNotSelfTranscribed(submission: AmoeSubmission, actor: Principal["actor"]): void {
    if (actor.type !== "ADMIN") {
      return;
    }
    // Se recorre a un `Map` antes de consultar, por el mismo motivo que
    // `assertPayloadComplete`: `metadata` es JSON de origen externo y un acceso
    // indexado directo leeria la cadena de prototipos ante una clave hostil.
    const metadata = new Map(Object.entries(submission.metadata));
    const transcribedBy = metadata.get("transcribed_by_admin_user_id");
    if (typeof transcribedBy === "string" && transcribedBy === actor.adminUserId) {
      throw new SweepstakesError("SEPARATION_OF_DUTIES", {
        submission_id: submission.id,
        transcribed_by_admin_user_id: transcribedBy,
      });
    }
  }

  public async reject(
    submissionId: string,
    principal: Principal,
    reasonKey: string,
    notes: string | null = null,
  ): Promise<AmoeSubmission> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeReviewReject);
    if (reasonKey.trim() === "") {
      throw new SweepstakesError("REASON_KEY_REQUIRED", { field: "reasonKey" });
    }
    const submission = await this.requireReviewable(submissionId);
    // Rechazar tambien es DECIDIR. Quien teclea una ficha no puede cerrarla el
    // solo: seria cerrar unilateralmente la unica via gratuita de esa persona,
    // y la asimetria con approve no tendria ninguna justificacion.
    this.assertNotSelfTranscribed(submission, principal.actor);
    const now = this.deps.clock.now();

    const rejected = await this.deps.submissions.update({
      ...submission,
      status: "REJECTED",
      reviewedByAdminUserId: principal.actor.type === "ADMIN" ? principal.actor.adminUserId : null,
      reviewedAt: now,
      reviewReasonKey: reasonKey,
      reviewNotes: notes,
    });

    await this.deps.audit.emit({
      action: "amoe.submission.rejected",
      actor: principal.actor,
      promotionId: submission.promotionId,
      targetEntityType: "AMOESubmission",
      targetEntityId: submission.id,
      reasonKey,
      reasonDetail: notes,
      occurredAt: now,
      metadata: {},
    });

    return rejected;
  }

  /**
   * Cancelacion por el propio participante.
   *
   * Un envio cancelado NO consume cuota del limite: si la consumiera, cancelar
   * un envio con una errata dejaria a la persona sin poder reenviarlo, y la via
   * gratuita quedaria cerrada por un descuido suyo.
   */
  public async cancel(submissionId: string, participantId: string): Promise<AmoeSubmission> {
    const submission = await this.deps.submissions.findById(submissionId);
    if (submission === null) {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_FOUND", { submission_id: submissionId });
    }
    // Mismo codigo de error que 'no existe', a proposito: contestar 'existe pero
    // no es tuyo' convertiria este endpoint en un oraculo de identificadores
    // ajenos.
    if (submission.participantId !== participantId) {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_FOUND", { submission_id: submissionId });
    }
    if (submission.status !== "SUBMITTED" && submission.status !== "PENDING_REVIEW") {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_REVIEWABLE", {
        submission_id: submissionId,
        status: submission.status,
      });
    }
    const now = this.deps.clock.now();
    const cancelled = await this.deps.submissions.update({
      ...submission,
      status: "CANCELLED",
      reviewedAt: now,
    });
    await this.deps.audit.emit({
      action: "amoe.submission.cancelled",
      actor: { type: "PARTICIPANT", participantId },
      promotionId: submission.promotionId,
      targetEntityType: "AMOESubmission",
      targetEntityId: submission.id,
      reasonKey: null,
      reasonDetail: null,
      occurredAt: now,
      metadata: {},
    });
    return cancelled;
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async requireContext(promotionId: string): Promise<PromotionContext> {
    const context = await this.deps.promotions.getContext(promotionId);
    if (context === null) {
      throw new SweepstakesError("PROMOTION_NOT_FOUND", { promotion_id: promotionId });
    }
    return context;
  }

  /**
   * Lee la configuracion AMOE y comprueba que las DOS fuentes coinciden.
   *
   * `amoe_mode` vive en los ajustes de feature flag (DEC-032) y `amoe.mode` en
   * la version de reglas (DEC-012). Que existan las dos es un hecho del diseno
   * heredado, y aqui se convierte en un control en vez de en un riesgo: manda
   * la version de reglas -es lo que aprueba el abogado- y una discrepancia
   * falla ruidosamente en vez de que cada capa lea la suya.
   */
  private readConfig(context: PromotionContext): AmoeConfig {
    let config: AmoeConfig | null;
    try {
      config = readAmoeConfig(context.rulesConfig);
    } catch (error) {
      if (error instanceof AmoeConfigError) {
        throw new SweepstakesError("AMOE_CONFIG_INVALID", {
          promotion_id: context.promotionId,
        });
      }
      throw error;
    }

    if (config === null) {
      throw new SweepstakesError("AMOE_MODE_NOT_CONFIGURED", {
        promotion_id: context.promotionId,
        key: "amoe",
      });
    }
    if (context.amoeMode !== null && context.amoeMode !== config.mode) {
      throw new SweepstakesError(
        "AMOE_CONFIG_INVALID",
        { flag_mode: context.amoeMode, rules_mode: config.mode },
        "La modalidad AMOE del flag no coincide con la de la version de reglas.",
      );
    }
    return config;
  }

  private async configOfSubmission(submission: AmoeSubmission): Promise<AmoeConfig> {
    const raw = await this.deps.promotions.getRulesConfig(submission.rulesVersionId);

    // Se envuelve como en readConfig: una rebanada AMOE rota en la version del
    // envio es un 409 explicable -"esa promocion se activo con AMOE a medio
    // configurar"- y no una excepcion cruda que acabe en un 500.
    let config: AmoeConfig | null;
    try {
      config = readAmoeConfig(raw);
    } catch (error) {
      if (error instanceof AmoeConfigError) {
        throw new SweepstakesError("AMOE_CONFIG_INVALID", {
          rules_version_id: submission.rulesVersionId,
        });
      }
      throw error;
    }
    if (config === null) {
      throw new SweepstakesError("AMOE_MODE_NOT_CONFIGURED", {
        rules_version_id: submission.rulesVersionId,
      });
    }
    return config;
  }

  /**
   * Que via de escritura admite cada modalidad.
   *
   *   ONLINE_FORM            envio propio del participante.
   *   CODE                   envio propio del participante.
   *   MAIL_IN_REVIEW         SOLO transcripcion: el envio existe en papel.
   *   EXTERNAL_INSTRUCTIONS  ninguna de las dos: ocurre fuera del sistema.
   *
   * La tabla se escribe aqui y no en la ruta porque es una regla del DOMINIO
   * -depende de la version de reglas, no del transporte- y porque un job o un
   * script de administracion tampoco deberian poder saltarsela.
   */
  private assertModeAdmits(
    config: AmoeConfig,
    isTranscription: boolean,
    promotionId: string,
  ): void {
    if (isTranscription) {
      if (config.mode !== "MAIL_IN_REVIEW") {
        throw new SweepstakesError("AMOE_MODE_NOT_MAIL_IN", {
          promotion_id: promotionId,
          mode: config.mode,
        });
      }
      return;
    }

    if (config.mode === "MAIL_IN_REVIEW" || config.mode === "EXTERNAL_INSTRUCTIONS") {
      throw new SweepstakesError("AMOE_MODE_NOT_ONLINE", {
        promotion_id: promotionId,
        mode: config.mode,
      });
    }
  }

  private assertWindowOpen(config: AmoeConfig, now: Date): void {
    // Semiabierta `[starts_at, ends_at)`, como el resto de ventanas del
    // dominio: el instante exacto del cierre pertenece a un solo lado.
    const at = now.getTime();
    if (
      at < Date.parse(config.submission_window.starts_at) ||
      at >= Date.parse(config.submission_window.ends_at)
    ) {
      throw new SweepstakesError("AMOE_WINDOW_CLOSED", {
        starts_at: config.submission_window.starts_at,
        ends_at: config.submission_window.ends_at,
      });
    }
  }

  /**
   * El payload recortado a las claves que declara identity_requirements.
   *
   * Se recorre a un Map antes de consultar por clave, por el mismo motivo
   * que assertPayloadComplete: con acceso indexado directo, una clave
   * __proto__ leeria la cadena de prototipos en vez del dato.
   */
  private projectPayload(config: AmoeConfig, payload: AmoePayload): AmoePayload {
    const provided = new Map(Object.entries(payload));
    const projected: Record<string, string> = {};
    for (const key of config.identity_requirements) {
      const value = provided.get(key);
      if (typeof value === "string") {
        projected[key] = value;
      }
    }
    return projected;
  }

  private assertPayloadComplete(config: AmoeConfig, payload: AmoePayload): void {
    // Se recorre el payload a un Map antes de consultarlo por clave. Con acceso
    // indexado directo, una clave como '__proto__' dentro de
    // 'identity_requirements' leeria la cadena de prototipos en vez del dato.
    const provided = new Map(Object.entries(payload));
    const missing = config.identity_requirements.filter((key) => {
      const value = provided.get(key);
      return typeof value !== "string" || value.trim() === "";
    });
    if (missing.length > 0) {
      throw new SweepstakesError("AMOE_PAYLOAD_INVALID", { missing_keys: missing });
    }
  }

  private async requireReviewable(submissionId: string): Promise<AmoeSubmission> {
    const submission = await this.deps.submissions.findById(submissionId);
    if (submission === null) {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_FOUND", { submission_id: submissionId });
    }
    if (submission.status !== "SUBMITTED" && submission.status !== "PENDING_REVIEW") {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_REVIEWABLE", {
        submission_id: submissionId,
        status: submission.status,
      });
    }
    return submission;
  }

  /**
   * Revisar AMOE exige DOS cosas: ambito de personal y la capacidad.
   *
   * Comprobar solo la capacidad dejaria pasar a un principal de participante
   * al que se le hubiera adjuntado una clave de administracion. El ambito lo
   * fija el modulo de identidad al resolver la sesion y no se puede fabricar
   * desde el lado del participante.
   */
  private requireCapability(principal: Principal, capability: string): void {
    if (!principalIsStaff(principal)) {
      throw new SweepstakesError("CAPABILITY_REQUIRED", {
        capability,
        reason: "staff_scope_required",
      });
    }
    if (!principalHasCapability(principal, capability)) {
      throw new SweepstakesError("CAPABILITY_REQUIRED", { capability });
    }
  }

  /**
   * Escribe la participacion AMOE.
   *
   * `source_ref = amoe:<submissionId>` es la clave de idempotencia: dos
   * aprobaciones del mismo envio -dos revisores pulsando a la vez, un reintento
   * de red- producen UNA sola concesion, y la impide la restriccion de unicidad
   * del ledger (DEC-009), no el estado del envio.
   */
  private async grant(
    submission: AmoeSubmission,
    config: AmoeConfig,
    actor: Principal["actor"],
    notes: string | null,
    reviewedUnderRulesVersionId: string | null,
  ): Promise<AmoeSubmitOutcome> {
    const now = this.deps.clock.now();
    const sourceRef = entrySourceRef("amoe", submission.id);
    const columns = actorColumns(actor);
    const rulesVersionId = reviewedUnderRulesVersionId ?? submission.rulesVersionId;

    return await this.deps.unitOfWork.withTransaction(async () => {
      // ---- Tope por participante (DEC-052 punto 5) -------------------------
      //
      // Las Official Rules aplican el maximo "regardless of method". Conceder
      // 2,000 a quien ya tiene 10,000 seria concederselas dos veces, asi que la
      // via gratuita hace exactamente la misma aritmetica de espacio restante
      // que el motor aplica a las compras. Dejarselo a la revision humana no
      // vale: el revisor no ve el saldo hasta la proyeccion, y el ledger tiene
      // que cuadrar aunque nadie mire.
      const requested = config.entries_per_approved_submission;
      const cap = await this.capState(submission.promotionId, rulesVersionId);

      // EL CERROJO VA ANTES DE LEER EL SALDO, y ese orden es la garantia
      // entera. Estar dentro de la transaccion no serializa: bajo READ
      // COMMITTED dos aprobaciones concurrentes de fichas DISTINTAS del mismo
      // participante leen las dos el mismo saldo y conceden las dos, y la
      // unicidad de source_ref no lo acota porque es unica por ENVIO. Tomar el
      // cerrojo despues de leer protegeria una lectura que ya ocurrio.
      if (cap.limit !== null) {
        await this.deps.ledger.lockParticipant(submission.promotionId, submission.participantId);
      }

      let granted = requested;
      let appliedCap: JsonObject | null = null;

      if (cap.limit !== null) {
        const history = await this.deps.ledger.listForParticipant(
          submission.promotionId,
          submission.participantId,
        );
        const entriesBefore = computeBalanceAt(
          history,
          submission.promotionId,
          submission.participantId,
          now,
        ).activeEntries;
        const outcome = applyPerParticipantCap(requested, entriesBefore, cap.limit);
        granted = outcome.granted;
        if (outcome.trimmed) {
          appliedCap = {
            kind: "PER_PARTICIPANT",
            limit: cap.limit,
            requested,
            granted,
          };
        }

        if (granted === 0) {
          // Antes de negarse, comprobar si la concesion YA EXISTE. Sin esto, un
          // reintento sobre un envio ya concedido leeria un saldo que incluye
          // su propia concesion, veria espacio cero y respondería "tope
          // alcanzado" en lugar de devolver lo que ya se concedio. La
          // idempotencia no puede depender de que el saldo no haya cambiado.
          const already = await this.deps.ledger.findBySource({
            promotionId: submission.promotionId,
            sourceType: "AMOE",
            sourceRef,
          });
          if (already !== null) {
            const stored = await this.deps.submissions.findById(submission.id);
            return {
              status: "APPROVED",
              submission: stored ?? submission,
              transaction: already,
              entries: already.quantityDelta,
            } as const;
          }

          throw new SweepstakesError("AMOE_ENTRY_CAP_REACHED", {
            submission_id: submission.id,
            promotion_id: submission.promotionId,
            participant_id: submission.participantId,
            limit: cap.limit,
            entries_before: entriesBefore,
            requested,
          });
        }
      }

      let transaction: LedgerTransaction;
      try {
        transaction = await this.deps.ledger.append({
          id: this.deps.ids.next(),
          promotionId: submission.promotionId,
          participantId: submission.participantId,
          type: "AMOE_EARNED",
          // Principio 9: mismo universo, procedencia conservada.
          sourceType: "AMOE",
          sourceRef,
          quantityDelta: granted,
          status: "POSTED",
          // El envio entra en vigor cuando se ENVIO, no cuando se reviso: si no,
          // el retraso de la cola de revision decidiria en que ventana temporal
          // cae la participacion.
          effectiveAt: submission.submittedAt,
          // AMOE no calcula caducidad propia: no pasa por el motor de calculo y
          // `entry_expiration_enabled` esta apagado (DEC-032). El dia que se
          // encienda, esta linea es el punto donde entra `resolveExpiresAt`.
          expiresAt: null,
          recordedAt: now,
          rulesVersionId,
          engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
          // No hay snapshot de calculo: la cantidad es un valor de la
          // configuracion, no el resultado de una formula. Guardar un snapshot
          // vacio solo para rellenar la columna seria ruido.
          calculationSnapshotId: null,
          reversesTransactionId: null,
          actorType: columns.actorType,
          actorAdminUserId: columns.actorAdminUserId,
          actorParticipantId: columns.actorParticipantId,
          reasonKey: ENTRY_REASON_KEYS.amoeApproved,
          reasonDetail: notes,
          metadata: {
            submission_id: submission.id,
            mode: submission.mode,
            // Solo cuando hubo recorte. Presente siempre, seria ruido en el
            // 99% de las filas; ausente cuando lo hubo, seria una entry cuyo
            // importe no se puede explicar leyendo su propia fila.
            ...(appliedCap === null ? {} : { applied_cap: appliedCap }),
          },
        });
      } catch (error) {
        if (isIdempotencyConflict(error)) {
          const winner = await this.deps.ledger.findBySource({
            promotionId: submission.promotionId,
            sourceType: "AMOE",
            sourceRef,
          });
          if (winner !== null) {
            const already = await this.deps.submissions.findById(submission.id);
            return {
              status: "APPROVED",
              submission: already ?? submission,
              transaction: winner,
              entries: winner.quantityDelta,
            } as const;
          }
        }
        throw error;
      }

      const approved = await this.deps.submissions.update({
        ...submission,
        status: "APPROVED",
        reviewedByAdminUserId: actor.type === "ADMIN" ? actor.adminUserId : null,
        reviewedAt: now,
        reviewReasonKey: ENTRY_REASON_KEYS.amoeApproved,
        reviewNotes: notes,
        entryTransactionId: transaction.id,
      });

      await this.deps.audit.emit({
        action: "amoe.submission.approved",
        actor,
        promotionId: submission.promotionId,
        targetEntityType: "AMOESubmission",
        targetEntityId: submission.id,
        reasonKey: ENTRY_REASON_KEYS.amoeApproved,
        reasonDetail: notes,
        occurredAt: now,
        metadata: {
          entry_transaction_id: transaction.id,
          entries: transaction.quantityDelta,
        },
      });

      return {
        status: "APPROVED",
        submission: approved,
        transaction,
        entries: transaction.quantityDelta,
      } as const;
    });
  }
}
