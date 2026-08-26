import { Alert } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatInteger, formatZonedDate } from "@/i18n/formatters";
import { localeTag, LOCALE_TAGS, type Locale } from "@/i18n/locales";
import type { OfficialRulesDocumentContent, OfficialRulesResponse } from "@/lib/api";

/**
 * Reglas Oficiales.
 *
 * ESTE ES EL COMPONENTE MAS DELICADO DE LA PARTE PUBLICA
 * ------------------------------------------------------
 * DEC-022 establece una excepcion a la regla general de que el copy es del
 * frontend: el texto legalmente controlante viaja desde el backend POR LOCALE
 * y el frontend lo renderiza tal cual. Aqui eso se traduce en cuatro
 * prohibiciones concretas:
 *
 * 1. **No se traduce.** Ni con `t()`, ni con nada. `t()` solo toca las
 *    etiquetas que rodean al documento (titulo de la pagina, "Version", el
 *    aviso de que idioma controla), nunca el documento.
 * 2. **No se cae de un idioma al otro en silencio.** Si el documento no existe
 *    en el idioma de la interfaz, se dice explicitamente y se muestra el que
 *    hay, identificado. Un participante hispanohablante que reciba el texto en
 *    ingles tiene que SABER que lo esta recibiendo en ingles.
 * 3. **No se supone que el ingles controla.** Cual controla lo dicen las
 *    banderas `is_legally_controlling` / `is_informational_translation`. Hay
 *    fixture con el espanol controlando precisamente para que nadie pueda
 *    cablear la suposicion contraria. Hoy el idioma controlante sigue en `TBD`
 *    (`docs/LEGAL_PENDING.md`), asi que el caso "ninguno declarado" es el real.
 * 4. **No se renderiza HTML.** `docs/API_CONTRACT.md` publica el cuerpo como
 *    una sola cadena, `body`. Se parte en parrafos por lineas en blanco y se
 *    pinta como TEXTO. No hay `dangerouslySetInnerHTML` en ninguna parte: un
 *    documento legal renderizado como marcado seria una via de inyeccion.
 *
 * EL CASO DEFECTUOSO SE ENSEÑA, NO SE TAPA
 * ----------------------------------------
 * Si ninguna version se declara controlante, se dice. Elegir una por nuestra
 * cuenta seria afirmar algo legal que nadie ha aprobado, y es exactamente el
 * tipo de decision que `CLAUDE.md` #2 prohibe tomar aqui.
 *
 * LA ZONA HORARIA LLEGA POR PROP
 * ------------------------------
 * La respuesta de `GET /promotions/{slug}/official-rules` NO trae
 * `legal_timezone`. La pantalla la toma de la promocion, que ya ha pedido. Sin
 * ella, la fecha de entrada en vigor se formatearia contra el reloj del
 * navegador, que es justo lo que DEC-011 prohibe.
 */
export function OfficialRulesDocumentView({
  document,
  locale,
  timeZone,
}: {
  readonly document: OfficialRulesResponse;
  readonly locale: Locale;
  /** Zona legal declarada por la promocion (DEC-011). */
  readonly timeZone: string;
}) {
  const t = useTranslations("officialRules");
  const tLocale = useTranslations("localeName");

  const currentTag = localeTag(locale);
  const controlling = document.documents.filter((content) => content.is_legally_controlling);

  // El documento en el idioma de la interfaz, si existe. Si no, el controlante;
  // y si tampoco, el primero publicado. En los dos ultimos casos se avisa.
  const inCurrentLocale = document.documents.find((content) => content.locale === currentTag);
  const shown = inCurrentLocale ?? controlling[0] ?? document.documents[0];

  if (shown === undefined) {
    return (
      <Alert tone="warning" title={t("notPublished.title")}>
        {t("notPublished.body")}
      </Alert>
    );
  }

  const effective = formatZonedDate(document.effective_at, locale, { timeZone });

  return (
    <article className="flex flex-col gap-s6">
      <header className="flex flex-col gap-s3">
        <p className="text-body-md text-text-muted">{t("intro")}</p>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-label font-medium text-text-muted">{t("versionLabel")}</dt>
            <dd className="mt-1 font-mono text-body-sm text-text">
              {formatInteger(document.version, locale)}
            </dd>
          </div>

          {effective === null ? null : (
            <div>
              <dt className="text-label font-medium text-text-muted">{t("effectiveLabel")}</dt>
              <dd className="mt-1 text-body-sm text-text">
                <time dateTime={document.effective_at}>{effective}</time>
              </dd>
            </div>
          )}
        </dl>

        <p className="text-caption text-text-subtle">{t("timeZoneNote")}</p>
      </header>

      <ControllingNotice
        document={document}
        shown={shown}
        showsRequestedLocale={inCurrentLocale !== undefined}
        requestedTag={currentTag}
        labelFor={(tag) => (tag === "en-US" ? tLocale("en") : tLocale("es"))}
      />

      {/* `lang` explicito: si el documento se muestra en un idioma distinto al
          de la interfaz, un lector de pantalla debe cambiar de voz. Sin esto,
          leeria ingles con pronunciacion espanola o al reves. */}
      <div lang={shown.locale} className="flex flex-col gap-s4 border-t border-border pt-s6">
        {/* El titulo del documento NO va en caja alta: es texto del documento
            legal, no un titular de marca, y transformarlo -aunque sea solo en
            presentacion- lo alejaria de como fue emitido. */}
        <h2 className="font-display text-heading-lg font-semibold text-text">{shown.title}</h2>

        {toParagraphs(shown.body).map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line text-body-md text-text-muted">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}

/**
 * Parte el cuerpo en parrafos.
 *
 * Corta por LINEA EN BLANCO y conserva los saltos simples dentro de cada
 * parrafo (de ahi `whitespace-pre-line` arriba). En un texto legal la sangria y
 * el corte de linea de una lista numerada son parte del documento, y colapsar
 * todo el espacio en blanco los perderia.
 *
 * No interpreta nada mas: ni encabezados, ni negritas, ni marcado. Lo que llega
 * es texto y se pinta como texto.
 */
function toParagraphs(body: string): readonly string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Aviso de que version manda.
 *
 * Cubre los cuatro repartos posibles, y ninguno se deduce: todos se leen de las
 * banderas del contrato.
 */
function ControllingNotice({
  document,
  shown,
  showsRequestedLocale,
  requestedTag,
  labelFor,
}: {
  readonly document: OfficialRulesResponse;
  readonly shown: OfficialRulesDocumentContent;
  readonly showsRequestedLocale: boolean;
  readonly requestedTag: string;
  readonly labelFor: (tag: string) => string;
}) {
  const t = useTranslations("officialRules");

  const controlling = document.documents.filter((content) => content.is_legally_controlling);
  const notices: {
    readonly key: string;
    readonly tone: "info" | "warning";
    readonly text: string;
  }[] = [];

  if (!showsRequestedLocale) {
    notices.push({
      key: "locale",
      tone: "warning",
      text: t("localeNotPublished", { language: labelFor(requestedTag) }),
    });
  }

  if (controlling.length === 0) {
    // Defecto del backend, o -hoy- la consecuencia de que el idioma controlante
    // siga sin decidirse. En ambos casos se dice, no se elige.
    notices.push({ key: "none", tone: "warning", text: t("noControllingDeclared") });
  } else if (controlling.length >= LOCALE_TAGS.length) {
    notices.push({ key: "all", tone: "info", text: t("allControlling") });
  } else if (shown.is_legally_controlling) {
    notices.push({
      key: "controlling",
      tone: "info",
      text: t("controlling", { language: labelFor(shown.locale) }),
    });
  } else {
    const first = controlling[0];
    notices.push({
      key: "informational",
      tone: "warning",
      text: t("informational", {
        language: labelFor(shown.locale),
        controllingLanguage: first === undefined ? labelFor(shown.locale) : labelFor(first.locale),
      }),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {notices.map((notice) => (
        <Alert key={notice.key} tone={notice.tone}>
          {notice.text}
        </Alert>
      ))}
    </div>
  );
}
