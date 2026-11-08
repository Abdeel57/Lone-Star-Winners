/**
 * Adaptador de contactos de Resend (DEC-099).
 *
 * LO QUE ESTE MODULO NO PUEDE HACER
 *
 *   Enviar correos. Solo conoce `/contacts` y `/events/send`; no hay ninguna
 *   llamada a `/emails` ni a `/broadcasts`, y `test/marketing-boundary` lo
 *   comprueba. Los eventos solo existen si se enciende
 *   `MARKETING_AUTOMATION_EVENTS_ENABLED`, y solo hacen algo si alguien creo
 *   antes la automatizacion en Resend.
 *
 * RITMO
 *
 *   El limite de Resend (10 peticiones por segundo) es de EQUIPO: lo comparten
 *   todas las claves, tambien la de los codigos de acceso. Aqui se deja una
 *   pausa entre peticiones para no acercarse a el.
 */

import { MarketingProviderError, type MarketingContactProvider } from "./marketing-ports.js";

const RESEND_API = "https://api.resend.com";
const TIMEOUT_MS = 10_000;
/** 400 ms entre peticiones: 2.5 por segundo, una cuarta parte del limite. */
const MIN_INTERVAL_MS = 400;

function encodeRef(reference: string): string {
  return encodeURIComponent(reference);
}

export function createResendMarketingProvider(options: {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly minIntervalMs?: number;
}): MarketingContactProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.minIntervalMs ?? MIN_INTERVAL_MS;

  async function call(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
    await sleep(interval);

    let response: Response;
    try {
      response = await doFetch(`${RESEND_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new MarketingProviderError(null, error);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = {};
    }
    return {
      status: response.status,
      body:
        typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {},
    };
  }

  /** Falla salvo en los estados que quien llama admite. */
  async function expect(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
    alsoOk: readonly number[] = [],
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
    const result = await call(method, path, body);
    const ok = (result.status >= 200 && result.status < 300) || alsoOk.includes(result.status);
    if (!ok) throw new MarketingProviderError(result.status);
    return result;
  }

  function contactIdFrom(body: Record<string, unknown>): string {
    if (typeof body.id !== "string") throw new MarketingProviderError(null);
    return body.id;
  }

  return {
    async createOrAttach(input) {
      // Primero por direccion, y SIN tocar `unsubscribed`: si esa persona ya se
      // habia dado de baja en Resend, esta sincronizacion no la vuelve a suscribir.
      const existing = await expect(
        "PATCH",
        `/contacts/${encodeRef(input.email)}`,
        { properties: input.properties },
        [404],
      );

      let contactId: string;
      if (existing.status === 404) {
        const created = await expect("POST", "/contacts", {
          email: input.email,
          unsubscribed: false,
          properties: input.properties,
        });
        contactId = contactIdFrom(created.body);
      } else {
        contactId = contactIdFrom(existing.body);
      }

      await expect(
        "POST",
        `/contacts/${encodeRef(contactId)}/segments/${encodeRef(input.segmentId)}`,
      );
      return { contactId };
    },

    async updateContact(contactId, input) {
      await expect("PATCH", `/contacts/${encodeRef(contactId)}`, {
        properties: input.properties,
        ...(input.resubscribe ? { unsubscribed: false } : {}),
      });
    },

    async moveSegment(contactId, addSegmentId, removeSegmentId) {
      await expect("POST", `/contacts/${encodeRef(contactId)}/segments/${encodeRef(addSegmentId)}`);
      if (removeSegmentId !== null) {
        await expect(
          "DELETE",
          `/contacts/${encodeRef(contactId)}/segments/${encodeRef(removeSegmentId)}`,
          undefined,
          [404],
        );
      }
    },

    async removeFromSegment(contactId, segmentId) {
      await expect(
        "DELETE",
        `/contacts/${encodeRef(contactId)}/segments/${encodeRef(segmentId)}`,
        undefined,
        [404],
      );
    },

    async unsubscribe(contactId) {
      // Si ya no existe alli, la baja ya esta hecha.
      await expect("PATCH", `/contacts/${encodeRef(contactId)}`, { unsubscribed: true }, [404]);
    },

    async deleteContact(contactId) {
      await expect("DELETE", `/contacts/${encodeRef(contactId)}`, undefined, [404]);
    },

    async sendAutomationEvent(contactId, event) {
      await expect("POST", "/events/send", { event, contact_id: contactId });
    },
  };
}
