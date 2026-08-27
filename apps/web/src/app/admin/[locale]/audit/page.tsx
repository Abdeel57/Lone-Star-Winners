import { Badge, DataTable, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { AdminPager } from "@/components/admin/admin-pager";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { reasonLabeller } from "@/i18n/admin-labels";
import { formatZonedDateTime } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { fetchAdminAuditEvents, type AdminAuditEvent } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Traza de auditoria (DEC-007).
 *
 * SOLO LECTURA, Y NO POR CONVENCION. No hay endpoint que edite o borre una fila
 * de auditoria: el rol de base de datos de la aplicacion no tiene el
 * privilegio, y un trigger lanza excepcion aunque lo tuviera. Esta pantalla no
 * ofrece ninguna accion sobre una fila, y si algun dia la ofreciera seria un
 * defecto, no una funcionalidad.
 *
 * SE DISTINGUE `HUMAN` DE `SYSTEM`, y esa es la distincion que un tercero
 * necesita poder hacer: si una reversal la asento un job o una persona no es un
 * detalle de implementacion, es la diferencia entre un proceso automatico y una
 * decision.
 *
 * LA ACCION SE MUESTRA CON SU IDENTIFICADOR DE CAPACIDAD (`entry.adjust.approve`
 * y no "aprobo un ajuste"). Aqui el identificador ES el dato: es lo que se
 * cruza con la matriz de permisos y lo que se cita en una revision. Traducirlo
 * a prosa lo haria mas facil de leer y menos util para lo que existe.
 */
export default async function AdminAuditPage({
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
  const t = await getTranslations({ locale, namespace: "admin.audit" });

  const screen = await openAdminScreen({
    locale,
    current: "audit",
    path: "/audit",
    title: t("title"),
    capability: "audit.read",
  });

  if (!screen.ok) return screen.node;

  const reasonLabel = await reasonLabeller(locale);

  const result = await fetchAdminAuditEvents(
    cursor === undefined ? {} : { cursor },
    locale,
    screen.session,
  );

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="audit"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <DataTable<AdminAuditEvent>
            caption={t("tableCaption")}
            scrollRegionLabel={t("tableCaption")}
            rows={result.data.items}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState headingLevel="h2" title={t("emptyTitle")} description={t("emptyBody")} />
            }
            columns={[
              {
                id: "occurredAt",
                header: t("columnWhen"),
                isRowHeader: true,
                cell: (row) =>
                  formatZonedDateTime(row.occurred_at, locale, { timeZone: "UTC" }) ?? "",
              },
              {
                id: "actor",
                header: t("columnActor"),
                cell: (row) => (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.actor_type === "SYSTEM" ? "neutral" : "brand"} size="sm">
                      {row.actor_type === "SYSTEM" ? t("actorSystem") : t("actorHuman")}
                    </Badge>
                    {/*
                     * SE PINTA `actor_id`, NO `actor_email`.
                     *
                     * `actor_email` llega SIEMPRE `null` (seccion 11.7): la
                     * tabla de auditoria guarda identificadores internos y
                     * "nunca un correo ni un nombre". Pintarlo dejaba una
                     * columna con el mismo texto de relleno en todas las filas,
                     * que ademas sugeria que faltaba un dato.
                     *
                     * El identificador SI sirve: es con lo que se filtra la
                     * traza por actor, y es lo unico que la escritura guardo.
                     */}
                    <span className="font-mono text-caption">{row.actor_id ?? t("noActorId")}</span>
                  </span>
                ),
              },
              {
                id: "action",
                header: t("columnAction"),
                cell: (row) => <span className="font-mono text-caption">{row.action}</span>,
              },
              {
                id: "entity",
                header: t("columnEntity"),
                cell: (row) => (
                  <span className="font-mono text-caption">
                    {row.entity_id === null
                      ? row.entity_type
                      : `${row.entity_type} ${row.entity_id}`}
                  </span>
                ),
              },
              {
                id: "reason",
                header: t("columnReason"),
                cell: (row) =>
                  row.reason_key === null ? t("noReason") : reasonLabel(row.reason_key),
              },
              {
                id: "requestId",
                header: t("columnRequestId"),
                cell: (row) => (
                  <span className="font-mono text-caption">
                    {row.request_id ?? t("noRequestId")}
                  </span>
                ),
              },
            ]}
          />

          <AdminPager
            locale={locale}
            path="/audit"
            nextCursor={result.data.next_cursor}
            hasItems={result.data.items.length > 0}
          />
        </div>
      )}
    </AdminChrome>
  );
}
