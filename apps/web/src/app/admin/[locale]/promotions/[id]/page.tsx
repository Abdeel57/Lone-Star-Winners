import { Alert, Badge, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { ApiErrorState } from "@/components/api-error-state";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";
import { adminHref } from "@/i18n/admin-routing";
import { rulesKeyLabeller, rulesStatusLabeller } from "@/i18n/admin-labels";
import { formatZonedDateTime } from "@/i18n/formatters";
import { isLocale, type Locale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import {
  fetchAdminPromotion,
  fetchAdminRulesVersions,
  pickLocalized,
  type AdminRulesVersion,
} from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Detalle de promocion, con sus versiones de reglas.
 *
 * AQUI VIVE EL VALIDADOR DE ACTIVACION DE DEC-012, y es la razon de que esta
 * pantalla exista. DEC-012 dice que una promocion no transiciona a `ACTIVE`
 * mientras quede una clave requerida en estado provisional o `TBD`, y que el
 * validador "devuelve la lista de claves faltantes".
 *
 * ESA LISTA SE PINTA, CLAVE POR CLAVE. Es la diferencia entre un boton gris que
 * no explica nada y una pantalla que dice exactamente que le falta al abogado
 * por cerrar. Sin ella, la respuesta a "por que no puedo activar" seria mirar
 * logs, y el atajo evidente -"activo igual y ya lo arreglamos"- es justo el que
 * DEC-012 existe para bloquear.
 *
 * EL CERROJO NO ES DE ESTA PANTALLA. `activatable` lo decide el backend y no se
 * deduce de que la lista este vacia: puede haber mas condiciones que las
 * claves. Deducirlo aqui seria reimplementar el cerrojo en el frontend, que es
 * exactamente lo que DEC-012 quiere que viva en un solo sitio.
 */
export default async function AdminPromotionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.promotions" });

  const screen = await openAdminScreen({
    locale,
    current: "promotions",
    path: "/promotions",
    title: t("detailTitle"),
    capability: "promotion.read",
  });

  if (!screen.ok) return screen.node;

  const canReadRules = can(screen.actor, "rules.version.read");

  const [promotion, rulesVersions] = await Promise.all([
    fetchAdminPromotion(id, locale, screen.session),
    canReadRules ? fetchAdminRulesVersions(id, {}, locale, screen.session) : Promise.resolve(null),
  ]);

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="promotions"
      title={promotion.ok ? pickLocalized(promotion.data.title, locale) : t("detailTitle")}
      actions={
        <Link
          href={adminHref(locale, "/promotions")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("backToList")}
        </Link>
      }
    >
      {!promotion.ok ? (
        <ApiErrorState failure={promotion.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s8">
          <Card elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("overviewHeading")}
            </CardTitle>

            <dl className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("columnStatus")}
                </dt>
                <dd className="mt-s1">
                  <PromotionStatusBadge status={promotion.data.status} size="sm" />
                </dd>
              </div>

              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("slugLabel")}
                </dt>
                <dd className="font-mono text-body-sm text-text">{promotion.data.slug}</dd>
              </div>

              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("opensLabel")}
                </dt>
                <dd className="text-body-sm text-text">
                  {formatZonedDateTime(promotion.data.starts_at, locale, {
                    timeZone: promotion.data.legal_timezone,
                    showTimeZoneName: true,
                  }) ?? ""}
                </dd>
              </div>

              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("closesLabel")}
                </dt>
                <dd className="text-body-sm text-text">
                  {formatZonedDateTime(promotion.data.ends_at, locale, {
                    timeZone: promotion.data.legal_timezone,
                    showTimeZoneName: true,
                  }) ?? ""}
                </dd>
              </div>
            </dl>

            {/*
             * Sin version de reglas publicada, el escaparate NO pinta el hero
             * completo de esta promocion (DEC-044). Se dice aqui porque el
             * sintoma se ve en la tienda y la causa esta en esta pantalla.
             */}
            {promotion.data.rules_version_id === null ? (
              <Alert tone="warning" className="mt-s5">
                {t("noRulesConsequence")}
              </Alert>
            ) : null}
          </Card>

          <section aria-labelledby="promotion-rules">
            <h2 id="promotion-rules" className="lsw-display text-heading-lg text-text">
              {t("rulesHeading")}
            </h2>

            <div className="mt-s4">
              {rulesVersions === null ? (
                <EmptyState
                  headingLevel="h3"
                  title={t("rulesNoCapabilityTitle")}
                  description={t("rulesNoCapabilityBody")}
                />
              ) : !rulesVersions.ok ? (
                <ApiErrorState failure={rulesVersions.error} headingLevel="h3" />
              ) : rulesVersions.data.items.length === 0 ? (
                <EmptyState
                  headingLevel="h3"
                  title={t("rulesEmptyTitle")}
                  description={t("rulesEmptyBody")}
                />
              ) : (
                <ul className="flex list-none flex-col gap-s4">
                  {rulesVersions.data.items.map((version) => (
                    <li key={version.id}>
                      <RulesVersionCard version={version} locale={locale} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </AdminChrome>
  );
}

/**
 * Una version de reglas y su veredicto de activacion.
 *
 * Las claves faltantes se listan con su etiqueta traducida cuando la interfaz
 * la conoce y con su IDENTIFICADOR TECNICO cuando no. Aqui el identificador
 * ayuda: es lo que se busca en `docs/LEGAL_PENDING.md` y lo que se le pregunta
 * al abogado.
 */
async function RulesVersionCard({
  version,
  locale,
}: {
  readonly version: AdminRulesVersion;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.promotions" });
  const statusLabel = await rulesStatusLabeller(locale);
  const keyLabel = await rulesKeyLabeller(locale);

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <p className="text-body-md text-text">{t("rulesVersion", { version: version.version })}</p>

        <div className="flex items-center gap-s3">
          <Badge tone={version.status === "ACTIVE" ? "success" : "neutral"} size="sm">
            {statusLabel(version.status)}
          </Badge>

          <Badge tone={version.activatable ? "success" : "warning"} size="sm">
            {version.activatable ? t("activatable") : t("notActivatable")}
          </Badge>
        </div>
      </div>

      <p className="mt-s2 text-caption text-text-subtle">
        {t("createdAt", {
          instant: formatZonedDateTime(version.created_at, locale, { timeZone: "UTC" }) ?? "",
        })}
      </p>

      {version.missing_keys.length === 0 ? null : (
        <div className="mt-s4">
          <h3 className="text-label font-medium text-text">{t("missingKeysHeading")}</h3>

          <p className="mt-s1 text-caption text-text-subtle">{t("missingKeysBody")}</p>

          <ul className="mt-s3 flex list-none flex-wrap gap-2">
            {version.missing_keys.map((key) => (
              <li key={key}>
                <Badge tone="warning" size="sm" emphasis="subtle">
                  {keyLabel(key)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
