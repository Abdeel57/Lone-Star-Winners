import { Badge, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { CreateRulesVersionForm } from "@/components/admin/rules-version-forms";
import { adminHref } from "@/i18n/admin-routing";
import { rulesKeyLabeller, rulesStatusLabeller } from "@/i18n/admin-labels";
import { formatZonedDateTime } from "@/i18n/formatters";
import { isLocale, type Locale } from "@/i18n/locales";
import { createRulesVersionAction } from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { rulesIssues } from "@/lib/admin/rules-version";
import { fetchAdminRulesVersions, type AdminRulesVersion } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Versiones de reglas de una promocion (§13.7, DEC-054 punto 1).
 *
 * POR QUE ESTA PANTALLA EXISTE
 * ----------------------------
 * Hasta HO-041, la `PromotionRulesVersion` no tenia superficie de escritura:
 * las reglas se cargaban por SQL. El dueño de este producto no ejecuta
 * comandos, y una configuracion legal cargada a mano no deja traza de quien la
 * escribio ni por que. Sin esta pantalla, ninguna de las reglas del segundo
 * borrador es operable desde la plataforma.
 *
 * LO QUE AQUI SE VE ANTES DE ENTRAR EN UNA VERSION
 * ------------------------------------------------
 * Su numero, su estado, cuando entro en vigor y -lo importante- QUE LE FALTA:
 * las claves legales sin resolver y los problemas que el validador encontro por
 * rebanadas. Es la version en pantalla de lo que DEC-012 pide del validador:
 * que la respuesta a "por que no puedo activar" no sea mirar logs.
 *
 * NINGUNA CLAVE SE RELLENA SOLA. Un borrador nuevo llega con todas las
 * requeridas en `"TBD"`, que es el estado honesto y el que bloquea la
 * activacion.
 */
export default async function AdminRulesVersionsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.rules" });

  const screen = await openAdminScreen({
    locale,
    current: "promotions",
    path: `/promotions/${id}/rules`,
    title: t("title"),
    capability: "rules.version.read",
  });

  if (!screen.ok) return screen.node;

  const versions = await fetchAdminRulesVersions(id, {}, locale, screen.session);
  const canCreate = can(screen.actor, "rules.version.create");

  const items = versions.ok ? versions.data.items : [];

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="promotions"
      title={t("title")}
      description={t("body")}
      actions={
        <Link
          href={adminHref(locale, `/promotions/${encodeURIComponent(id)}`)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("backToPromotion")}
        </Link>
      }
    >
      <div className="flex flex-col gap-s6">
        <Card as="section" elevation="raised" padding="lg">
          <CardTitle as="h2" size="sm">
            {t("createHeading")}
          </CardTitle>

          <div className="mt-s4">
            {canCreate ? (
              <CreateRulesVersionForm
                locale={locale}
                action={createRulesVersionAction}
                promotionId={id}
                clonable={items.map((version) => ({
                  value: version.id,
                  label: t("cloneOption", { version: version.version }),
                }))}
              />
            ) : (
              <EmptyState
                headingLevel="h3"
                title={t("noCreateCapabilityTitle")}
                description={t("noCreateCapabilityBody", { capability: "rules.version.create" })}
              />
            )}
          </div>
        </Card>

        <section aria-labelledby="rules-versions">
          <h2 id="rules-versions" className="lsw-display text-heading-lg text-text">
            {t("listHeading")}
          </h2>

          <div className="mt-s4">
            {!versions.ok ? (
              <AdminSectionError failure={versions.error} headingLevel="h3" />
            ) : items.length === 0 ? (
              <EmptyState headingLevel="h3" title={t("emptyTitle")} description={t("emptyBody")} />
            ) : (
              <ul className="flex list-none flex-col gap-s4">
                {items.map((version) => (
                  <li key={version.id}>
                    <VersionRow version={version} locale={locale} promotionId={id} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </AdminChrome>
  );
}

/**
 * Una version en la lista.
 *
 * LAS CLAVES SIN RESOLVER Y LOS PROBLEMAS DE VALIDACION SE VEN AQUI, no dentro.
 * Quien abre esta pantalla suele venir a responder "por que no puedo activar",
 * y esa respuesta no puede exigir un clic mas.
 */
async function VersionRow({
  version,
  locale,
  promotionId,
}: {
  readonly version: AdminRulesVersion;
  readonly locale: Locale;
  readonly promotionId: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.rules" });
  const statusLabel = await rulesStatusLabeller(locale);
  const keyLabel = await rulesKeyLabeller(locale);

  const unresolved = version.unresolved_required_keys;
  const issues = rulesIssues(version);

  const effectiveAt =
    version.effective_at === null
      ? null
      : formatZonedDateTime(version.effective_at, locale, { timeZone: "UTC" });

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-start justify-between gap-s3">
        <div className="min-w-0">
          <p className="lsw-display text-heading-sm text-text">
            {t("versionLabel", { version: version.version })}
          </p>

          <p className="mt-s1 text-caption text-text-subtle">
            {effectiveAt === null ? t("notEffective") : t("effectiveAt", { instant: effectiveAt })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-s2">
          <Badge tone={version.status === "ACTIVE" ? "success" : "neutral"} size="sm">
            {statusLabel(version.status)}
          </Badge>

          <Link
            href={adminHref(
              locale,
              `/promotions/${encodeURIComponent(promotionId)}/rules/${encodeURIComponent(version.id)}`,
            )}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("openVersion")}
          </Link>
        </div>
      </div>

      {unresolved.length === 0 ? null : (
        <div className="mt-s4">
          <h3 className="text-label font-medium text-text">{t("unresolvedHeading")}</h3>

          <ul className="mt-s2 flex list-none flex-wrap gap-2">
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
        <div className="mt-s4">
          <h3 className="text-label font-medium text-text">{t("issuesHeading")}</h3>

          {/* La ruta y el codigo se pintan EN CRUDO y en monoespaciada: son
              exactamente lo que hay que buscar en la configuracion, y
              traducirlos los haria inencontrables. */}
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
