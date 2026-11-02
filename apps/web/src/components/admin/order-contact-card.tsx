import { buttonVariants, Card, CardTitle } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import {
  pickLocalized,
  type AdminOrderContact,
  type LocalizedText,
  type OrderDetail,
} from "@/lib/api";
import type { ActionResult } from "@/lib/action-result";
import { publicSiteOrigin } from "@/lib/site-origin";

import { ContactPhoneForm } from "./contact-phone-form";

/**
 * A donde lleva el enlace del mensaje: la pantalla de entrar con la vuelta a
 * "Mis participaciones". Quien ya tiene sesion no ve el login (la pagina lo
 * redirige a `next`); quien no, entra y aterriza en sus participaciones. Va SIN
 * prefijo de idioma: se lo pone el enlace con el idioma del cliente.
 */
const ENTRIES_RETURN_PATH = "/account/entries";

/**
 * Contacto del cliente de un pedido (DEC-094).
 *
 * EL CASO QUE LO PIDIO: el repartidor llega con la mercancia, el cliente no
 * sale y la tienda no tiene como avisarle. La ficha del pedido no llevaba ni
 * correo ni celular (viajan enmascarados; `order.read` no es PII), y el
 * completo solo existia detras de `pii.view.full`, con segundo factor y motivo.
 *
 * LO QUE PINTA: nombre, celular y correo, y tres acciones a un toque. El
 * WhatsApp abre `wa.me` con el mensaje YA REDACTADO -confirmacion del pedido y
 * de sus participaciones, con el nombre del sorteo- EN EL IDIOMA DEL CLIENTE,
 * que no tiene por que ser el del panel: `preferred_locale` viene de su cuenta.
 * Quien opera lo lee y lo manda desde su propio WhatsApp; aqui no se envia
 * nada ni se guarda nada.
 *
 * LO QUE NO DECIDE: si se puede ver. Esta tarjeta solo se pinta cuando el actor
 * tiene `order.contact.read`, y el dato lo sirve una ruta aparte que deja un
 * AuditEvent por cada lectura. Lo que no se puede ver no se pide.
 */
export async function OrderContactCard({
  contact,
  order,
  promotionName,
  locale,
  phoneAction = null,
}: {
  readonly contact: AdminOrderContact;
  readonly order: OrderDetail;
  /** Nombre publico de la promocion, o `null` si no se pudo leer. */
  readonly promotionName: LocalizedText | null;
  readonly locale: Locale;
  /**
   * DEC-097: la accion que guarda el celular de CONTACTO, o `null` si el actor
   * no tiene `participant.contact.update`. Llega de la pagina, como en el
   * formulario de envio: la tarjeta no decide quien puede escribir.
   */
  readonly phoneAction?:
    ((previous: ActionResult, formData: FormData) => Promise<ActionResult>) | null;
}) {
  const t = await getTranslations({ locale, namespace: "admin.orderContact" });

  // El mensaje va en el idioma del CLIENTE, no en el de quien opera.
  const customerLocale = customerLocaleOf(contact.preferred_locale);
  const tc = await getTranslations({ locale: customerLocale, namespace: "admin.orderContact" });

  const name = contact.display_name ?? order.shipping_address?.full_name ?? null;
  const entries = order.entries_granted;
  const promotion = promotionName === null ? null : pickLocalized(promotionName, customerLocale);

  /*
   * El enlace a "Mis participaciones", absoluto y en el idioma del cliente.
   * Pasa por el login con `next`: con sesion va directo; sin ella, entra y
   * aterriza ahi. Los numeros de participacion se ven en esa pantalla cuando
   * el interruptor `visible_entry_numbers_enabled` esta encendido (DEC-080).
   */
  const origin = await publicSiteOrigin();
  const entriesLink = `${origin}/${customerLocale}/account/login?next=${encodeURIComponent(
    ENTRIES_RETURN_PATH,
  )}`;

  const greeting = name === null ? tc("greeting") : tc("greetingNamed", { name });
  const body =
    entries === null || entries <= 0
      ? tc("messageOrder", { order: order.order_number })
      : promotion === null
        ? tc("messageEntriesNoPromotion", { order: order.order_number, entries })
        : tc("messageEntries", { order: order.order_number, entries, promotion });
  const message = `${greeting} ${body} ${tc("entriesLink", { link: entriesLink })}`;

  // `wa.me` quiere el numero en digitos, sin `+` ni separadores.
  const digits = contact.phone === null ? "" : contact.phone.replace(/\D/gu, "");
  const whatsappHref =
    digits === "" ? null : `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  const telHref = contact.phone === null ? null : `tel:${contact.phone}`;
  /*
   * SMS (o iMessage, si el telefono de quien opera y el del cliente lo tienen):
   * el esquema `sms:` abre la app de mensajes con el numero y el texto. `?&body=`
   * es la forma que entienden a la vez iOS y Android.
   */
  const smsHref =
    contact.phone === null ? null : `sms:${contact.phone}?&body=${encodeURIComponent(message)}`;
  const mailHref =
    contact.email === ""
      ? null
      : `mailto:${contact.email}?subject=${encodeURIComponent(
          tc("emailSubject", { order: order.order_number }),
        )}&body=${encodeURIComponent(message)}`;

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("heading")}
      </CardTitle>
      <p className="mt-s2 text-body-sm text-text-muted">{t("intro")}</p>

      <dl className="mt-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">
            {t("nameLabel")}
          </dt>
          <dd className="text-body-sm text-text">{name ?? t("notGiven")}</dd>
        </div>

        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">
            {t("phoneLabel")}
          </dt>
          <dd className="text-body-sm text-text">
            {contact.phone === null || telHref === null ? (
              t("notGiven")
            ) : (
              <a href={telHref} className="underline underline-offset-2">
                {contact.phone}
              </a>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">
            {t("emailLabel")}
          </dt>
          <dd className="break-all text-body-sm text-text">
            {contact.email === "" ? (
              t("notGiven")
            ) : (
              <a href={`mailto:${contact.email}`} className="underline underline-offset-2">
                {contact.email}
              </a>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-s5 flex flex-wrap gap-s3">
        {whatsappHref === null ? null : (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "accent", size: "md" })}
          >
            {t("whatsapp")}
          </a>
        )}
        {smsHref === null ? null : (
          <a href={smsHref} className={buttonVariants({ variant: "secondary", size: "md" })}>
            {t("sms")}
          </a>
        )}
        {telHref === null ? null : (
          <a href={telHref} className={buttonVariants({ variant: "secondary", size: "md" })}>
            {t("call")}
          </a>
        )}
        {mailHref === null ? null : (
          <a href={mailHref} className={buttonVariants({ variant: "secondary", size: "md" })}>
            {t("email")}
          </a>
        )}
      </div>

      {whatsappHref === null && smsHref === null && mailHref === null ? null : (
        <p className="mt-s3 text-caption text-text-subtle">{t("prefilledHint")}</p>
      )}

      {phoneAction === null ? null : (
        <ContactPhoneForm
          locale={locale}
          participantId={contact.participant_id}
          hasPhone={contact.phone !== null}
          action={phoneAction}
        />
      )}
    </Card>
  );
}

/**
 * Idioma del cliente a partir de su etiqueta (`es-US`, `en-US`). Lo que no sea
 * espanol se trata como ingles, que es el desempate del sitio.
 */
function customerLocaleOf(tag: string): Locale {
  return tag.toLowerCase().startsWith("es") ? "es" : "en";
}
