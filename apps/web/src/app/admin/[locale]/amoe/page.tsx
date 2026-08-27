import { Alert, buttonVariants, Card, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AmoeDecisionPanel, AmoeSubmissionRow } from "@/components/admin/amoe-review";
import { AdminPager } from "@/components/admin/admin-pager";
import { ApiErrorState } from "@/components/api-error-state";
import { adminHref } from "@/i18n/admin-routing";
import { isLocale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { fetchAdminAmoeSubmissions } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Cola de revision AMOE.
 *
 * POR QUE LA DECISION ES UNA PANTALLA Y NO UN BOTON EN LA FILA
 * ------------------------------------------------------------
 * Aprobar un envio AMOE otorga participaciones que no pasaron por ninguna
 * compra. Un boton en la fila del listado significa decidir sin haber leido lo
 * que la persona envio, y con el raton a un pixel del boton de la fila de al
 * lado. Aqui el listado ENLAZA a la decision -que es una navegacion, no una
 * mutacion- y la decision se toma en un panel que ensena el envio completo,
 * exige motivo y exige confirmacion explicita.
 *
 * Todo el estado viaja en la URL (`?submission=&decision=`), asi que funciona
 * sin JavaScript, se puede compartir el enlace de un envio concreto con quien
 * tenga que revisarlo, y el boton de "atras" del navegador hace lo que se
 * espera.
 *
 * EL FILTRO POR DEFECTO ES `PENDING_REVIEW` y no "todos": una cola de revision
 * que abre con los mil aprobados del mes es una cola que nadie usa.
 */
export default async function AdminAmoePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string; submission?: string; decision?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const { cursor, submission: selectedId, decision } = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.amoeReview" });

  const screen = await openAdminScreen({
    locale,
    current: "amoe",
    path: "/amoe",
    title: t("title"),
    capability: "amoe.review.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminAmoeSubmissions(
    {
      status: "PENDING_REVIEW",
      ...(cursor === undefined ? {} : { cursor }),
    },
    locale,
    screen.session,
  );

  const canApprove = can(screen.actor, "amoe.review.approve");
  const canReject = can(screen.actor, "amoe.review.reject");

  const selected =
    result.ok && selectedId !== undefined
      ? (result.data.items.find((item) => item.id === selectedId) ?? null)
      : null;

  const activeDecision = decision === "reject" ? "reject" : "approve";

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="amoe"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <ApiErrorState failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          {/*
           * Quien solo tiene lectura ve la cola entera y no ve ningun boton de
           * decision. No es una pantalla degradada: `SUPPORT` necesita poder
           * mirar la cola para responder a quien pregunta por su envio, y
           * ensenarle botones que le van a devolver un 403 seria peor.
           */}
          {canApprove || canReject ? null : <Alert tone="info">{t("readOnlyNotice")}</Alert>}

          {selected === null ? null : (
            <AmoeDecisionPanel
              submission={selected}
              locale={locale}
              decision={activeDecision}
              canApprove={canApprove}
              canReject={canReject}
            />
          )}

          {result.data.items.length === 0 ? (
            <EmptyState headingLevel="h2" title={t("emptyTitle")} description={t("emptyBody")} />
          ) : (
            <ul className="flex list-none flex-col gap-s4">
              {result.data.items.map((item) => (
                <li key={item.id}>
                  <div className="flex flex-col gap-s3">
                    <AmoeSubmissionRow
                      submission={item}
                      locale={locale}
                      selected={item.id === selectedId}
                    />

                    <div className="flex flex-wrap gap-s3">
                      {canApprove ? (
                        <Link
                          href={`${adminHref(locale, "/amoe")}?submission=${encodeURIComponent(item.id)}&decision=approve`}
                          className={buttonVariants({ variant: "secondary", size: "sm" })}
                        >
                          {t("reviewApprove")}
                        </Link>
                      ) : null}

                      {canReject ? (
                        <Link
                          href={`${adminHref(locale, "/amoe")}?submission=${encodeURIComponent(item.id)}&decision=reject`}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                        >
                          {t("reviewReject")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <AdminPager
            locale={locale}
            path="/amoe"
            nextCursor={result.data.next_cursor}
            hasItems={result.data.items.length > 0}
          />

          <Card elevation="flat" padding="md">
            <p className="text-caption text-text-subtle">{t("ledgerNote")}</p>
          </Card>
        </div>
      )}
    </AdminChrome>
  );
}
