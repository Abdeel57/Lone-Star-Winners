import { Alert, Badge, buttonVariants, Card, CardTitle, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { BonusPeriodForm } from "@/components/admin/bonus-period-form";
import { PromotionForm } from "@/components/admin/promotion-form";
import {
  PromotionTransitionForm,
  type PromotionTransition,
} from "@/components/admin/promotion-transition-form";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";
import { adminHref } from "@/i18n/admin-routing";
import { reasonLabeller, rulesKeyLabeller, rulesStatusLabeller } from "@/i18n/admin-labels";
import { formatZonedDateTime } from "@/i18n/formatters";
import { isLocale, type Locale } from "@/i18n/locales";
import { type ActionResult } from "@/lib/action-result";
import {
  activatePromotionAction,
  closePromotionAction,
  createBonusPeriodAction,
  schedulePromotionAction,
  updatePromotionAction,
} from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { isoToZonedWallTime } from "@/lib/admin/catalog-input";
import {
  BONUS_PERIOD_REASONS,
  PROMOTION_ACTIVATE_REASONS,
  PROMOTION_CLOSE_REASONS,
} from "@/lib/admin/reason-codes";
import {
  fetchAdminPromotion,
  fetchAdminRulesVersions,
  pickLocalized,
  type AdminCapability,
  type AdminPromotionRow,
  type AdminRulesVersion,
} from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Ficha de una promocion: resumen, estado, datos y versiones de reglas.
 *
 * EL BLOQUE DE ESTADO ES EL CORAZON DE LA PANTALLA. Ofrece UNA transicion, la
 * que corresponde al estado actual -programar, activar o cerrar-, y dice
 * ANTES del boton lo que la pantalla ya sabe que falta: el periodo para
 * programar, la version de reglas para activar. Es la version en pantalla de
 * lo que DEC-012 pide del validador: que la respuesta a "por que no puedo
 * activar" no sea mirar logs.
 *
 * EL CERROJO NO ES DE ESTA PANTALLA. Lo que aqui se desactiva es un boton; el
 * control es el trigger de PostgreSQL, que ademas conoce condiciones que esta
 * pantalla no ve. Cuando responde 409, su mensaje se ensena tal cual.
 *
 * Las fechas se formatean contra la ZONA LEGAL de la promocion (DEC-011), y el
 * formulario de edicion las recibe ya convertidas a hora de pared de esa zona.
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
  const tBonus = await getTranslations({ locale, namespace: "admin.bonus" });
  const bonusReasonLabel = await reasonLabeller(locale);

  const screen = await openAdminScreen({
    locale,
    current: "promotions",
    path: `/promotions/${id}`,
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
      title={promotion.ok ? pickLocalized(promotion.data.public_name, locale) : t("detailTitle")}
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
        <AdminSectionError failure={promotion.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <Card elevation="raised" padding="lg">
            <div className="flex flex-wrap items-center justify-between gap-s3">
              <CardTitle as="h2" size="sm">
                {t("overviewHeading")}
              </CardTitle>
              <PromotionStatusBadge status={promotion.data.status} />
            </div>

            <dl className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <Field label={t("internalNameLabel")} value={promotion.data.internal_name} />
              <Field label={t("slugLabel")} value={promotion.data.slug} mono />
              <Field label={t("timezoneLabel")} value={promotion.data.legal_timezone} mono />
              <Field
                label={t("columnRules")}
                value={
                  promotion.data.active_rules_version_id === null ? (
                    <Badge tone="warning" size="sm">
                      {t("noRulesVersion")}
                    </Badge>
                  ) : (
                    <Badge tone="brand" size="sm">
                      {t("rulesVersionActive")}
                    </Badge>
                  )
                }
              />
              <Field
                label={t("opensLabel")}
                value={
                  promotion.data.starts_at === null
                    ? t("windowNotSet")
                    : (formatZonedDateTime(promotion.data.starts_at, locale, {
                        timeZone: promotion.data.legal_timezone,
                        showTimeZoneName: true,
                      }) ?? t("windowNotSet"))
                }
              />
              <Field
                label={t("closesLabel")}
                value={
                  promotion.data.ends_at === null
                    ? t("windowNotSet")
                    : (formatZonedDateTime(promotion.data.ends_at, locale, {
                        timeZone: promotion.data.legal_timezone,
                        showTimeZoneName: true,
                      }) ?? t("windowNotSet"))
                }
              />
            </dl>

            {promotion.data.active_rules_version_id === null ? (
              <Alert tone="warning" className="mt-s5">
                {t("noRulesConsequence")}
              </Alert>
            ) : null}
          </Card>

          <Card elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("stateHeading")}
            </CardTitle>
            <div className="mt-s4">
              <TransitionBlock
                locale={locale}
                promotion={promotion.data}
                canUpdate={can(screen.actor, "promotion.update")}
                canActivate={can(screen.actor, "promotion.activate")}
                canClose={can(screen.actor, "promotion.close")}
              />
            </div>
          </Card>

          <Card elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("dataHeading")}
            </CardTitle>
            <div className="mt-s4">
              {can(screen.actor, "promotion.update") ? (
                <PromotionForm
                  locale={locale}
                  action={updatePromotionAction}
                  promotion={{
                    id: promotion.data.id,
                    slug: promotion.data.slug,
                    internalName: promotion.data.internal_name,
                    legalTimezone: promotion.data.legal_timezone,
                    publicName: promotion.data.public_name,
                    startsAtWall:
                      promotion.data.starts_at === null
                        ? null
                        : isoToZonedWallTime(
                            promotion.data.starts_at,
                            promotion.data.legal_timezone,
                          ),
                    endsAtWall:
                      promotion.data.ends_at === null
                        ? null
                        : isoToZonedWallTime(promotion.data.ends_at, promotion.data.legal_timezone),
                  }}
                />
              ) : (
                <Alert tone="info">{t("noUpdateCapability")}</Alert>
              )}
            </div>
          </Card>

          {/*
           * ATAJO BONUS (§13.8, DEC-054 punto 2).
           *
           * Vive en la ficha de la promocion y no en la pantalla de Reglas
           * porque es el gesto operativo -"pon un 5X doce horas"- y no una
           * redaccion legal. Lo que hace por debajo SI es publicar una version
           * de reglas nueva, y el propio formulario lo dice.
           *
           * Exige `rules.version.activate`, la misma capacidad que activar una
           * version: sin ella no se pinta el formulario, se dice cual falta.
           * Ocultarlo entero haria pensar que la funcion no existe.
           */}
          <Card elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {tBonus("heading")}
            </CardTitle>

            <div className="mt-s4">
              {promotion.data.active_rules_version_id === null ? (
                <Alert tone="warning">{tBonus("needsActiveVersion")}</Alert>
              ) : can(screen.actor, "rules.version.activate") ? (
                <BonusPeriodForm
                  locale={locale}
                  action={createBonusPeriodAction}
                  promotionId={promotion.data.id}
                  reasons={BONUS_PERIOD_REASONS.map((value) => ({
                    value,
                    label: bonusReasonLabel(value),
                  }))}
                />
              ) : (
                <Alert tone="info">
                  {t("transitionNoCapability", { capability: "rules.version.activate" })}
                </Alert>
              )}
            </div>
          </Card>

          <section aria-labelledby="promotion-rules">
            <div className="flex flex-wrap items-center justify-between gap-s3">
              <h2 id="promotion-rules" className="lsw-display text-heading-lg text-text">
                {t("rulesHeading")}
              </h2>

              {/* La pantalla completa de Reglas exige `rules.version.read`; el
                  enlace solo se pinta con ella, por la misma cortesia que el
                  resto del menu: no mandar a nadie a una puerta cerrada. */}
              {canReadRules ? (
                <Link
                  href={adminHref(locale, `/promotions/${encodeURIComponent(id)}/rules`)}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  {t("rulesManageCta")}
                </Link>
              ) : null}
            </div>

            <div className="mt-s4">
              {rulesVersions === null ? (
                <EmptyState
                  headingLevel="h3"
                  title={t("rulesNoCapabilityTitle")}
                  description={t("rulesNoCapabilityBody")}
                />
              ) : !rulesVersions.ok ? (
                <AdminSectionError failure={rulesVersions.error} headingLevel="h3" />
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

function Field({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption uppercase tracking-wide text-text-subtle">{label}</dt>
      <dd
        className={`mt-s1 break-words text-body-sm text-text${mono === true ? " font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * La transicion que corresponde al estado actual, o el motivo de que no haya.
 *
 * Programar exige `promotion.update`; activar, `promotion.activate`; cerrar,
 * `promotion.close`. Sin la capacidad se dice CUAL falta, con su nombre
 * tecnico: es lo que hay que citar al pedirla.
 */
async function TransitionBlock({
  locale,
  promotion,
  canUpdate,
  canActivate,
  canClose,
}: {
  readonly locale: Locale;
  readonly promotion: AdminPromotionRow;
  readonly canUpdate: boolean;
  readonly canActivate: boolean;
  readonly canClose: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "admin.promotions" });
  const label = await reasonLabeller(locale);

  const plan = transitionFor(promotion.status);
  if (plan === null) {
    return <p className="text-body-sm text-text-muted">{t("noTransition")}</p>;
  }

  const allowed =
    plan.transition === "schedule"
      ? canUpdate
      : plan.transition === "activate"
        ? canActivate
        : canClose;

  if (!allowed) {
    return (
      <Alert tone="info">{t("transitionNoCapability", { capability: plan.capability })}</Alert>
    );
  }

  const hasWindow = promotion.starts_at !== null && promotion.ends_at !== null;
  const hasRules = promotion.active_rules_version_id !== null;

  const blockedReason =
    plan.transition === "schedule" && !hasWindow
      ? t("needsWindow")
      : plan.transition === "activate" && !hasRules
        ? t("needsRulesVersion")
        : undefined;

  const reasons =
    plan.transition === "activate"
      ? PROMOTION_ACTIVATE_REASONS
      : plan.transition === "close"
        ? PROMOTION_CLOSE_REASONS
        : [];

  return (
    <PromotionTransitionForm
      locale={locale}
      action={plan.action}
      promotionId={promotion.id}
      transition={plan.transition}
      {...(blockedReason === undefined ? {} : { blockedReason })}
      reasons={reasons.map((value) => ({ value, label: label(value) }))}
    />
  );
}

/**
 * Que transicion ofrece cada estado. Espejo de las filas de
 * `promotion_status_transitions` que esta pantalla expone; el resto del ciclo
 * (exportacion, sorteo, ganador) tiene sus propias pantallas.
 */
function transitionFor(status: AdminPromotionRow["status"]): {
  readonly transition: PromotionTransition;
  readonly capability: AdminCapability;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
} | null {
  switch (status) {
    case "DRAFT":
      return {
        transition: "schedule",
        capability: "promotion.update",
        action: schedulePromotionAction,
      };
    case "SCHEDULED":
      return {
        transition: "activate",
        capability: "promotion.activate",
        action: activatePromotionAction,
      };
    case "ACTIVE":
      return { transition: "close", capability: "promotion.close", action: closePromotionAction };
    default:
      return null;
  }
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

  const unresolvedKeys = version.unresolved_required_keys;

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <p className="text-body-md text-text">{t("rulesVersion", { version: version.version })}</p>

        <div className="flex items-center gap-s3">
          <Badge tone={version.status === "ACTIVE" ? "success" : "neutral"} size="sm">
            {statusLabel(version.status)}
          </Badge>

          {/* `activatable` lo calcula el BACKEND (§13.7). No se deriva de que
              la lista de claves este vacia, y no es el control: quien impide
              activar es el trigger de DEC-012. */}
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

      {unresolvedKeys.length === 0 ? null : (
        <div className="mt-s4">
          <h3 className="text-label font-medium text-text">{t("missingKeysHeading")}</h3>

          <p className="mt-s1 text-caption text-text-subtle">{t("missingKeysBody")}</p>

          <ul className="mt-s3 flex list-none flex-wrap gap-2">
            {unresolvedKeys.map((key) => (
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
