/**
 * Permiso opcional para correo promocional, desde la cuenta (DEC-098).
 *
 * TRES ESTADOS
 *
 *   `NONE`: nunca lo dio. Es el estado de toda cuenta anterior a DEC-098: haber
 *   aceptado las Reglas, los Terminos o la Privacidad NO es permiso.
 *   `GRANTED`: lo dio, con un texto concreto (`text_version`).
 *   `WITHDRAWN`: lo dio y lo retiro.
 *
 * ASIMETRIA A PROPOSITO
 *
 *   Darlo exige que la casilla se ofrezca (`MARKETING_EMAIL_CONSENT_ENABLED`,
 *   que en produccion no se enciende sin el texto aprobado por el abogado), que
 *   llegue la version VIGENTE del texto y que la cuenta tenga correo verificado.
 *   Retirarlo no exige nada: funciona siempre, tambien con la casilla apagada.
 *
 * Lo que aqui se guarda es la prueba del consentimiento (tabla de solo
 * insercion, 0046). Sincronizarlo con el proveedor de correo es otra fase.
 */

import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { MARKETING_EMAIL_CONSENT } from "../config/consents.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import type { ParticipantPrincipal } from "../http/principal-narrow.js";
import type { RouteDefinition } from "../http/route-registry.js";
import type { MarketingConsentState } from "../services/identity-ports.js";

const marketingConsentSchema = z.object({
  /** `NONE` = nunca dio permiso; `WITHDRAWN` = lo dio y lo retiro. */
  status: z.enum(["NONE", "GRANTED", "WITHDRAWN"]),
  /** Version del texto aceptado. Solo con `GRANTED`. */
  text_version: z.string().nullable(),
  /** Desde donde llego el ultimo cambio. `null` con `NONE`. */
  source: z
    .enum(["SIGNUP", "ACCOUNT_SETTINGS", "UNSUBSCRIBE_LINK", "EMAIL_PROVIDER", "SUPPORT"])
    .nullable(),
  updated_at: z.string().nullable(),
  /**
   * Lo que se puede aceptar AHORA: la version vigente del texto. `null` si la
   * casilla no se ofrece. Retirar no depende de esto.
   */
  offer: z
    .object({
      key: z.string(),
      text_version: z.string(),
      text_key: z.string(),
    })
    .nullable(),
});

const marketingConsentBodySchema = z.object({
  /** `true` da el permiso; `false` lo retira. */
  granted: z.boolean(),
  /** Obligatoria con `granted: true`: la version del texto que se mostro. */
  text_version: z.string().min(1).max(100).optional(),
  /** Obligatorio con `granted: true`: el idioma en que se mostro. */
  locale: z.enum(["en-US", "es-US"]).optional(),
});

async function requireParticipant(request: FastifyRequest): Promise<ParticipantPrincipal> {
  const principal = await request.server.lswPrincipalResolver(request);
  // En POSITIVO, como en `portal.ts` (HO-027).
  const isParticipant = principal !== null && principal.kind === "PARTICIPANT";
  if (!isParticipant) throw ApiErrors.unauthenticated();
  return principal;
}

export function buildMarketingConsentRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { identity, config } = dependencies;

  function present(state: MarketingConsentState): z.infer<typeof marketingConsentSchema> {
    return {
      status: state.status,
      text_version: state.textVersion,
      source: state.source,
      updated_at: state.updatedAt === null ? null : state.updatedAt.toISOString(),
      offer: config.marketing.emailConsentEnabled
        ? {
            key: MARKETING_EMAIL_CONSENT.key,
            text_version: MARKETING_EMAIL_CONSENT.version,
            text_key: MARKETING_EMAIL_CONSENT.text_key,
          }
        : null,
    };
  }

  return [
    {
      method: "GET",
      url: "/api/v1/me/marketing-consent",
      operationId: "getMarketingConsent",
      summary: "Permiso de correo promocional de la cuenta (DEC-098).",
      description:
        "`NONE` si nunca lo dio (toda cuenta anterior a DEC-098: aceptar Reglas, Terminos o Privacidad no es permiso), `GRANTED` con la version del texto aceptado, o `WITHDRAWN`. `offer` es la version vigente que se puede aceptar ahora, o `null` si la casilla no se ofrece.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.read" },
      schema: {
        response: {
          200: marketingConsentSchema,
          401: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        return present(await identity.marketingConsent.current(principal.participantId));
      },
    },

    {
      method: "PUT",
      url: "/api/v1/me/marketing-consent",
      operationId: "setMarketingConsent",
      summary: "Dar o retirar el permiso de correo promocional (DEC-098).",
      description:
        "`granted: false` lo retira SIEMPRE, tambien con la casilla apagada; si no estaba dado no escribe nada. `granted: true` exige `text_version` (la vigente de `offer`) y `locale`: 409 MARKETING_CONSENT_NOT_OFFERED si la casilla no se ofrece, 409 MARKETING_CONSENT_TEXT_OUTDATED si el texto mostrado ya no es el vigente, 409 MARKETING_CONSENT_NEEDS_EMAIL si la cuenta no tiene correo verificado. Cada cambio real es una fila nueva de solo insercion con origen `ACCOUNT_SETTINGS`; repetir el mismo estado no escribe.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "participant.self.update" },
      schema: {
        body: marketingConsentBodySchema,
        response: {
          200: marketingConsentSchema,
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requireParticipant(request);
        const body = request.body as z.infer<typeof marketingConsentBodySchema>;
        const now = new Date();

        if (!body.granted) {
          return present(
            await identity.marketingConsent.record({
              participantId: principal.participantId,
              action: "WITHDRAWN",
              source: "ACCOUNT_SETTINGS",
              occurredAt: now,
            }),
          );
        }

        if (body.text_version === undefined || body.locale === undefined) {
          throw ApiErrors.validationFailed([
            ...(body.text_version === undefined
              ? [{ path: "text_version", code: "required" }]
              : []),
            ...(body.locale === undefined ? [{ path: "locale", code: "required" }] : []),
          ]);
        }
        if (!config.marketing.emailConsentEnabled) throw ApiErrors.marketingConsentNotOffered();
        if (body.text_version !== MARKETING_EMAIL_CONSENT.version) {
          throw ApiErrors.marketingConsentTextOutdated(MARKETING_EMAIL_CONSENT.version);
        }

        const me = await identity.identities.findByParticipantId(principal.participantId);
        if (me === null) throw ApiErrors.unauthenticated();
        if (me.email === null || me.emailVerifiedAt === null) {
          throw ApiErrors.marketingConsentNeedsEmail();
        }

        return present(
          await identity.marketingConsent.record({
            participantId: principal.participantId,
            action: "GRANTED",
            textVersion: body.text_version,
            locale: body.locale,
            source: "ACCOUNT_SETTINGS",
            occurredAt: now,
          }),
        );
      },
    },
  ];
}
