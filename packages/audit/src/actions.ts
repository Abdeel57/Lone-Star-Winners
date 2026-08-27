/**
 * Catalogo de acciones auditables.
 *
 * Son identificadores ESTABLES: se persisten y un tercero los leera dentro de
 * meses. Renombrar uno rompe el historico; se anade uno nuevo y se deja de usar
 * el anterior.
 *
 * Criterio de inclusion: se audita todo lo que un auditor externo necesitaria
 * para reconstruir por que el universo de entries es como es, y todo lo que
 * podria usarse para manipularlo.
 */

export const AUDIT_ACTIONS = Object.freeze({
  // Identidad y acceso
  SESSION_CREATED: "session.created",
  SESSION_REVOKED: "session.revoked",
  LOGIN_FAILED: "auth.login_failed",
  MFA_ENROLLED: "auth.mfa_enrolled",
  MFA_RESET: "auth.mfa_reset",
  STEP_UP_COMPLETED: "auth.step_up_completed",
  ROLE_ASSIGNED: "rbac.role_assigned",
  ROLE_REVOKED: "rbac.role_revoked",
  STAFF_ACCOUNT_CREATED: "rbac.staff_account_created",

  // Promocion y reglas (DEC-012)
  PROMOTION_CREATED: "promotion.created",
  PROMOTION_ACTIVATED: "promotion.activated",
  PROMOTION_CLOSED: "promotion.closed",
  RULES_VERSION_CREATED: "rules.version_created",
  RULES_VERSION_ACTIVATED: "rules.version_activated",

  // Feature flags (DEC-013)
  FEATURE_FLAG_CHANGED: "flag.changed",
  LEGALLY_MATERIAL_FLAG_CHANGED: "flag.legally_material_changed",

  // Entries y dinero (DEC-007)
  ENTRIES_AWARDED: "entry.awarded",
  ENTRIES_REVERSED: "entry.reversed",
  MANUAL_ADJUSTMENT_PROPOSED: "entry.adjustment_proposed",
  MANUAL_ADJUSTMENT_APPROVED: "entry.adjustment_approved",
  MANUAL_ADJUSTMENT_REJECTED: "entry.adjustment_rejected",
  REFUND_PROCESSED: "order.refund_processed",
  CHARGEBACK_PROCESSED: "order.chargeback_processed",
  WEBHOOK_RECEIVED: "payment.webhook_received",
  WEBHOOK_REJECTED: "payment.webhook_rejected",

  // AMOE
  AMOE_SUBMITTED: "amoe.submitted",
  AMOE_APPROVED: "amoe.approved",
  AMOE_REJECTED: "amoe.rejected",

  // Participante
  PARTICIPANT_DISQUALIFIED: "participant.disqualified",
  PII_FULL_VIEWED: "pii.full_viewed",
  PII_EXPORTED: "pii.exported",

  // Export y TPA (DEC-016)
  SNAPSHOT_CREATED: "export.snapshot_created",
  SNAPSHOT_VALIDATED: "export.snapshot_validated",
  SNAPSHOT_FINALIZED: "export.snapshot_finalized",
  SNAPSHOT_SUPERSEDED: "export.snapshot_superseded",
  SNAPSHOT_SEALED: "export.snapshot_sealed",
  EXPORT_PACKAGE_BUILT: "export.package_built",
  EXPORT_DOWNLOADED: "export.downloaded",
  EXPORT_DELIVERED: "export.delivered",
  EXPORT_DELIVERY_FAILED: "export.delivery_failed",
  EXPORT_DELIVERY_ACKNOWLEDGED: "export.delivery_acknowledged",
  TPA_CONFIG_CHANGED: "tpa.config_changed",
  TPA_RESULT_INGESTED: "tpa.result_ingested",

  // Sorteo interno (DEC-017)
  DRAW_AUTHORIZATION_CREATED: "draw.authorization_created",
  DRAW_AUTHORIZATION_REVOKED: "draw.authorization_revoked",
  DRAW_APPROVAL_GRANTED: "draw.approval_granted",
  DRAW_COMMITMENT_PUBLISHED: "draw.commitment_published",
  DRAW_INITIATED: "draw.initiated",
  DRAW_COMPLETED: "draw.completed",
  DRAW_REJECTED: "draw.rejected",
  DRAW_SEED_REVEALED: "draw.seed_revealed",

  // Ganador potencial
  POTENTIAL_WINNER_SELECTED: "winner.selected",
  POTENTIAL_WINNER_STATUS_CHANGED: "winner.status_changed",
  WINNER_PUBLISHED: "winner.published",

  // Integridad (DEC-008)
  INTEGRITY_CHECK: "audit.integrity_check",
  INTEGRITY_FAILURE: "audit.integrity_failure",
  CHAIN_HEAD_SEALED: "audit.chain_head_sealed",
} as const);

export type AuditActionKey = keyof typeof AUDIT_ACTIONS;
export type AuditActionId = (typeof AUDIT_ACTIONS)[AuditActionKey];

export const AUDIT_ACTION_IDS: readonly AuditActionId[] = Object.freeze(
  Object.values(AUDIT_ACTIONS),
);

export function isAuditActionId(value: string): value is AuditActionId {
  return (AUDIT_ACTION_IDS as readonly string[]).includes(value);
}
