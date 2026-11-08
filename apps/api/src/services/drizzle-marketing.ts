/**
 * Repositorio de correo promocional contra Drizzle (DEC-099).
 *
 * `marketing_eligible_contacts` se consulta aqui y solo aqui. Los filtros de
 * territorio y de version del texto se pasan como JSON para no depender de como
 * expande Drizzle un array dentro de una plantilla SQL.
 */

import type { Database } from "@lsw/database";
import { schema } from "@lsw/database";
import { eq, sql } from "drizzle-orm";

import { readEligibilityRules } from "./eligibility.js";
import { recordConsentEventInTx } from "./drizzle-marketing-consent.js";
import type {
  AudienceFilter,
  CampaignStats,
  ContactSyncRow,
  EligibleContact,
  MarketingCounts,
  MarketingRepository,
  MarketingSegment,
} from "./marketing-ports.js";

const { emailProviderEvents, marketingCampaigns, marketingContactSync, marketingSuppressions } =
  schema;

function filterSql(filter: AudienceFilter) {
  return sql`
    residence_state IS NOT NULL
    AND residence_state NOT IN (
      SELECT jsonb_array_elements_text(${JSON.stringify(filter.excludedStates)}::jsonb)
    )
    AND consent_text_version IN (
      SELECT jsonb_array_elements_text(${JSON.stringify(filter.textVersions)}::jsonb)
    )`;
}

export function createMarketingRepository(db: Database): MarketingRepository {
  return {
    async listEligibleContacts(filter): Promise<readonly EligibleContact[]> {
      const result = await db.execute<{
        participant_id: string;
        email: string;
        preferred_locale: "en-US" | "es-US";
        segment: MarketingSegment;
        consent_text_version: string;
      }>(sql`
        SELECT participant_id, email, preferred_locale, segment, consent_text_version
        FROM marketing_eligible_contacts
        WHERE ${filterSql(filter)}
        ORDER BY participant_id`);

      return result.rows.map((row) => ({
        participantId: row.participant_id,
        email: row.email,
        locale: row.preferred_locale,
        segment: row.segment,
        consentTextVersion: row.consent_text_version,
      }));
    },

    async isEligible(participantId, filter) {
      const result = await db.execute(sql`
        SELECT 1 FROM marketing_eligible_contacts
        WHERE participant_id = ${participantId} AND ${filterSql(filter)}`);
      return result.rows.length > 0;
    },

    async listSyncRows(): Promise<readonly ContactSyncRow[]> {
      const result = await db.execute<{
        participant_id: string;
        provider_contact_id: string;
        segment: MarketingSegment;
        state_hash: string;
        removed_at: Date | string | null;
        anonymized: boolean;
        consent_granted: boolean;
      }>(sql`
        SELECT s.participant_id, s.provider_contact_id, s.segment, s.state_hash, s.removed_at,
               (p.anonymized_at IS NOT NULL) AS anonymized,
               COALESCE(c.status = 'GRANTED', false) AS consent_granted
        FROM marketing_contact_sync s
        JOIN participants p ON p.id = s.participant_id
        LEFT JOIN marketing_email_consent_current c ON c.participant_id = s.participant_id`);

      return result.rows.map((row) => ({
        participantId: row.participant_id,
        providerContactId: row.provider_contact_id,
        segment: row.segment,
        stateHash: row.state_hash,
        removedAt: row.removed_at === null ? null : new Date(row.removed_at),
        anonymized: row.anonymized,
        consentGranted: row.consent_granted,
      }));
    },

    async saveSynced(input) {
      await db
        .insert(marketingContactSync)
        .values({ ...input, removedAt: null })
        .onConflictDoUpdate({
          target: marketingContactSync.participantId,
          set: {
            providerContactId: input.providerContactId,
            segment: input.segment,
            stateHash: input.stateHash,
            syncedAt: input.syncedAt,
            removedAt: null,
          },
        });
    },

    async markRemoved(participantId, at) {
      await db
        .update(marketingContactSync)
        .set({ removedAt: at })
        .where(eq(marketingContactSync.participantId, participantId));
    },

    async readExcludedStates(promotionSlug) {
      const result = await db.execute<{ config: unknown }>(sql`
        SELECT v.config
        FROM promotions p
        JOIN promotion_rules_versions v ON v.id = p.active_rules_version_id
        WHERE p.slug = ${promotionSlug}`);
      const row = result.rows[0];
      if (row === undefined) return null;
      return readEligibilityRules(row.config).excludedStates;
    },

    async applyProviderEvent(input) {
      return db.transaction(async (tx) => {
        const found =
          input.email === null
            ? undefined
            : (
                await tx.execute<{ id: string }>(sql`
                  SELECT p.id
                  FROM participants p
                  JOIN identities i ON i.id = p.identity_id
                  WHERE i.email_normalized = lower(btrim(${input.email}))`)
              ).rows[0];
        const participantId = found?.id ?? null;

        // Primero el evento: su UNIQUE hace que un reintento no repita nada.
        const inserted = await tx
          .insert(emailProviderEvents)
          .values({
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            providerEmailId: input.providerEmailId,
            providerBroadcastId: input.providerBroadcastId,
            participantId,
            occurredAt: input.occurredAt,
          })
          .onConflictDoNothing({ target: emailProviderEvents.providerEventId })
          .returning({ id: emailProviderEvents.id });
        if (inserted.length === 0) return "DUPLICATE" as const;

        if (participantId === null) return "APPLIED" as const;

        if (input.effect.suppress !== null) {
          await tx
            .insert(marketingSuppressions)
            .values({
              participantId,
              reason: input.effect.suppress,
              providerEventId: input.providerEventId,
            })
            .onConflictDoNothing();
        }

        if (input.effect.withdraw !== null) {
          await recordConsentEventInTx(tx, {
            participantId,
            action: "WITHDRAWN",
            source: input.effect.withdraw,
            occurredAt: input.occurredAt,
          });
        }

        return "APPLIED" as const;
      });
    },

    async counts(excludedStates): Promise<MarketingCounts> {
      const consent = await db.execute<{ granted: number; withdrawn: number; none: number }>(sql`
        SELECT
          count(*) FILTER (WHERE c.status = 'GRANTED')::int AS granted,
          count(*) FILTER (WHERE c.status = 'WITHDRAWN')::int AS withdrawn,
          count(*) FILTER (WHERE c.status IS NULL)::int AS none
        FROM participants p
        LEFT JOIN marketing_email_consent_current c ON c.participant_id = p.id
        WHERE p.anonymized_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.identity_id = p.identity_id)`);

      const excluded = JSON.stringify(excludedStates ?? []);
      const audience = await db.execute<{
        buyers: number;
        registered: number;
        outside: number;
      }>(sql`
        WITH t AS (
          SELECT segment,
                 (residence_state IS NULL OR residence_state IN (
                    SELECT jsonb_array_elements_text(${excluded}::jsonb)
                 )) AS outside
          FROM marketing_eligible_contacts
        )
        SELECT
          count(*) FILTER (WHERE segment = 'BUYERS' AND NOT outside)::int AS buyers,
          count(*) FILTER (WHERE segment = 'REGISTERED_NO_PURCHASE' AND NOT outside)::int AS registered,
          count(*) FILTER (WHERE outside)::int AS outside
        FROM t`);

      const suppressions = await db.execute<{ reason: string; n: number }>(sql`
        SELECT reason, count(*)::int AS n FROM marketing_suppressions GROUP BY reason`);
      const byReason = new Map(suppressions.rows.map((row) => [row.reason, row.n]));

      const unsubscribes = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM marketing_email_consent_events
        WHERE action = 'WITHDRAWN' AND source = 'UNSUBSCRIBE_LINK'`);

      return {
        consent: {
          granted: consent.rows[0]?.granted ?? 0,
          withdrawn: consent.rows[0]?.withdrawn ?? 0,
          none: consent.rows[0]?.none ?? 0,
        },
        audience: {
          buyers: audience.rows[0]?.buyers ?? 0,
          registeredNoPurchase: audience.rows[0]?.registered ?? 0,
          excludedByTerritory: excludedStates === null ? null : (audience.rows[0]?.outside ?? 0),
        },
        suppressions: {
          hardBounce: byReason.get("HARD_BOUNCE") ?? 0,
          complaint: byReason.get("COMPLAINT") ?? 0,
          providerManual: byReason.get("PROVIDER_MANUAL") ?? 0,
        },
        unsubscribes: unsubscribes.rows[0]?.n ?? 0,
      };
    },

    async campaignStats(attributionWindowDays): Promise<readonly CampaignStats[]> {
      const engagement = await db.execute<{
        provider_broadcast_id: string;
        name: string | null;
        delivered: number;
        opened: number;
        clicked: number;
        bounced: number;
        complained: number;
      }>(sql`
        SELECT e.provider_broadcast_id, c.name,
          count(DISTINCT e.provider_email_id) FILTER (WHERE e.event_type = 'email.delivered')::int AS delivered,
          count(DISTINCT e.provider_email_id) FILTER (WHERE e.event_type = 'email.opened')::int AS opened,
          count(DISTINCT e.provider_email_id) FILTER (WHERE e.event_type = 'email.clicked')::int AS clicked,
          count(DISTINCT e.provider_email_id) FILTER (WHERE e.event_type = 'email.bounced')::int AS bounced,
          count(DISTINCT e.provider_email_id) FILTER (WHERE e.event_type = 'email.complained')::int AS complained
        FROM email_provider_events e
        LEFT JOIN marketing_campaigns c ON c.provider_broadcast_id = e.provider_broadcast_id
        WHERE e.provider_broadcast_id IS NOT NULL
        GROUP BY e.provider_broadcast_id, c.name
        ORDER BY e.provider_broadcast_id`);

      // Ultimo clic dentro de la ventana, por pedido confirmado. Un pedido cuenta
      // una sola vez, y un reembolso parcial descuenta lo devuelto.
      const attribution = await db.execute<{
        provider_broadcast_id: string;
        currency: string;
        orders: number;
        net_minor: string;
      }>(sql`
        WITH last_click AS (
          SELECT DISTINCT ON (o.id)
            o.id, o.currency,
            (o.total_minor - o.refunded_amount_minor) AS net_minor,
            e.provider_broadcast_id
          FROM orders o
          JOIN email_provider_events e
            ON e.participant_id = o.participant_id
           AND e.event_type = 'email.clicked'
           AND e.provider_broadcast_id IS NOT NULL
           AND e.occurred_at <= o.paid_at
           AND e.occurred_at > o.paid_at - make_interval(days => ${attributionWindowDays})
          WHERE o.status IN ('CONFIRMED', 'PARTIALLY_REFUNDED')
            AND o.paid_at IS NOT NULL
          ORDER BY o.id, e.occurred_at DESC
        )
        SELECT provider_broadcast_id, currency, count(*)::int AS orders,
               sum(net_minor)::text AS net_minor
        FROM last_click
        GROUP BY provider_broadcast_id, currency`);

      return engagement.rows.map((row) => ({
        providerBroadcastId: row.provider_broadcast_id,
        name: row.name,
        delivered: row.delivered,
        opened: row.opened,
        clicked: row.clicked,
        bounced: row.bounced,
        complained: row.complained,
        attributed: attribution.rows
          .filter((entry) => entry.provider_broadcast_id === row.provider_broadcast_id)
          .map((entry) => ({
            currency: entry.currency,
            orders: entry.orders,
            netMinor: entry.net_minor,
          })),
      }));
    },

    async nameCampaign(providerBroadcastId, name, at) {
      await db
        .insert(marketingCampaigns)
        .values({ providerBroadcastId, name, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: marketingCampaigns.providerBroadcastId,
          set: { name, updatedAt: at },
        });
    },
  };
}
