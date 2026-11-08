/**
 * Estadisticas de correo promocional y nombre de las campanas (DEC-099).
 *
 * SOLO CIFRAS
 *
 *   Ninguna respuesta lleva direccion, nombre ni identificador de participante.
 *   Por eso basta `dashboard.read`, la capacidad de los agregados del panel.
 *
 * NOMBRAR NO ENVIA
 *
 *   El broadcast se crea y se envia desde Resend, por una persona. Aqui solo se
 *   le pone un nombre para que el informe se pueda leer.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { errorEnvelopeSchema } from "../http/errors.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";

const marketingStatsSchema = z.object({
  generated_at: z.string(),
  attribution_window_days: z.number().int(),
  consent: z.object({
    granted: z.number().int(),
    withdrawn: z.number().int(),
    none: z.number().int(),
  }),
  audience: z.object({
    buyers: z.number().int(),
    registered_no_purchase: z.number().int(),
    excluded_by_territory: z.number().int().nullable(),
  }),
  suppressions: z.object({
    hard_bounce: z.number().int(),
    complaint: z.number().int(),
    provider_manual: z.number().int(),
  }),
  unsubscribes: z.number().int(),
  campaigns: z.array(
    z.object({
      provider_broadcast_id: z.string(),
      name: z.string().nullable(),
      delivered: z.number().int(),
      opened: z.number().int(),
      clicked: z.number().int(),
      bounced: z.number().int(),
      complained: z.number().int(),
      attributed: z.array(
        z.object({
          currency: z.string(),
          orders: z.number().int(),
          net_minor: z.string(),
        }),
      ),
    }),
  ),
});

const campaignParamsSchema = z.object({
  provider_broadcast_id: z.string().min(1).max(100),
});

const campaignBodySchema = z.object({ name: z.string().trim().min(1).max(120) });

const campaignResponseSchema = z.object({
  provider_broadcast_id: z.string(),
  name: z.string(),
});

export function buildAdminMarketingRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { config, identity } = dependencies;

  return [
    {
      method: "GET",
      url: "/api/v1/admin/marketing/stats",
      operationId: "getAdminMarketingStats",
      summary: "Cifras agregadas de correo promocional (DEC-099).",
      description:
        "Permisos dados, retirados y sin permiso; audiencia por segmento; supresiones; bajas; y, por campana, entregas, aperturas y clics unicos, rebotes, quejas y pedidos confirmados atribuidos al ultimo clic dentro de la ventana. Solo cifras: ninguna direccion, nombre ni identificador de persona.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "dashboard.read" },
      schema: {
        response: {
          200: marketingStatsSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);

        const slug = config.marketing.sync.targetPromotionSlug;
        const excludedStates =
          slug === null ? null : await identity.marketing.readExcludedStates(slug);
        const windowDays = config.marketing.attributionWindowDays;

        const [counts, campaigns] = await Promise.all([
          identity.marketing.counts(excludedStates),
          identity.marketing.campaignStats(windowDays),
        ]);

        return {
          generated_at: new Date().toISOString(),
          attribution_window_days: windowDays,
          consent: counts.consent,
          audience: {
            buyers: counts.audience.buyers,
            registered_no_purchase: counts.audience.registeredNoPurchase,
            excluded_by_territory: counts.audience.excludedByTerritory,
          },
          suppressions: {
            hard_bounce: counts.suppressions.hardBounce,
            complaint: counts.suppressions.complaint,
            provider_manual: counts.suppressions.providerManual,
          },
          unsubscribes: counts.unsubscribes,
          campaigns: campaigns.map((campaign) => ({
            provider_broadcast_id: campaign.providerBroadcastId,
            name: campaign.name,
            delivered: campaign.delivered,
            opened: campaign.opened,
            clicked: campaign.clicked,
            bounced: campaign.bounced,
            complained: campaign.complained,
            attributed: campaign.attributed.map((entry) => ({
              currency: entry.currency,
              orders: entry.orders,
              net_minor: entry.netMinor,
            })),
          })),
        };
      },
    },

    {
      method: "PUT",
      url: "/api/v1/admin/marketing/campaigns/:provider_broadcast_id",
      operationId: "nameAdminMarketingCampaign",
      summary: "Poner nombre a un broadcast para los informes (DEC-099).",
      description:
        "Solo guarda el nombre legible de un broadcast creado en Resend. No crea, programa ni envia nada.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.update" },
      schema: {
        params: campaignParamsSchema,
        body: campaignBodySchema,
        response: {
          200: campaignResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof campaignParamsSchema>;
        const body = request.body as z.infer<typeof campaignBodySchema>;

        await identity.marketing.nameCampaign(params.provider_broadcast_id, body.name, new Date());
        return { provider_broadcast_id: params.provider_broadcast_id, name: body.name };
      },
    },
  ];
}
