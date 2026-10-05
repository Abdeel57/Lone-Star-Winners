/**
 * Solicitudes de privacidad: el formulario de `/privacychoices`.
 *
 * POR QUE EXISTE
 *
 *   La Politica de Privacidad y el Aviso de California publican dos vias para
 *   ejercer derechos -correo a info@ y "our online privacy request form at
 *   https://LoneStarWinners.com/privacychoices"- y la segunda no existia. Esta
 *   ruta es ese formulario.
 *
 * QUE HACE, Y QUE NO
 *
 *   Manda el expediente al buzon del negocio (`PRIVACY_REQUEST_INBOX`, por
 *   defecto el de la Politica) y un acuse a quien la envio. NO decide nada ni
 *   toca la cuenta: verificar la identidad y atender la solicitud lo hace una
 *   persona, que es lo que la Politica describe. Tampoco la guarda en la base:
 *   el registro es el correo en el buzon del negocio, que es donde se atiende.
 *
 *   Si el buzon no recibe el expediente, responde 503: la persona tiene que
 *   saber que su solicitud NO llego, para usar el correo. Si falla solo el
 *   acuse, la solicitud si llego y se responde 202.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { maskEmail } from "../services/email.js";
import {
  PRIVACY_REQUEST_TYPES,
  renderPrivacyRequestAckEmail,
  renderPrivacyRequestInboxEmail,
  type PrivacyRequestFacts,
} from "../services/privacy-request-email.js";

const bodySchema = z.object({
  request_type: z.enum(PRIVACY_REQUEST_TYPES),
  full_name: z.string().trim().min(1).max(200),
  /** Misma forma que el alta: un correo que solo rechazara Resend saldria como 503. */
  email: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u),
  phone: z.string().trim().max(40).nullable().optional(),
  /** Estado de residencia: los derechos dependen de el. Texto libre, sin lista. */
  state: z.string().trim().min(2).max(60),
  details: z.string().trim().max(4000).nullable().optional(),
  authorized_agent: z.boolean().default(false),
  /** Idioma del acuse. Sin defecto (DEC-021): la web manda el de la pagina. */
  language: z.enum(["en-US", "es-US"]),
  bot_check_token: z.string().min(1).max(4096).optional(),
});

const receivedSchema = z.object({
  received: z.literal(true),
  /** Lo que la persona cita si escribe despues. */
  reference: z.string(),
});

/** `PR-` + 10 caracteres sin ambiguedad (sin 0/O ni 1/I). */
function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const byte of bytes) out += alphabet.charAt(byte % alphabet.length);
  return `PR-${out}`;
}

export function buildPrivacyRequestRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { config, email, botCheck } = dependencies;

  return [
    {
      method: "POST",
      url: "/api/v1/privacy-requests",
      operationId: "submitPrivacyRequest",
      summary: "Enviar una solicitud de privacidad (formulario de /privacychoices).",
      description:
        "Manda el expediente al buzon del negocio y un acuse a quien la envia. No decide nada ni toca la cuenta: la verificacion y la respuesta las hace una persona. 503 si el buzon no la recibio. Si hay comprobacion anti-bots configurada, `bot_check_token` es obligatorio.",
      tags: ["privacy"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Los derechos de privacidad se ejercen sin cuenta: la Politica de Privacidad ofrece este formulario a cualquiera, tenga o no cuenta. Lo protegen la comprobacion anti-bots de Turnstile y el limite de peticiones por visitante.",
      },
      schema: {
        body: bodySchema,
        response: {
          202: receivedSchema,
          422: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const body = request.body as z.infer<typeof bodySchema>;

        const checker = botCheck ?? null;
        if (checker !== null) {
          // Sin IP, como en `/auth/phone/start`: la que ve la API es la del
          // servidor de `apps/web`.
          const human =
            body.bot_check_token !== undefined &&
            (await checker.verify(body.bot_check_token, null));
          if (!human) throw ApiErrors.botCheckFailed();
        }

        const phone = body.phone ?? null;
        const details = body.details ?? null;
        const facts: PrivacyRequestFacts = {
          reference: newReference(),
          type: body.request_type,
          fullName: body.full_name,
          email: body.email,
          phone: phone === null || phone.length === 0 ? null : phone,
          state: body.state,
          details: details === null || details.length === 0 ? null : details,
          authorizedAgent: body.authorized_agent,
          language: body.language,
          receivedAt: new Date(),
        };

        const inbox = renderPrivacyRequestInboxEmail(facts);
        try {
          await email.send({
            to: config.privacy.requestInbox,
            subject: inbox.subject,
            html: inbox.html,
            text: inbox.text,
            kind: "privacy_request",
            replyTo: facts.email,
          });
        } catch {
          // El adaptador ya registro el detalle. La persona tiene que saber que
          // NO llego, para usar el correo que la Politica tambien ofrece.
          throw ApiErrors.serviceUnavailable();
        }

        request.log.info(
          {
            event: "privacy_request.received",
            reference: facts.reference,
            request_type: facts.type,
            from: maskEmail(facts.email),
          },
          "solicitud de privacidad entregada al buzon",
        );

        const ack = renderPrivacyRequestAckEmail(facts);
        try {
          await email.send({
            to: facts.email,
            subject: ack.subject,
            html: ack.html,
            text: ack.text,
            kind: "privacy_request_ack",
          });
        } catch (error) {
          // La solicitud SI llego al buzon; solo fallo el acuse.
          request.log.warn(
            { event: "privacy_request.ack_failed", reference: facts.reference, err: error },
            "la solicitud llego pero el acuse no salio",
          );
        }

        void reply.code(202);
        return { received: true as const, reference: facts.reference };
      },
    },
  ];
}
