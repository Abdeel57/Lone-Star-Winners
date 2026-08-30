import { Alert, Badge, buttonVariants, Card, CardTitle } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { RulesConfigForm } from "@/components/admin/rules-config-form";
import {
  ActivateRulesVersionForm,
  RulesDocumentForm,
} from "@/components/admin/rules-version-forms";
import { adminHref } from "@/i18n/admin-routing";
import { reasonLabeller, rulesKeyLabeller, rulesStatusLabeller } from "@/i18n/admin-labels";
import { isLocale, type Locale } from "@/i18n/locales";
import {
  activateRulesVersionAction,
  putRulesDocumentAction,
  updateRulesVersionAction,
} from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { RULES_ACTIVATE_REASONS } from "@/lib/admin/reason-codes";
import { configJson, rulesIssues } from "@/lib/admin/rules-version";
import { fetchAdminRulesVersion, type AdminRulesDocument, type AdminRulesVersion } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Los dos idiomas del documento legal.
 *
 * Son ETIQUETAS BCP-47 (DEC-029), no segmentos de ruta, porque es lo que viaja
 * por la API. Los dos son de primera clase (principio 4): el formulario los
 * pone uno al lado del otro y no uno debajo como "traduccion".
 */
const DOCUMENT_LOCALES = ["en-US", "es-US"] as const;

/**
 * Una version de reglas: configuracion, documentos y activacion
 * (§13.7, DEC-054 punto 1).
 *
 * TRES BLOQUES, EN ORDEN DE COMPROMISO
 * ------------------------------------
 * Primero la CONFIGURACION -lo que la version dice-, luego los DOCUMENTOS -el
 * texto que la publica- y al final ACTIVAR, que es lo unico que cambia algo
 * fuera de este borrador. Ese orden es la razon de que activar quede abajo: es
 * el gesto que exige haber mirado los dos anteriores.
 *
 * SOLO SE EDITA UN `DRAFT`
 * ------------------------
 * Sobre una version `ACTIVE` o `ARCHIVED`, la API responde 409 con el mensaje
 * del trigger de DEC-012, y la pantalla se pinta en solo lectura para no mandar
 * a nadie a rellenar un formulario que va a rebotar. El cerrojo sigue siendo el
 * de la base de datos.
 *
 * LO QUE FALTA SE DICE ANTES DE ACTIVAR, con su identificador tecnico: es lo
 * que se busca en `docs/LEGAL_PENDING.md` y lo que se le pregunta al abogado.
 */
export default async function AdminRulesVersionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; versionId: string }>;
}) {
  const { locale, id, versionId } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.rules" });

  const screen = await openAdminScreen({
    locale,
    current: "promotions",
    path: `/promotions/${id}/rules/${versionId}`,
    title: t("versionTitle"),
    capability: "rules.version.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminRulesVersion(id, versionId, locale, screen.session);

  const canWrite = can(screen.actor, "rules.version.create");
  const canActivate = can(screen.actor, "rules.version.activate");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="promotions"
      title={result.ok ? t("versionLabel", { version: result.data.version }) : t("versionTitle")}
      actions={
        <Link
          href={adminHref(locale, `/promotions/${encodeURIComponent(id)}/rules`)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("backToVersions")}
        </Link>
      }
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <VersionSummary version={result.data} locale={locale} />

          <Card as="section" elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("configHeading")}
            </CardTitle>

            <div className="mt-s4">
              <RulesConfigForm
                locale={locale}
                action={updateRulesVersionAction}
                promotionId={id}
                rulesVersionId={versionId}
                initialConfigJson={configJson(result.data)}
                attorneyReference={result.data.attorney_approval_reference ?? null}
                editable={canWrite && result.data.status === "DRAFT"}
              />
            </div>
          </Card>

          <section aria-labelledby="rules-documents">
            <h2 id="rules-documents" className="lsw-display text-heading-lg text-text">
              {t("documentsHeading")}
            </h2>

            <p className="mt-s2 max-w-narrow text-body-sm text-text-muted">{t("documentsBody")}</p>

            <div className="mt-s4 grid grid-cols-1 gap-s5 lg:grid-cols-2">
              {DOCUMENT_LOCALES.map((documentLocale) => {
                const document = findDocument(result.data.documents, documentLocale);

                return (
                  <Card key={documentLocale} elevation="flat" padding="md">
                    <CardTitle as="h3" size="sm">
                      {documentLocale}
                    </CardTitle>

                    <div className="mt-s4">
                      <RulesDocumentForm
                        locale={locale}
                        action={putRulesDocumentAction}
                        promotionId={id}
                        rulesVersionId={versionId}
                        documentLocale={documentLocale}
                        title={document?.title ?? ""}
                        body={document?.body ?? ""}
                        isLegallyControlling={document?.is_legally_controlling ?? false}
                        isInformationalTranslation={document?.is_informational_translation ?? false}
                        editable={canWrite && result.data.status === "DRAFT"}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          <Card as="section" elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("activateHeading")}
            </CardTitle>

            <div className="mt-s4">
              {result.data.status === "ACTIVE" ? (
                <Alert tone="info">{t("alreadyActive")}</Alert>
              ) : !canActivate ? (
                <Alert tone="info">
                  {t("noActivateCapability", { capability: "rules.version.activate" })}
                </Alert>
              ) : (
                /*
                 * `activatable` es el veredicto del backend (§13.7): borrador,
                 * sin claves sin resolver y sin rebanada invalida. Gobierna el
                 * estado del boton y NO sustituye a la lista de claves
                 * pendientes, que sigue arriba: un boton gris sin decir por que
                 * devuelve a mirar logs. Tampoco es el control -lo es el
                 * trigger de DEC-012-, asi que el 409 se ensena igual.
                 */
                <ActivateRulesVersionForm
                  locale={locale}
                  action={activateRulesVersionAction}
                  promotionId={id}
                  rulesVersionId={versionId}
                  {...(result.data.activatable ? {} : { blockedReason: t("blockedByUnresolved") })}
                  reasons={await activationReasons(locale)}
                />
              )}
            </div>
          </Card>
        </div>
      )}
    </AdminChrome>
  );
}

async function activationReasons(
  locale: Locale,
): Promise<readonly { readonly value: string; readonly label: string }[]> {
  const label = await reasonLabeller(locale);
  return RULES_ACTIVATE_REASONS.map((value) => ({ value, label: label(value) }));
}

/**
 * El documento de un locale, si existe.
 *
 * La comparacion es EXACTA sobre la etiqueta BCP-47: no hay fallback de `es-US`
 * a `es` ni al reves. Un documento legal servido bajo una etiqueta que no es la
 * suya seria peor que la ausencia.
 */
function findDocument(
  documents: readonly AdminRulesDocument[] | undefined,
  documentLocale: string,
): AdminRulesDocument | null {
  return (documents ?? []).find((document) => document.locale === documentLocale) ?? null;
}

/** Estado, validacion y claves sin resolver, antes de tocar nada. */
async function VersionSummary({
  version,
  locale,
}: {
  readonly version: AdminRulesVersion;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.rules" });
  const statusLabel = await rulesStatusLabeller(locale);
  const keyLabel = await rulesKeyLabeller(locale);

  const unresolved = version.unresolved_required_keys;
  const issues = rulesIssues(version);
  const validation = version.validation;

  return (
    <Card as="section" elevation="raised" padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <CardTitle as="h2" size="sm">
          {t("summaryHeading")}
        </CardTitle>

        <Badge tone={version.status === "ACTIVE" ? "success" : "neutral"} size="sm">
          {statusLabel(version.status)}
        </Badge>
      </div>

      {validation === undefined ? null : (
        <dl className="mt-s4 grid grid-cols-1 gap-s3 sm:grid-cols-3">
          <SliceRow label={t("sliceCalculation")} value={validation.calculation ?? null} />
          <SliceRow label={t("sliceAmoe")} value={validation.amoe ?? null} />
          <SliceRow label={t("sliceBonusRules")} value={validation.bonus_rules ?? null} />
        </dl>
      )}

      {unresolved.length === 0 ? null : (
        <div className="mt-s5">
          <h3 className="text-label font-medium text-text">{t("unresolvedHeading")}</h3>
          <p className="mt-s1 text-caption text-text-subtle">{t("unresolvedBody")}</p>

          <ul className="mt-s3 flex list-none flex-wrap gap-2">
            {unresolved.map((key) => (
              <li key={key}>
                <Badge tone="warning" size="sm" emphasis="subtle">
                  {keyLabel(key)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {issues.length === 0 ? null : (
        <div className="mt-s5">
          <h3 className="text-label font-medium text-text">{t("issuesHeading")}</h3>

          <ul className="mt-s2 flex list-none flex-col gap-1 font-mono text-caption text-text-muted">
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.code}`}>
                {issue.path} — {issue.code}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * El veredicto de una rebanada del validador.
 *
 * `OK`, `INVALID`, `UNRESOLVED` y `ABSENT` no son lo mismo y se pintan
 * distinto: "no has puesto AMOE" y "el AMOE que pusiste no parsea" mandan a
 * hacer cosas distintas. El valor se ensena EN CRUDO porque es un codigo
 * estable del backend, no una frase.
 */
function SliceRow({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption uppercase tracking-wide text-text-subtle">{label}</dt>
      <dd className="mt-s1">
        {value === null ? (
          <span className="text-body-sm text-text-subtle">—</span>
        ) : (
          <Badge
            tone={value === "OK" ? "success" : value === "ABSENT" ? "neutral" : "warning"}
            size="sm"
          >
            {value}
          </Badge>
        )}
      </dd>
    </div>
  );
}
