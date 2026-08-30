import { Alert, buttonVariants, Card, CardTitle } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { AmoeForm } from "@/components/amoe-form";
import { formatEntryCount, formatInteger, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { isSafeExternalUrl, normalizeAmoeConfig } from "@/lib/amoe-config";
import { pickLocalized, type AmoeConfig, type EntryOfferAmoeSummary } from "@/lib/api";

/**
 * Interfaz de la via gratuita, segun la modalidad vigente (DEC-032).
 *
 * CUATRO MODALIDADES, CUATRO PANTALLAS. `amoe_mode` es un enum y no un booleano
 * precisamente por esto: un formulario en linea, unas instrucciones postales,
 * un codigo y una remision a instrucciones externas no comparten interfaz. Con
 * un booleano, la interfaz sabria que existe una via gratuita y no cual pintar.
 *
 * LAS INSTRUCCIONES SE RENDERIZAN TAL CUAL
 * ----------------------------------------
 * Son contenido legalmente controlante, igual que las Reglas Oficiales: es la
 * excepcion que reconoce DEC-022. El frontend NO redacta la direccion postal,
 * ni el formato del sobre, ni los limites, ni los plazos. Si el backend calla,
 * esta pantalla remite al documento en vez de rellenar el hueco (CLAUDE.md #2).
 *
 * Se pintan como TEXTO PLANO partido en parrafos por lineas en blanco, igual
 * que el documento de Reglas: no hay `dangerouslySetInnerHTML` en ninguna parte
 * de esta interfaz.
 *
 * EL CASO INTERMEDIO EXISTE Y ESTA CUBIERTO: `enabled: true` con `mode: null`
 * significa que alguien encendio la funcion antes de publicar la modalidad. Se
 * dice; no se elige una por cuenta propia.
 */
export async function AmoeModePanel({
  config,
  locale,
  promotionSlug,
  authenticated,
  summary,
  timeZone,
}: {
  readonly config: AmoeConfig;
  readonly locale: Locale;
  readonly promotionSlug: string;
  /** Si hay sesion de participante. El envio la exige (`amoe.self.submit`). */
  readonly authenticated: boolean;
  /**
   * Resumen AMOE de la promocion (§13.5), como SEGUNDA fuente de las cifras.
   *
   * `GET …/amoe-config` todavia no publica el valor por ficha ni el limite -es
   * una peticion abierta a backend, ver `AmoeConfig`- y §13.5 si los publica
   * dentro de `entry_offer.amoe`. Se prefiere lo que traiga la configuracion,
   * porque es la fuente completa, y se cae a este resumen cuando falte.
   *
   * `null` cuando la pagina no pudo leer la promocion. Entonces no se dice
   * ninguna cifra: la ausencia se pinta como ausencia.
   */
  readonly summary: EntryOfferAmoeSummary | null;
  /** Zona legal de la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
}) {
  const t = await getTranslations({ locale, namespace: "amoe.page" });

  /*
   * La normalizacion vive en `@/lib/amoe-config` y no aqui, por dos motivos:
   * es logica pura y se puede probar sin montar un componente de servidor, y
   * asi la regla -"ausente y nulo significan lo mismo"- se aplica en UN sitio
   * en vez de repetirse en cada pantalla que lea esta configuracion.
   */
  const normalized = normalizeAmoeConfig(config);

  const instructions =
    normalized.instructions === null ? null : pickLocalized(normalized.instructions, locale);

  const fields = normalized.fields;
  const promotionId = normalized.promotionId;
  const externalUrl = normalized.externalUrl;

  /*
   * QUE MODALIDAD PINTA UN FORMULARIO LO DECIDE ESTA INTERFAZ, no la presencia
   * de `required_fields`. La configuracion publica esas claves en LAS CUATRO
   * modalidades -el dominio las exige en cualquier envio que entre por la API-,
   * asi que unas instrucciones postales llegan con campos declarados y siguen
   * siendo un envio por correo. Pintar un formulario porque "vienen campos"
   * diria que se puede participar desde la web, que es exactamente lo contrario
   * de lo que dicen esas instrucciones.
   *
   * Dicho eso, el formulario SOLO se ofrece con las tres condiciones a la vez:
   * modalidad que lo admite, campos publicados y promocion identificada. Sin
   * campos no se puede componer un envio sin inventarse que se pide, y sin
   * identificador no hay a que promocion enviarlo.
   */
  const formModes = config.mode === "ONLINE_FORM" || config.mode === "CODE";
  const canSubmit = formModes && fields.length > 0 && promotionId !== null;

  return (
    <div className="flex flex-col gap-s6">
      <Card elevation="raised" padding="lg">
        <CardTitle as="h2" size="sm">
          {t("howHeading")}
        </CardTitle>

        {config.mode === null ? (
          <Alert tone="info" className="mt-s4">
            {t("modeNotPublished")}
          </Alert>
        ) : null}

        {instructions === null ? (
          <p className="mt-s4 text-body-md text-text-muted">{t("noInstructions")}</p>
        ) : (
          <div className="mt-s4 flex flex-col gap-s3">
            {instructions
              .split(/\n\s*\n/)
              .map((paragraph) => paragraph.trim())
              .filter((paragraph) => paragraph.length > 0)
              .map((paragraph) => (
                <p key={paragraph} className="whitespace-pre-line text-body-md text-text-muted">
                  {paragraph}
                </p>
              ))}
          </div>
        )}

        {/*
         * LOS DATOS DE LA VIA POSTAL, ANTES DE LA VENTANA (§13.2, DEC-054).
         *
         * Cuanto vale una ficha, cuantas admite el periodo, cuantas caben en un
         * sobre y hasta cuando se admite el matasellos son CONFIGURACION -los
         * fija la version de reglas- y no prosa legal: se pintan como datos,
         * cada uno solo si llega. Las instrucciones de arriba siguen siendo el
         * texto del abogado, tal cual.
         *
         * Sin estas cifras, la pagina de la via gratuita solo podia remitir al
         * documento, y quien quiere participar sin comprar tiene que poder
         * saber cuanto vale su ficha antes de escribirla.
         */}
        <AmoeMailInFacts
          rows={mailInRows(config, summary, locale, timeZone, t)}
          note={t("mailInNote")}
        />

        <AmoeWindow
          config={config}
          locale={locale}
          opensLabel={t("windowOpens")}
          closesLabel={t("windowCloses")}
        />

        <div className="mt-s6 flex flex-wrap gap-s3">
          <Link
            href={`/official-rules?promotion=${encodeURIComponent(promotionSlug)}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("officialRulesCta")}
          </Link>

          {/*
           * EXTERNAL_INSTRUCTIONS: el destino se valida antes de pintarlo como
           * enlace. Solo `https:`. Un destino con otro esquema -`javascript:`,
           * `data:`- renderizado como `href` es ejecucion de codigo de terceros
           * en esta pagina, y aqui el destino lo escribe quien configura la
           * promocion.
           */}
          {config.mode === "EXTERNAL_INSTRUCTIONS" && isSafeExternalUrl(externalUrl) ? (
            <a
              href={externalUrl ?? ""}
              rel="noopener noreferrer external"
              target="_blank"
              className={buttonVariants({ variant: "accent", size: "sm" })}
            >
              {t("externalCta")}
            </a>
          ) : null}
        </div>
      </Card>

      {/*
       * MAIL_IN_REVIEW no tiene control de envio, y eso NO es una pantalla a
       * medias: la via gratuita de esa modalidad ocurre por correo postal, y un
       * boton aqui sugeriria que se puede participar desde la web, que es
       * exactamente lo contrario de lo que dicen las instrucciones.
       */}
      {formModes ? (
        <Card elevation="raised" padding="lg">
          <CardTitle as="h2" size="sm">
            {t("submitHeading")}
          </CardTitle>

          {!authenticated ? (
            <div className="mt-s4">
              <p className="text-body-sm text-text-muted">{t("signInToSubmit")}</p>
              <Link
                href="/account/login?next=%2Famoe"
                className={`${buttonVariants({ variant: "accent", size: "sm" })} mt-s4`}
              >
                {t("signInCta")}
              </Link>
            </div>
          ) : !canSubmit ? (
            <Alert tone="info" className="mt-s4">
              {t("formNotPublished")}
            </Alert>
          ) : (
            <div className="mt-s5">
              <AmoeForm
                locale={locale}
                promotionSlug={promotionSlug}
                promotionId={promotionId ?? ""}
                fields={fields}
              />
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Ventana de envio.
 *
 * SE MUESTRA, NO SE INTERPRETA. La interfaz no decide con el reloj del
 * navegador si la ventana esta abierta -eso es DEC-011- ni deshabilita el
 * formulario por su cuenta: quien decide es el backend, y lo dice rechazando el
 * envio con `AMOE_WINDOW_CLOSED`. Una ventana que el navegador cree cerrada y
 * el backend abierta impediria participar gratis, que es el peor error posible
 * en esta pantalla.
 */
function AmoeWindow({
  config,
  locale,
  opensLabel,
  closesLabel,
}: {
  readonly config: AmoeConfig;
  readonly locale: Locale;
  /**
   * Las dos etiquetas, YA TRADUCIDAS por el componente asincrono de arriba.
   *
   * Este componente era `async` solo para pedirlas, y eso tenia un coste que no
   * se veia: un componente asincrono anidado SUSPENDE el arbol entero en
   * cualquier renderizador que no sea el del servidor de Next, de modo que el
   * panel completo se quedaba en blanco -sin fallar- en las pruebas. Formatear
   * dos fechas no necesita ser asincrono.
   */
  readonly opensLabel: string;
  readonly closesLabel: string;
}) {
  const { opensAt: opens, closesAt: closes } = normalizeAmoeConfig(config);

  if (opens === null && closes === null) return null;

  return (
    <dl className="mt-s5 grid grid-cols-1 gap-s3 sm:grid-cols-2">
      {opens === null ? null : (
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">{opensLabel}</dt>
          <dd className="text-body-sm text-text">
            {formatZonedDateTime(opens, locale, { timeZone: "UTC", showTimeZoneName: true }) ?? ""}
          </dd>
        </div>
      )}

      {closes === null ? null : (
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">{closesLabel}</dt>
          <dd className="text-body-sm text-text">
            {formatZonedDateTime(closes, locale, { timeZone: "UTC", showTimeZoneName: true }) ?? ""}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Las cifras de la via postal, cada una solo si llega (§13.2, §13.5).
 *
 * SON CONFIGURACION, NO PROSA LEGAL. El valor por ficha, el limite por
 * participante, las fichas por sobre y los dos plazos los fija la version de
 * reglas; el frontend los PINTA. Las instrucciones -la direccion postal, el
 * formato exigido- siguen siendo texto del abogado y se renderizan aparte, tal
 * cual.
 *
 * DOS FUENTES, UNA PREFERENTE. `GET …/amoe-config` es la completa y §13.5
 * publica un resumen dentro de `entry_offer.amoe`; se usa la primera y se cae
 * al resumen cuando falta, que es lo que hoy pasa con el valor por ficha. Si no
 * hay ninguna de las dos, la fila no se pinta: una cifra ausente se dice
 * callandola, nunca con un cero.
 *
 * SIN NINGUNA CIFRA NO HAY BLOQUE. Un recuadro vacio bajo las instrucciones
 * pareceria un fallo de carga.
 */
function AmoeMailInFacts({
  rows,
  note,
}: {
  readonly rows: readonly MailInRow[];
  readonly note: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-s5">
      <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="text-caption uppercase tracking-wide text-text-subtle">{row.label}</dt>
            <dd className="text-body-md text-text">{row.value}</dd>
          </div>
        ))}
      </dl>

      {/* La nota recuerda de donde salen: son datos de las Reglas Oficiales, no
          afirmaciones de esta pagina. */}
      <p className="mt-s3 text-caption text-text-subtle">{note}</p>
    </div>
  );
}

/** Una fila del bloque postal, ya formateada. */
interface MailInRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/**
 * Las filas que hay, en el orden en que se leen.
 *
 * SE COMPONEN EN EL COMPONENTE ASINCRONO -que ya tiene el traductor- y bajan
 * ya resueltas. No es estilo: un componente asincrono anidado suspende el arbol
 * entero en el renderizador de cliente, y el bloque no se veria en las pruebas
 * ni en ningun render que no fuera el del servidor de Next.
 */
function mailInRows(
  config: AmoeConfig,
  summary: EntryOfferAmoeSummary | null,
  locale: Locale,
  timeZone: string,
  t: (
    key: "entriesPerCard" | "maxPerParticipant" | "cardsPerEnvelope" | "postmarkBy" | "receivedBy",
  ) => string,
): readonly MailInRow[] {
  const entriesPerCard =
    config.entries_per_approved_submission ?? summary?.entries_per_approved_submission ?? null;
  const maxPerPeriod =
    config.max_per_participant_per_period ?? summary?.max_per_participant_per_period ?? null;
  const cardsPerEnvelope = config.mail_in?.max_cards_per_envelope ?? null;

  const postmarkBy =
    config.mail_in?.postmark_by === undefined || config.mail_in.postmark_by === null
      ? null
      : formatZonedDateTime(config.mail_in.postmark_by, locale, {
          timeZone,
          showTimeZoneName: true,
        });

  const receivedBy =
    config.mail_in?.received_by === undefined || config.mail_in.received_by === null
      ? null
      : formatZonedDateTime(config.mail_in.received_by, locale, {
          timeZone,
          showTimeZoneName: true,
        });

  return [
    entriesPerCard === null
      ? null
      : {
          key: "entriesPerCard",
          label: t("entriesPerCard"),
          value: formatEntryCount(entriesPerCard, locale),
        },
    maxPerPeriod === null
      ? null
      : {
          key: "maxPerPeriod",
          label: t("maxPerParticipant"),
          value: formatInteger(maxPerPeriod, locale),
        },
    cardsPerEnvelope === null
      ? null
      : {
          key: "cardsPerEnvelope",
          label: t("cardsPerEnvelope"),
          value: formatInteger(cardsPerEnvelope, locale),
        },
    postmarkBy === null ? null : { key: "postmarkBy", label: t("postmarkBy"), value: postmarkBy },
    receivedBy === null ? null : { key: "receivedBy", label: t("receivedBy"), value: receivedBy },
  ].filter((row): row is MailInRow => row !== null);
}
