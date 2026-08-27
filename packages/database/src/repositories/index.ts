/**
 * Adaptadores Drizzle de los puertos del dominio.
 *
 * ---------------------------------------------------------------------------
 * QUE VIVE AQUI Y QUE NO
 * ---------------------------------------------------------------------------
 *
 * Aqui vive SQL. La logica -que se cotiza, que se otorga, quien puede que- vive
 * en `@lsw/sweepstakes`, `@lsw/commerce` y `@lsw/tpa`, que son dominio puro y
 * se prueban sin Docker con adaptadores en memoria.
 *
 * La frontera no es estetica. DEC-018 descarta los mocks para lo que vive en el
 * motor -triggers, exclusion GiST, `pg_advisory_xact_lock`, GRANT por columna-
 * y esas garantias solo se pueden comprobar contra PostgreSQL real. Con el
 * puerto, cada mitad se prueba donde se puede probar de verdad.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA FABRICA, PARA QUE NADIE MONTE LA MITAD
 * ---------------------------------------------------------------------------
 *
 * `createSweepstakesRepositories` construye el conjunto completo atado al mismo
 * ejecutor y a la misma unidad de trabajo. Construirlos sueltos permitiria que
 * uno quedara fuera de la transaccion sin que nada lo avisara, y ese es
 * exactamente el fallo que el `UnitOfWork` de ambito lexico existe para
 * impedir.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "../schema/index.js";
import {
  DrizzleAdjustmentRepository,
  DrizzleDisqualificationRepository,
} from "./adjustment-repository.js";
import { DrizzleAmoeSubmissionRepository } from "./amoe-repository.js";
import { DrizzleAwardHoldRepository } from "./award-hold-repository.js";
import { DrizzleCalculationSnapshotRepository } from "./calculation-snapshot-repository.js";
import {
  DrizzleAuthorizationRepository,
  DrizzleDrawAuthorizationWriter,
  DrizzleDrawingEventChain,
  DrizzlePotentialWinnerRepository,
} from "./draw-repositories.js";
import { DrizzleEntryNumberRepository } from "./entry-number-repository.js";
import { DrizzleUnitOfWork } from "./executor.js";
import { DrizzleParticipantIdentityRepository } from "./identity-repository.js";
import { DrizzleLedgerRepository } from "./ledger-repository.js";
import { DrizzleOrderRepository } from "./order-repository.js";
import { DrizzlePaymentEventRepository } from "./payment-event-repository.js";
import { DrizzlePromotionContextRepository } from "./promotion-context-repository.js";
import { DrizzleSnapshotRepository } from "./snapshot-repository.js";
import type { ContentDigestCalculator } from "./tpa-ports.js";

export * from "./executor.js";
export * from "./ledger-repository.js";
export * from "./calculation-snapshot-repository.js";
export * from "./entry-number-repository.js";
export * from "./identity-repository.js";
export * from "./promotion-context-repository.js";
export * from "./award-hold-repository.js";
export * from "./amoe-repository.js";
export * from "./adjustment-repository.js";
export * from "./order-repository.js";
export * from "./payment-event-repository.js";
export * from "./snapshot-repository.js";
export * from "./draw-repositories.js";
export * from "./tpa-ports.js";
// HO-028: persistencia encadenada de la auditoria. NO entra en
// `createSweepstakesRepositories`: escribir un `AuditEvent` exige el puerto de
// encadenado de `@lsw/audit`, y quien lo monta es `apps/api`, que es donde se
// decide con que implementacion concreta corre el sistema.
export * from "./audit-event-repository.js";

export interface SweepstakesRepositories {
  readonly unitOfWork: DrizzleUnitOfWork;
  readonly ledger: DrizzleLedgerRepository;
  readonly snapshots: DrizzleCalculationSnapshotRepository;
  readonly entryNumbers: DrizzleEntryNumberRepository;
  readonly promotions: DrizzlePromotionContextRepository;
  readonly identity: DrizzleParticipantIdentityRepository;
  readonly holds: DrizzleAwardHoldRepository;
  readonly amoe: DrizzleAmoeSubmissionRepository;
  readonly adjustments: DrizzleAdjustmentRepository;
  readonly disqualifications: DrizzleDisqualificationRepository;
  readonly orders: DrizzleOrderRepository;
  readonly paymentEvents: DrizzlePaymentEventRepository;
  readonly exportSnapshots: DrizzleSnapshotRepository;
  readonly drawAuthorizations: DrizzleAuthorizationRepository;
  readonly drawAuthorizationWriter: DrizzleDrawAuthorizationWriter;
  readonly drawingEvents: DrizzleDrawingEventChain;
  readonly potentialWinners: DrizzlePotentialWinnerRepository;
}

export interface SweepstakesRepositoriesOptions {
  /**
   * Quien calcula el digest del manifiesto de contenido (`@lsw/audit`).
   *
   * Si no se pasa, `recomputeContentDigest` FALLA. No devuelve el guardado: el
   * cerrojo 4 de DEC-017 exige recalcular, y una comparacion de un valor
   * consigo mismo es un control que nunca falla.
   */
  readonly contentDigestCalculator?: ContentDigestCalculator;
}

export function createSweepstakesRepositories(
  db: NodePgDatabase<typeof schema>,
  options: SweepstakesRepositoriesOptions = {},
): SweepstakesRepositories {
  return {
    unitOfWork: new DrizzleUnitOfWork(db),
    ledger: new DrizzleLedgerRepository(db),
    snapshots: new DrizzleCalculationSnapshotRepository(db),
    entryNumbers: new DrizzleEntryNumberRepository(db),
    promotions: new DrizzlePromotionContextRepository(db),
    identity: new DrizzleParticipantIdentityRepository(db),
    holds: new DrizzleAwardHoldRepository(db),
    amoe: new DrizzleAmoeSubmissionRepository(db),
    adjustments: new DrizzleAdjustmentRepository(db),
    disqualifications: new DrizzleDisqualificationRepository(db),
    orders: new DrizzleOrderRepository(db),
    paymentEvents: new DrizzlePaymentEventRepository(db),
    exportSnapshots: new DrizzleSnapshotRepository(db, {
      ...(options.contentDigestCalculator === undefined
        ? {}
        : { digestCalculator: options.contentDigestCalculator }),
    }),
    drawAuthorizations: new DrizzleAuthorizationRepository(db),
    drawAuthorizationWriter: new DrizzleDrawAuthorizationWriter(db),
    drawingEvents: new DrizzleDrawingEventChain(db),
    potentialWinners: new DrizzlePotentialWinnerRepository(db),
  };
}
