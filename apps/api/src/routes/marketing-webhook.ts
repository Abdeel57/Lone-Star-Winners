/**
 * Webhook del proveedor de correo (DEC-099).
 *
 * Mismo orden que el de pagos: firma sobre el cuerpo crudo, y solo despues
 * parsear. Lo traduce `services/marketing-webhook.ts`; aqui no se decide nada.
 * Nunca se registra la direccion ni el contenido del evento.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { interpretResendEvent, verifyWebhookSignature } from "../services/marketing-webhook.js";

/** La lee tambien el parser de cuerpo crudo de `routes/orders.ts`. */
export const EMAIL_WEBHOOK_URL = "/api/v1/webhooks/email/resend";

const ackSchema = z.object({ received: z.literal(true) });

function headerOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function buildMarketingWebhookRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { config, identity } = dependencies;

  return [
    {
      method: "POST",
      url: EMAIL_WEBHOOK_URL,
      operationId: "receiveEmailProviderWebhook",
      summary: "Bajas, rebotes, quejas y medicion del proveedor de correo (DEC-099).",
      description:
        "Firma Svix sobre el cuerpo crudo, antes de parsear; tolerancia de 5 minutos. Una baja, una queja o un borrado retiran el permiso; un rebote permanente o una queja suprimen. Nunca da permiso: un `unsubscribed: false` no escribe nada. Idempotente por `svix-id`. No guarda direccion, IP, navegador ni asunto. 404 si `RESEND_WEBHOOK_SECRET` no esta configurado.",
      tags: ["commerce"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "El llamante es el proveedor de correo, que no tiene sesion. La autenticacion es CRIPTOGRAFICA: firma HMAC sobre el cuerpo crudo con un secreto compartido. Solo puede retirar permisos o registrar medidas, nunca darlos.",
      },
      schema: {
        response: {
          200: ackSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const secret = config.marketing.webhookSecret;
        if (secret === null) throw ApiErrors.notFound();

        const rawBody = request.body;
        if (!Buffer.isBuffer(rawBody)) {
          request.log.error(
            { event: "email_webhook.raw_body_missing" },
            "el webhook de correo recibio un cuerpo ya parseado",
          );
          throw ApiErrors.internal();
        }

        const now = new Date();
        const id = headerOf(request.headers["svix-id"]);
        const valid = verifyWebhookSignature({
          secret,
          rawBody,
          now,
          headers: {
            id,
            timestamp: headerOf(request.headers["svix-timestamp"]),
            signature: headerOf(request.headers["svix-signature"]),
          },
        });
        if (!valid || id === undefined) throw ApiErrors.unauthenticated();

        let payload: unknown;
        try {
          payload = JSON.parse(rawBody.toString("utf8"));
        } catch {
          // Firmado pero ilegible: reintentarlo no lo arreglaria.
          request.log.warn({ event: "email_webhook.invalid_json" }, "evento ilegible");
          return { received: true as const };
        }

        const event = interpretResendEvent(id, payload, now);
        if (event !== null) await identity.marketing.applyProviderEvent(event);

        return { received: true as const };
      },
    },
  ];
}
