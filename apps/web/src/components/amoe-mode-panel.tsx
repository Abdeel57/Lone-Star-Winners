import { Alert, buttonVariants, Card, CardTitle } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import { AmoeForm } from "@/components/amoe-form";
import { formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { isSafeExternalUrl, normalizeAmoeConfig } from "@/lib/amoe-config";
import { pickLocalized, type AmoeConfig } from "@/lib/api";

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
}: {
  readonly config: AmoeConfig;
  readonly locale: Locale;
  readonly promotionSlug: string;
  /** Si hay sesion de participante. El envio la exige (`amoe.self.submit`). */
  readonly authenticated: boolean;
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
   * El formulario SOLO se ofrece con las tres condiciones a la vez: modalidad
   * que lo admite, campos publicados por el backend, y promocion identificada.
   * Sin campos no se puede componer un envio sin inventarse que se pide, y sin
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

        <AmoeWindow config={config} locale={locale} />

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
async function AmoeWindow({
  config,
  locale,
}: {
  readonly config: AmoeConfig;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "amoe.page" });

  const { opensAt: opens, closesAt: closes } = normalizeAmoeConfig(config);

  if (opens === null && closes === null) return null;

  return (
    <dl className="mt-s5 grid grid-cols-1 gap-s3 sm:grid-cols-2">
      {opens === null ? null : (
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">
            {t("windowOpens")}
          </dt>
          <dd className="text-body-sm text-text">
            {formatZonedDateTime(opens, locale, { timeZone: "UTC", showTimeZoneName: true }) ?? ""}
          </dd>
        </div>
      )}

      {closes === null ? null : (
        <div>
          <dt className="text-caption uppercase tracking-wide text-text-subtle">
            {t("windowCloses")}
          </dt>
          <dd className="text-body-sm text-text">
            {formatZonedDateTime(closes, locale, { timeZone: "UTC", showTimeZoneName: true }) ?? ""}
          </dd>
        </div>
      )}
    </dl>
  );
}
