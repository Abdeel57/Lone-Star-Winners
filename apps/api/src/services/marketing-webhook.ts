/**
 * Webhooks del proveedor de correo (DEC-099).
 *
 * LA REGLA DE ORO: EL PROVEEDOR PUEDE QUITAR PERMISO, NUNCA DARLO
 *
 *   Un `contact.updated` con `unsubscribed: false` no escribe nada. La unica
 *   forma de tener permiso es que la propia persona lo de en la plataforma.
 *
 * LO QUE NO SE GUARDA
 *
 *   Direccion, IP, navegador ni asunto. Los eventos de correos transaccionales
 *   (sin `broadcast_id`) tampoco, salvo rebotes y quejas, que afectan a si se le
 *   puede escribir.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ProviderEventEffect, ProviderEventInput } from "./marketing-ports.js";

/** Cinco minutos: lo habitual en Svix para rechazar una entrega repetida a mano. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface SvixHeaders {
  readonly id: string | undefined;
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
}

/** Firma Svix sobre el cuerpo CRUDO. Compara en tiempo constante. */
export function verifyWebhookSignature(input: {
  readonly secret: string;
  readonly headers: SvixHeaders;
  readonly rawBody: Buffer;
  readonly now: Date;
}): boolean {
  const { id, timestamp, signature } = input.headers;
  if (id === undefined || timestamp === undefined || signature === undefined) return false;
  if (!/^\d+$/u.test(timestamp)) return false;

  const age = Math.abs(input.now.getTime() / 1000 - Number.parseInt(timestamp, 10));
  if (age > WEBHOOK_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(input.secret.replace(/^whsec_/u, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(input.rawBody)
    .digest();

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || value === undefined) return false;
    const provided = Buffer.from(value, "base64");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

const NO_EFFECT: ProviderEventEffect = { suppress: null, withdraw: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Traduce un evento a lo que hay que hacer. `null` = no interesa guardarlo.
 * Pura, y sin nada que dependa de la base de datos.
 */
export function interpretResendEvent(
  providerEventId: string,
  payload: unknown,
  receivedAt: Date,
): ProviderEventInput | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const type = textOf(payload.type);
  if (type === null) return null;
  const data = payload.data;

  const parsedAt = Date.parse(textOf(payload.created_at) ?? "");
  const occurredAt = Number.isNaN(parsedAt) ? receivedAt : new Date(parsedAt);
  const firstRecipient = Array.isArray(data.to) ? textOf(data.to[0]) : null;

  const build = (email: string | null, effect: ProviderEventEffect): ProviderEventInput => ({
    providerEventId,
    eventType: type,
    providerEmailId: textOf(data.email_id),
    providerBroadcastId: textOf(data.broadcast_id),
    occurredAt,
    email,
    effect,
  });

  switch (type) {
    case "contact.updated":
      // Sin baja no hay nada que hacer. Y jamas se da permiso desde aqui.
      return data.unsubscribed === true
        ? build(textOf(data.email), { suppress: null, withdraw: "UNSUBSCRIBE_LINK" })
        : null;

    case "contact.deleted":
      return build(textOf(data.email), { suppress: null, withdraw: "EMAIL_PROVIDER" });

    case "email.complained":
      return build(firstRecipient, { suppress: "COMPLAINT", withdraw: "EMAIL_PROVIDER" });

    case "email.bounced": {
      const bounceType = isRecord(data.bounce) ? textOf(data.bounce.type) : null;
      if (bounceType === "Permanent") {
        return build(firstRecipient, { suppress: "HARD_BOUNCE", withdraw: null });
      }
      // Un temporal no es un rebote de verdad: no cuenta como tal en las cifras.
      return textOf(data.broadcast_id) === null
        ? null
        : { ...build(firstRecipient, NO_EFFECT), eventType: "email.bounced.temporary" };
    }

    case "suppression.added": {
      const email = textOf(data.email);
      if (data.origin === "bounce")
        return build(email, { suppress: "HARD_BOUNCE", withdraw: null });
      if (data.origin === "complaint") {
        return build(email, { suppress: "COMPLAINT", withdraw: "EMAIL_PROVIDER" });
      }
      if (data.origin === "manual") {
        return build(email, { suppress: "PROVIDER_MANUAL", withdraw: null });
      }
      return null;
    }

    // Queda constancia, pero aqui la supresion no se levanta sola.
    case "suppression.removed":
      return build(textOf(data.email), NO_EFFECT);

    case "email.sent":
    case "email.delivered":
    case "email.delivery_delayed":
    case "email.opened":
    case "email.clicked":
    case "email.failed":
      // Solo campanas: el correo transaccional no se mide aqui.
      return textOf(data.broadcast_id) === null ? null : build(firstRecipient, NO_EFFECT);

    default:
      return null;
  }
}
