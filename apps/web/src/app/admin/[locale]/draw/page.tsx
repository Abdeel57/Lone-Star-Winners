import { Alert, Badge, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { AdminPager } from "@/components/admin/admin-pager";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { drawBlockerLabeller, drawStatusLabeller } from "@/i18n/admin-labels";
import { formatZonedDateTime } from "@/i18n/formatters";
import { isLocale, type Locale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { fetchAdminDrawAuthorizations, type AdminDrawAuthorization } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Sorteo: autorizaciones y su segunda aprobacion (DEC-017, principio #11).
 *
 * LA REGLA QUE GOBIERNA ESTA PANTALLA ENTERA
 * ------------------------------------------
 * Un sistema interno de random drawing NO se activa sin autorizacion
 * documentada. `internal_draw_enabled` arranca apagado (DEC-032) y DEC-017
 * exige cinco condiciones antes de que nadie pueda iniciar nada. Esta pantalla
 * NO inicia ningun sorteo: ensena quien autorizo, quien aprobo despues, y que
 * condiciones siguen sin cumplirse.
 *
 * LA SEGUNDA APROBACION TIENE QUE SER DE OTRO ACTOR, Y SE VE
 * ----------------------------------------------------------
 * `approvals` es una LISTA con nombre y momento, no un contador. Un "2 de 2" no
 * dice si son dos personas, que es exactamente lo que hay que poder comprobar.
 * `COMPLIANCE_OFFICER` autoriza y `DRAW_OFFICER` inicia: nunca la misma
 * persona, y esa separacion tiene que ser legible aqui sin abrir la auditoria.
 *
 * LAS CONDICIONES QUE FALTAN SE LISTAN, igual que las claves de reglas de
 * DEC-012. Un boton gris sin explicacion invita al atajo; una lista de lo que
 * falta invita a completarlo.
 */
export default async function AdminDrawPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const { cursor } = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.draw" });

  const screen = await openAdminScreen({
    locale,
    current: "draw",
    path: "/draw",
    title: t("title"),
    capability: "draw.result.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminDrawAuthorizations(
    cursor === undefined ? {} : { cursor },
    locale,
    screen.session,
  );

  const canAuthorize = can(screen.actor, "draw.authorization.create");
  const canInitiate = can(screen.actor, "draw.initiate");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="draw"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <Alert tone="warning" title={t("gateTitle")}>
            {t("gateBody")}
          </Alert>

          {/*
           * Separacion de funciones, dicha en pantalla. Que un mismo actor no
           * pueda autorizar e iniciar no es una politica que la interfaz
           * aplique -la aplica `packages/security`- pero verlo aqui es lo que
           * hace que se note si algun dia dejara de cumplirse.
           */}
          {canAuthorize && canInitiate ? (
            <Alert tone="danger" title={t("separationBreachTitle")}>
              {t("separationBreachBody")}
            </Alert>
          ) : null}

          {result.data.items.length === 0 ? (
            <EmptyState headingLevel="h2" title={t("emptyTitle")} description={t("emptyBody")} />
          ) : (
            <ul className="flex list-none flex-col gap-s4">
              {result.data.items.map((authorization) => (
                <li key={authorization.id}>
                  <DrawAuthorizationCard authorization={authorization} locale={locale} />
                </li>
              ))}
            </ul>
          )}

          <AdminPager
            locale={locale}
            path="/draw"
            nextCursor={result.data.next_cursor}
            hasItems={result.data.items.length > 0}
          />

          <Card elevation="flat" padding="md">
            <CardTitle as="h2" size="sm">
              {t("actionsHeading")}
            </CardTitle>
            <p className="mt-s2 text-body-sm text-text-muted">{t("actionsPending")}</p>
          </Card>
        </div>
      )}
    </AdminChrome>
  );
}

async function DrawAuthorizationCard({
  authorization,
  locale,
}: {
  readonly authorization: AdminDrawAuthorization;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "admin.draw" });
  const statusLabel = await drawStatusLabeller(locale);
  const blockerLabel = await drawBlockerLabeller(locale);

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <p className="font-mono text-caption text-text-muted">{authorization.id}</p>

        <Badge tone={authorization.status === "AUTHORIZED" ? "success" : "warning"} size="sm">
          {statusLabel(authorization.status)}
        </Badge>
      </div>

      <p className="mt-s3 text-body-sm text-text">
        {t("createdBy", { actor: authorization.created_by_actor_email })}
      </p>

      <div className="mt-s4">
        <h3 className="text-label font-medium text-text">
          {t("approvalsHeading", {
            given: authorization.approvals.length,
            required: authorization.required_approvals,
          })}
        </h3>

        {authorization.approvals.length === 0 ? (
          <p className="mt-s2 text-body-sm text-text-muted">{t("noApprovals")}</p>
        ) : (
          <ul className="mt-s2 flex list-none flex-col gap-s1">
            {authorization.approvals.map((approval) => (
              <li key={approval.actor_id} className="text-body-sm text-text-muted">
                {t("approvalBy", {
                  actor: approval.actor_email,
                  instant:
                    formatZonedDateTime(approval.approved_at, locale, { timeZone: "UTC" }) ?? "",
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      {authorization.blocking_conditions.length === 0 ? null : (
        <div className="mt-s4">
          <h3 className="text-label font-medium text-text">{t("blockersHeading")}</h3>

          <ul className="mt-s2 flex list-none flex-wrap gap-2">
            {authorization.blocking_conditions.map((condition) => (
              <li key={condition}>
                <Badge tone="warning" size="sm" emphasis="subtle">
                  {blockerLabel(condition)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
