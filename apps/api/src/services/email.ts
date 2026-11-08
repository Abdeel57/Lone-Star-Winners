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
  /**
   * A quien va la respuesta. Lo usa la solicitud de privacidad que llega al
   * buzon del negocio: contestar el correo responde a quien la envio.
   */
  readonly replyTo?: string;
}

export interface EmailSender {
  /** Nombre estable del proveedor, para logs. */
  readonly provider: string;
  /** Lanza si el proveedor rechaza el envio o no responde a tiempo. */
  send(message: EmailMessage): Promise<void>;
}

/**
 * Codigos de Resend que dicen que se acabo la CUOTA del plan, no que el envio
 * estuviera mal: el diario se reinicia a medianoche UTC; el mensual, no.
 * Con ellos ningun correo sale hasta entonces, tampoco los codigos de acceso.
 */
const QUOTA_ERRORS = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

/** Error de envio. Lleva el status y el codigo del proveedor, nunca el mensaje. */
export class EmailDeliveryError extends Error {
  public readonly status: number | null;
  /** `name` de Resend (`daily_quota_exceeded`, ...), o `null`. No es un dato personal. */
  public readonly providerError: string | null;

  public constructor(status: number | null, cause?: unknown, providerError: string | null = null) {
    super(`email_delivery_failed${status === null ? "" : `_${String(status)}`}`, { cause });
    this.name = "EmailDeliveryError";
    this.status = status;
    this.providerError = providerError;
  }

  /** La cuota del plan esta agotada: reintentar ahora no sirve. */
  public get quotaExhausted(): boolean {
    return this.providerError !== null && QUOTA_ERRORS.has(this.providerError);
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

/** Lo que el adaptador escribe en el log. Nunca el cuerpo ni el asunto. */
type EmailLogger = Pick<FastifyBaseLogger, "info" | "error">;

/**
 * Enmascara cualquier direccion de correo dentro de un texto.
 *
 * El mensaje de error de Resend puede repetir la direccion de destino ("Invalid
 * `to` field: ..."). Se registra porque es lo que explica el rechazo, pero con
 * la direccion enmascarada, como en el resto de logs de correo.
 */
function maskEmailsIn(text: string): string {
  return text.replace(/[^\s@"'<>]+@[^\s@"'<>]+/gu, (address) => maskEmail(address));
}

/** Lee el cuerpo JSON de Resend sin lanzar: un cuerpo raro no debe ocultar el status. */
async function readResendBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createResendEmailSender(options: {
  readonly apiKey: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly logger: EmailLogger;
  readonly fetchImpl?: typeof fetch;
}): EmailSender {
  const doFetch = options.fetchImpl ?? fetch;
  const from = `${options.fromName} <${options.fromAddress}>`;
  const { logger } = options;

  return {
    provider: "resend",
    async send(message) {
      // Solo tipo y destinatario enmascarado: el cuerpo lleva el enlace, que es
      // una credencial.
      const context = { provider: "resend", kind: message.kind, to: maskEmail(message.to) };
      logger.info({ event: "email.send.start", ...context }, "enviando correo");

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
            ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
            tags: [{ name: "kind", value: message.kind }],
          }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
      } catch (error) {
        // Red caida, DNS o tiempo agotado: Resend nunca llego a responder.
        logger.error(
          { event: "email.send.error", ...context, status: null, err: error },
          "el proveedor de correo no respondio",
        );
        throw new EmailDeliveryError(null, error);
      }

      const body = await readResendBody(response);

      if (!response.ok) {
        // 401 clave, 403 dominio sin verificar, 422 remitente o destinatario
        // invalido, 429 cuota o ritmo. `name` y `message` son los de Resend,
        // con cualquier direccion enmascarada.
        const providerError = typeof body.name === "string" ? body.name : null;
        const failure = new EmailDeliveryError(response.status, undefined, providerError);
        logger.error(
          {
            // Un evento propio para la cuota: es la alarma que hay que vigilar,
            // porque sin cuota tampoco salen los codigos de acceso.
            event: failure.quotaExhausted ? "email.quota.exhausted" : "email.send.error",
            ...context,
            status: response.status,
            provider_error: providerError,
            provider_message:
              typeof body.message === "string" ? maskEmailsIn(body.message).slice(0, 300) : null,
          },
          "el proveedor de correo rechazo el envio",
        );
        throw failure;
      }

      logger.info(
        {
          event: "email.send.ok",
          ...context,
          provider_message_id: typeof body.id === "string" ? body.id : null,
        },
        "correo aceptado por el proveedor",
      );
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

export function createEmailSender(config: ApiConfig, logger: EmailLogger): EmailSender {
  if (config.email.provider === "resend") {
    return createResendEmailSender({
      apiKey: config.email.apiKey,
      fromAddress: config.email.fromAddress,
      fromName: config.email.fromName,
      logger,
    });
  }

  return createConsoleEmailSender(logger, { revealContent: !config.isProduction });
}
