import { Alert, Badge, Card, CardTitle, DataTable, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { AdminPager } from "@/components/admin/admin-pager";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { exportStatusLabeller } from "@/i18n/admin-labels";
import { formatInteger, formatZonedDateTime } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { fetchAdminExportSnapshots, type AdminExportSnapshot } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Exportaciones al administrador independiente (DEC-016, principio #10).
 *
 * QUIEN DECLARA CORRECTO EL CONTENIDO Y QUIEN SE LO LLEVA SON PERSONAS
 * DISTINTAS. `export.finalize` y `export.download` son capacidades separadas a
 * proposito, y la separacion no es teorica: es lo que permite afirmar ante un
 * tercero que el dataset que recibio nadie lo genero y lo aprobo a la vez.
 *
 * ARMAZON. Las cuatro acciones -crear, validar, finalizar y descargar- exigen
 * step-up (DEC-006) y su dominio pertenece a `security-integration`, que
 * todavia no tiene seccion propia en el contrato. Se pintan como lo que son:
 * acciones declaradas y no disponibles, cada una con la capacidad que va a
 * exigir. Un boton que no puede finalizar un snapshot es peor que su ausencia,
 * porque quien lo pulsa cree que lo ha finalizado.
 *
 * LA HUELLA SE ENSENA ENTERA. Un checksum truncado no sirve para lo unico para
 * lo que existe: que un tercero compare lo que recibio con lo que se genero.
 */
export default async function AdminExportsPage({
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
  const t = await getTranslations({ locale, namespace: "admin.exports" });

  const screen = await openAdminScreen({
    locale,
    current: "exports",
    path: "/exports",
    title: t("title"),
    capability: "export.snapshot.read",
  });

  if (!screen.ok) return screen.node;

  const statusLabel = await exportStatusLabeller(locale);

  const result = await fetchAdminExportSnapshots(
    cursor === undefined ? {} : { cursor },
    locale,
    screen.session,
  );

  const actions = [
    { key: "create", allowed: can(screen.actor, "export.snapshot.create") },
    { key: "validate", allowed: can(screen.actor, "export.snapshot.validate") },
    { key: "finalize", allowed: can(screen.actor, "export.finalize") },
    { key: "download", allowed: can(screen.actor, "export.download") },
  ] as const;

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="exports"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <Alert tone="info" title={t("stepUpTitle")}>
            {t("stepUpBody")}
          </Alert>

          <DataTable<AdminExportSnapshot>
            caption={t("tableCaption")}
            scrollRegionLabel={t("tableCaption")}
            rows={result.data.items}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState headingLevel="h2" title={t("emptyTitle")} description={t("emptyBody")} />
            }
            columns={[
              {
                id: "id",
                header: t("columnSnapshot"),
                isRowHeader: true,
                cell: (row) => <span className="font-mono text-caption">{row.id}</span>,
              },
              {
                id: "status",
                header: t("columnStatus"),
                cell: (row) => (
                  <Badge tone={row.status === "FINALIZED" ? "success" : "neutral"} size="sm">
                    {statusLabel(row.status)}
                  </Badge>
                ),
              },
              {
                id: "rows",
                header: t("columnRows"),
                align: "end",
                cell: (row) =>
                  row.row_count === null ? t("notPublished") : formatInteger(row.row_count, locale),
              },
              {
                id: "finalized",
                header: t("columnFinalized"),
                cell: (row) =>
                  row.finalized_at === null
                    ? t("notFinalized")
                    : (formatZonedDateTime(row.finalized_at, locale, { timeZone: "UTC" }) ?? ""),
              },
              {
                id: "checksum",
                header: t("columnChecksum"),
                cell: (row) =>
                  row.checksum === null ? (
                    t("notPublished")
                  ) : (
                    <span className="break-all font-mono text-caption">{row.checksum}</span>
                  ),
              },
            ]}
          />

          <AdminPager
            locale={locale}
            path="/exports"
            nextCursor={result.data.next_cursor}
            hasItems={result.data.items.length > 0}
          />

          <Card elevation="flat" padding="md">
            <CardTitle as="h2" size="sm">
              {t("actionsHeading")}
            </CardTitle>

            <p className="mt-s2 text-body-sm text-text-muted">{t("actionsPending")}</p>

            <ul className="mt-s4 flex list-none flex-wrap gap-2">
              {actions.map((action) => (
                <li key={action.key}>
                  <Badge tone={action.allowed ? "brand" : "neutral"} size="sm" emphasis="subtle">
                    {action.key === "create"
                      ? t("actionCreate")
                      : action.key === "validate"
                        ? t("actionValidate")
                        : action.key === "finalize"
                          ? t("actionFinalize")
                          : t("actionDownload")}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </AdminChrome>
  );
}
