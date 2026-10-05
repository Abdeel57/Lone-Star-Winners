/**
 * Correos de las solicitudes de privacidad (`POST /privacy-requests`).
 *
 * Dos mensajes por solicitud:
 *
 * 1. Al BUZON del negocio, en ingles y con todo lo que escribio la persona: es
 *    el expediente con el que se atiende. `reply_to` es quien la envio, asi que
 *    contestar el correo le responde a ella. TODO lo que viene del formulario
 *    se escapa: es texto de un desconocido dentro de un correo que sale con el
 *    remitente del negocio.
 * 2. A quien la envio, en su idioma: el ACUSE. No repite lo que escribio -un
 *    acuse que devolviera el texto convertiria el formulario en un emisor de
 *    correos con contenido ajeno- y solo dice lo que ya promete la Politica de
 *    Privacidad: que se verificara la identidad comparando con nuestros
 *    registros y que la respuesta llega en 45 dias.
 */

import type { EmailLocale, RenderedEmail } from "./email-templates.js";

export const PRIVACY_REQUEST_TYPES = [
  "ACCESS",
  "DELETE",
  "CORRECT",
  "OPT_OUT_SALE_SHARING",
  "LIMIT_SENSITIVE",
  "APPEAL",
  "OTHER",
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export interface PrivacyRequestFacts {
  readonly reference: string;
  readonly type: PrivacyRequestType;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly state: string;
  readonly details: string | null;
  readonly authorizedAgent: boolean;
  readonly language: EmailLocale;
  readonly receivedAt: Date;
}

const TYPE_LABEL: Readonly<Record<EmailLocale, Readonly<Record<PrivacyRequestType, string>>>> = {
  "en-US": {
    ACCESS: "Access / know what we collect",
    DELETE: "Delete my personal information",
    CORRECT: "Correct my personal information",
    OPT_OUT_SALE_SHARING: "Do not sell or share my personal information",
    LIMIT_SENSITIVE: "Limit the use of my sensitive personal information",
    APPEAL: "Appeal a decision on a previous request",
    OTHER: "Other privacy question",
  },
  "es-US": {
    ACCESS: "Acceder / saber qué datos recopilamos",
    DELETE: "Borrar mi información personal",
    CORRECT: "Corregir mi información personal",
    OPT_OUT_SALE_SHARING: "No vender ni compartir mi información personal",
    LIMIT_SENSITIVE: "Limitar el uso de mi información personal sensible",
    APPEAL: "Apelar la decisión sobre una solicitud anterior",
    OTHER: "Otra consulta de privacidad",
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function frame(lang: string, inner: string): string {
  return `<!doctype html>
<html lang="${lang}">
  <body style="margin:0;padding:0;background:#f6f4ef;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#14120e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:4px solid #b8860b;">
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8860b;font-weight:700;">Lone Star Winners</p>
${inner}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Fecha y hora UTC legibles e inequivocas para un expediente. */
function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** El expediente que llega al buzon del negocio. */
export function renderPrivacyRequestInboxEmail(facts: PrivacyRequestFacts): RenderedEmail {
  const rows: readonly (readonly [string, string])[] = [
    ["Reference", facts.reference],
    ["Request type", TYPE_LABEL["en-US"][facts.type]],
    ["Received", utcStamp(facts.receivedAt)],
    ["Full name", facts.fullName],
    ["Email", facts.email],
    ["Phone", facts.phone ?? "(not provided)"],
    ["State of residence", facts.state],
    ["Submitted by an authorized agent", facts.authorizedAgent ? "Yes" : "No"],
    ["Language", facts.language === "es-US" ? "Spanish" : "English"],
  ];

  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-size:14px;color:#5d574b;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;">${escapeHtml(value)}</td></tr>`,
    )
    .join("\n");

  const details =
    facts.details === null
      ? `<p style="margin:16px 0 0;font-size:14px;color:#5d574b;">No additional details.</p>`
      : `<p style="margin:16px 0 4px;font-size:14px;font-weight:700;">Details</p><p style="margin:0;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(facts.details)}</p>`;

  const html = frame(
    "en",
    `                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.25;">New privacy request</h1>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#5d574b;">Submitted through the privacy choices page. The Privacy Policy commits to verifying the requester's identity and responding within 45 days. Reply to this email to answer the requester directly.</p>
                <table role="presentation" cellpadding="0" cellspacing="0">${table}</table>
                ${details}`,
  );

  const text = [
    "New privacy request (privacy choices page)",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Details:",
    facts.details ?? "(none)",
    "",
    "The Privacy Policy commits to verifying the requester's identity and responding within 45 days.",
  ].join("\n");

  return {
    subject: `[Privacy request ${facts.reference}] ${TYPE_LABEL["en-US"][facts.type]}`,
    html,
    text,
  };
}

const ACK: Readonly<
  Record<
    EmailLocale,
    {
      readonly subject: (reference: string) => string;
      readonly heading: string;
      readonly body: (reference: string, received: string, type: string) => string;
      readonly next: string;
      readonly contact: string;
    }
  >
> = {
  "en-US": {
    subject: (reference) => `We received your privacy request (${reference})`,
    heading: "We received your privacy request",
    body: (reference, received, type) =>
      `We received your request "${type}" on ${received}. Your reference is ${reference}.`,
    next: "To protect your information, we will verify your identity by comparing what you sent with our records, and we may ask you for more information. We respond within 45 days, as described in our Privacy Policy.",
    contact:
      "If you did not send this request, or want to add something, write to info@LoneStarWinners.com and include your reference.",
  },
  "es-US": {
    subject: (reference) => `Recibimos tu solicitud de privacidad (${reference})`,
    heading: "Recibimos tu solicitud de privacidad",
    body: (reference, received, type) =>
      `Recibimos tu solicitud «${type}» el ${received}. Tu referencia es ${reference}.`,
    next: "Para proteger tu información, verificaremos tu identidad comparando lo que enviaste con nuestros registros, y podemos pedirte más datos. Respondemos en un plazo de 45 días, como explica nuestra Política de Privacidad.",
    contact:
      "Si no enviaste esta solicitud, o quieres añadir algo, escribe a info@LoneStarWinners.com indicando tu referencia.",
  },
};

/** El acuse para quien envio la solicitud, en su idioma. */
export function renderPrivacyRequestAckEmail(facts: PrivacyRequestFacts): RenderedEmail {
  const copy = ACK[facts.language];
  const received = utcStamp(facts.receivedAt);
  const type = TYPE_LABEL[facts.language][facts.type];
  const body = copy.body(facts.reference, received, type);

  const html = frame(
    facts.language === "es-US" ? "es" : "en",
    `                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;">${escapeHtml(copy.heading)}</h1>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(body)}</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${escapeHtml(copy.next)}</p>
                <p style="margin:0;font-size:14px;line-height:1.5;color:#5d574b;">${escapeHtml(copy.contact)}</p>`,
  );

  const text = [
    copy.heading,
    "",
    body,
    "",
    copy.next,
    "",
    copy.contact,
    "",
    "Lone Star Winners",
  ].join("\n");

  return { subject: copy.subject(facts.reference), html, text };
}
