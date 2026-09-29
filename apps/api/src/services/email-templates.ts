/**
 * Plantillas de los correos transaccionales (DEC-058), en en-US y es-US.
 *
 * LO QUE ESTOS CORREOS NO DICEN
 *
 *   Igual que las pantallas de `apps/web`: no dicen que sin verificar el correo
 *   no se pueda participar ni que las participaciones dependan de ello. Eso es
 *   un TBD legal (`docs/LEGAL_PENDING.md`) y afirmarlo aqui seria inventar un
 *   requisito (CLAUDE.md #2). La verificacion confirma que la direccion es de
 *   quien dice; el texto no promete nada mas.
 *
 * SIN DATOS DEL USUARIO DENTRO
 *
 *   Ni el nombre ni nada que haya tecleado la persona: lo unico variable es el
 *   enlace, que construye la API. Asi no hay nada que escapar y no hay forma de
 *   meter HTML en un correo que sale con el remitente del negocio.
 */

export type EmailLocale = "en-US" | "es-US";

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Idioma del correo a partir de `Accept-Language`.
 *
 * `apps/web` envia la etiqueta del idioma en que la persona esta leyendo la
 * pagina (`es-US` / `en-US`). Cualquier otra cosa cae en ingles, que es el
 * desempate de DEC-021.
 */
export function emailLocaleFrom(acceptLanguage: string | undefined): EmailLocale {
  return acceptLanguage?.trim().toLowerCase().startsWith("es") === true ? "es-US" : "en-US";
}

/** Segmento de ruta de `apps/web` (DEC-021): `/en/...`, `/es/...`. */
function routeSegment(locale: EmailLocale): "en" | "es" {
  return locale === "es-US" ? "es" : "en";
}

/** Enlace a una pantalla de `apps/web` con el token en la query. */
export function webLink(
  webPublicUrl: string,
  locale: EmailLocale,
  path: "/account/verify-email" | "/account/reset-password",
  token: string,
): string {
  const url = new URL(`/${routeSegment(locale)}${path}`, webPublicUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

interface Copy {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly button: string;
  readonly expiry: string;
  readonly ignore: string;
  readonly fallback: string;
}

const VERIFICATION: Readonly<Record<EmailLocale, Copy>> = {
  "en-US": {
    subject: "Confirm your email for Lone Star Winners",
    heading: "Confirm your email",
    body: "Tap the button below to confirm that this email address belongs to you.",
    button: "Confirm my email",
    expiry: "This link expires in 48 hours and can be used once.",
    ignore: "If you didn't create a Lone Star Winners account, you can ignore this email.",
    fallback: "If the button doesn't work, copy and paste this link into your browser:",
  },
  "es-US": {
    subject: "Confirma tu correo en Lone Star Winners",
    heading: "Confirma tu correo",
    body: "Pulsa el botón de abajo para confirmar que esta dirección de correo es tuya.",
    button: "Confirmar mi correo",
    expiry: "Este enlace vence en 48 horas y solo se puede usar una vez.",
    ignore: "Si no creaste una cuenta en Lone Star Winners, puedes ignorar este correo.",
    fallback: "Si el botón no funciona, copia y pega este enlace en tu navegador:",
  },
};

const PASSWORD_RESET: Readonly<Record<EmailLocale, Copy>> = {
  "en-US": {
    subject: "Reset your Lone Star Winners password",
    heading: "Reset your password",
    body: "We received a request to reset the password for your account. Tap the button below to choose a new one.",
    button: "Choose a new password",
    expiry: "This link expires in 1 hour and can be used once.",
    ignore:
      "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
    fallback: "If the button doesn't work, copy and paste this link into your browser:",
  },
  "es-US": {
    subject: "Restablece tu contraseña de Lone Star Winners",
    heading: "Restablece tu contraseña",
    body: "Recibimos una solicitud para restablecer la contraseña de tu cuenta. Pulsa el botón de abajo para elegir una nueva.",
    button: "Elegir una contraseña nueva",
    expiry: "Este enlace vence en 1 hora y solo se puede usar una vez.",
    ignore:
      "Si no pediste restablecer tu contraseña, puedes ignorar este correo. Tu contraseña no cambiará.",
    fallback: "Si el botón no funciona, copia y pega este enlace en tu navegador:",
  },
};

/**
 * El enlace lo construye `webLink` con `URL`, asi que no lleva comillas ni
 * `<`; aun asi se escapa, porque este archivo no deberia depender de que
 * quien lo llama haya hecho bien su parte.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render(copy: Copy, link: string, lang: string): RenderedEmail {
  const href = escapeHtml(link);

  const html = `<!doctype html>
<html lang="${lang}">
  <body style="margin:0;padding:0;background:#f6f4ef;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#14120e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:4px solid #b8860b;">
            <tr>
              <td style="padding:28px 28px 8px;">
                <p style="margin:0 0 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8860b;font-weight:700;">Lone Star Winners</p>
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;">${copy.heading}</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${copy.body}</p>
                <a href="${href}" style="display:inline-block;background:#14120e;color:#f1d98a;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:6px;">${copy.button}</a>
                <p style="margin:24px 0 8px;font-size:14px;line-height:1.5;color:#5d574b;">${copy.expiry}</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#5d574b;">${copy.ignore}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px;border-top:1px solid #e7e3da;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#5d574b;">${copy.fallback}</p>
                <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${href}" style="color:#b8860b;">${href}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    copy.heading,
    "",
    copy.body,
    "",
    link,
    "",
    copy.expiry,
    copy.ignore,
    "",
    "Lone Star Winners",
  ].join("\n");

  return { subject: copy.subject, html, text };
}

export function renderVerificationEmail(locale: EmailLocale, link: string): RenderedEmail {
  return render(VERIFICATION[locale], link, locale === "es-US" ? "es" : "en");
}

export function renderPasswordResetEmail(locale: EmailLocale, link: string): RenderedEmail {
  return render(PASSWORD_RESET[locale], link, locale === "es-US" ? "es" : "en");
}
