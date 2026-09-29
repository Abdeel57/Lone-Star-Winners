/**
 * Envio de correo transaccional (DEC-058).
 *
 * UN PUERTO, DOS IMPLEMENTACIONES
 *
 *   `resend` habla con la API HTTP de Resend con `fetch`, sin SDK: son dos
 *   cabeceras y un JSON, y un SDK seria una dependencia mas que auditar para
 *   una sola llamada.
 *
 *   `console` no envia nada. Existe para desarrollo y tests, y el esquema de
 *   entorno la rechaza en produccion: ahi significaria que la recuperacion de
 *   contrasena deja de funcionar sin que nadie se entere.
 *
 * LO QUE NUNCA SE REGISTRA
 *
 *   Ni el cuerpo ni el asunto del mensaje: llevan el enlace, y el enlace ES la
 *   credencial. Un log con el enlace permitiria a quien lea los logs
 *   restablecer la contrasena de cualquiera. Tampoco la direccion completa: se
 *   registra enmascarada.
 */

import type { FastifyBaseLogger } from "fastify";

import type { ApiConfig } from "../config/env.js";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /**
   * Etiqueta corta del tipo de mensaje (`email_verification`,
   * `password_reset`). Va a los logs y a Resend; nunca lleva datos personales.
   */
  readonly kind: string;
}

export interface EmailSender {
  /** Nombre estable del proveedor, para logs. */
  readonly provider: string;
  /** Lanza si el proveedor rechaza el envio o no responde a tiempo. */
  send(message: EmailMessage): Promise<void>;
}

/** Error de envio. Lleva el status del proveedor, nunca el mensaje. */
export class EmailDeliveryError extends Error {
  public readonly status: number | null;

  public constructor(status: number | null, cause?: unknown) {
    super(`email_delivery_failed${status === null ? "" : `_${String(status)}`}`, { cause });
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}

/** `ana.perez@example.com` -> `a***@example.com`. Para logs. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Tope de espera. Un proveedor colgado no puede retener una peticion HTTP. */
const RESEND_TIMEOUT_MS = 10_000;

export function createResendEmailSender(options: {
  readonly apiKey: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly fetchImpl?: typeof fetch;
}): EmailSender {
  const doFetch = options.fetchImpl ?? fetch;
  const from = `${options.fromName} <${options.fromAddress}>`;

  return {
    provider: "resend",
    async send(message) {
      let response: Response;

      try {
        response = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            tags: [{ name: "kind", value: message.kind }],
          }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
      } catch (error) {
        throw new EmailDeliveryError(null, error);
      }

      if (!response.ok) {
        // El cuerpo del error de Resend no se propaga: puede repetir la
        // direccion de destino, y el status basta para diagnosticar (401 clave,
        // 403 dominio sin verificar, 422 remitente invalido, 429 cuota).
        throw new EmailDeliveryError(response.status);
      }
    },
  };
}

/**
 * No envia. Deja constancia de que HABRIA enviado.
 *
 * Fuera de produccion imprime el texto del mensaje -enlace incluido-, porque
 * es la unica forma de recorrer el flujo en local: la tabla solo guarda el
 * hash. En produccion no lo imprime nunca, y ademas el esquema de entorno
 * impide que esta implementacion llegue a produccion.
 */
export function createConsoleEmailSender(
  logger: Pick<FastifyBaseLogger, "info">,
  options: { readonly revealContent: boolean },
): EmailSender {
  return {
    provider: "console",
    send(message) {
      logger.info(
        {
          event: "email.console",
          kind: message.kind,
          to: maskEmail(message.to),
          ...(options.revealContent ? { text: message.text } : {}),
        },
        "correo NO enviado (EMAIL_PROVIDER=console)",
      );
      return Promise.resolve();
    },
  };
}

export function createEmailSender(
  config: ApiConfig,
  logger: Pick<FastifyBaseLogger, "info">,
): EmailSender {
  if (config.email.provider === "resend") {
    return createResendEmailSender({
      apiKey: config.email.apiKey,
      fromAddress: config.email.fromAddress,
      fromName: config.email.fromName,
    });
  }

  return createConsoleEmailSender(logger, { revealContent: !config.isProduction });
}
