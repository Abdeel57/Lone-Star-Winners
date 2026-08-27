import { Alert, buttonVariants } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MfaRequired, SignInRequired } from "@/components/account-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/locales";
import { fetchCheckoutSession, type CheckoutSessionStatus } from "@/lib/api";
import { loadParticipant } from "@/lib/participant-server";

export const dynamic = "force-dynamic";

/**
 * Vuelta del proveedor de pago.
 *
 * ESTA PAGINA NO SE CREE LA URL POR LA QUE HA LLEGADO
 * ---------------------------------------------------
 * El proveedor devuelve el navegador con unos parametros, y de todos ellos esta
 * pagina usa UNO: el identificador del borrador. El resultado del pago -pagado,
 * cancelado, fallido- NO se lee de la URL bajo ningun concepto: se le pregunta
 * al backend, que es quien ha recibido -o no- el webhook firmado.
 *
 * La razon es sencilla de enunciar y cara de olvidar: `?outcome=paid` lo
 * escribe cualquiera en la barra de direcciones. Una pagina de exito que se cree
 * su propia URL es una pagina de exito gratis.
 *
 * Y AUNQUE EL BACKEND DIGA "PAGADO", LAS PARTICIPACIONES NO SE DAN POR HECHAS.
 * Las genera el backend al procesar la confirmacion de pago, no cuando el
 * navegador llega aqui. Por eso el destino natural de un pago confirmado es la
 * pagina de confirmacion del PEDIDO, que pinta el estado real de sus
 * participaciones, y no un cartel de enhorabuena escrito en esta.
 */
export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("checkout.return");
  const { session, state } = await loadParticipant(locale);

  if (state.kind === "anonymous") {
    return (
      <ReturnShell title={t("title")}>
        <SignInRequired returnPath="/account/orders" />
      </ReturnShell>
    );
  }

  if (state.kind === "mfaPending") {
    return (
      <ReturnShell title={t("title")}>
        <MfaRequired returnPath="/account/orders" />
      </ReturnShell>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <ReturnShell title={t("title")}>
        <ApiErrorState failure={state.failure} headingLevel="h2" />
      </ReturnShell>
    );
  }

  const query = await searchParams;
  const draftId = typeof query.draft === "string" && query.draft.length > 0 ? query.draft : null;

  if (draftId === null) {
    return (
      <ReturnShell title={t("title")}>
        <Alert tone="warning" title={t("missingTitle")}>
          {t("missingBody")}
        </Alert>

        <Actions locale={locale} status="FAILED" orderId={null} />
      </ReturnShell>
    );
  }

  const result = await fetchCheckoutSession(draftId, locale, session);

  if (!result.ok) {
    return (
      <ReturnShell title={t("title")}>
        <ApiErrorState failure={result.error} headingLevel="h2" />
        <Actions locale={locale} status="FAILED" orderId={null} />
      </ReturnShell>
    );
  }

  const { status, order_id: orderId } = result.data;

  /*
   * Con pedido ya creado, no hay nada que contar aqui: la pagina de
   * confirmacion del pedido dice mas y mejor -que se pidio, en que estado esta,
   * y donde estan sus participaciones- y ademas es una URL que se puede volver
   * a abrir. Esta pantalla es un transito.
   */
  if (status === "COMPLETED" && orderId !== null) {
    redirect({ href: `/orders/${encodeURIComponent(orderId)}/confirmation`, locale });
  }

  return (
    <ReturnShell title={t("title")}>
      <Alert tone={toneFor(status)} title={titleFor(status, t)}>
        {bodyFor(status, t)}
      </Alert>

      <Actions locale={locale} status={status} orderId={orderId} />
    </ReturnShell>
  );
}

/**
 * Tono del aviso.
 *
 * `PENDING` es `info` y no `warning`: esperar la confirmacion del proveedor es
 * lo normal, no un problema. `CANCELLED` tampoco es `danger` -nadie ha perdido
 * nada, y el texto lo dice- y solo `FAILED` merece el tono de fallo.
 */
function toneFor(status: CheckoutSessionStatus): "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "PENDING":
      return "info";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "warning";
    case "FAILED":
      return "danger";
  }
}

type ReturnTranslator = Awaited<ReturnType<typeof getTranslations<"checkout.return">>>;

function titleFor(status: CheckoutSessionStatus, t: ReturnTranslator): string {
  switch (status) {
    case "PENDING":
      return t("pendingTitle");
    case "COMPLETED":
      return t("completedTitle");
    case "CANCELLED":
      return t("cancelledTitle");
    case "FAILED":
      return t("failedTitle");
  }
}

function bodyFor(status: CheckoutSessionStatus, t: ReturnTranslator): string {
  switch (status) {
    case "PENDING":
      return t("pendingBody");
    case "COMPLETED":
      return t("completedBody");
    case "CANCELLED":
      return t("cancelledBody");
    case "FAILED":
      return t("failedBody");
  }
}

/**
 * Que se puede hacer desde aqui.
 *
 * Con el pago confirmado pero sin pedido todavia -que es un estado real y
 * corto- se enlaza al listado de pedidos y no a un identificador que aun no
 * existe: mandar a alguien a un 404 justo despues de pagarle es la peor forma
 * posible de terminar este recorrido.
 */
async function Actions({
  locale,
  status,
  orderId,
}: {
  readonly locale: Locale;
  readonly status: CheckoutSessionStatus;
  readonly orderId: string | null;
}) {
  const t = await getTranslations({ locale, namespace: "checkout.return" });

  return (
    <div className="mt-s6 flex flex-wrap items-center gap-3">
      {status === "COMPLETED" ? (
        <Link
          href={orderId === null ? "/account/orders" : `/account/orders/${orderId}`}
          className={buttonVariants({ variant: "accent" })}
        >
          {orderId === null ? t("viewOrders") : t("viewOrder")}
        </Link>
      ) : (
        <Link href="/cart" className={buttonVariants({ variant: "accent" })}>
          {t("retry")}
        </Link>
      )}

      <Link href="/account/orders" className={buttonVariants({ variant: "secondary" })}>
        {t("viewOrders")}
      </Link>
    </div>
  );
}

function ReturnShell({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="lsw-container py-s10 pb-s16">
      <div className="mx-auto w-full max-w-[36rem]">
        <h1 className="lsw-display text-display-sm text-text">{title}</h1>
        <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

        <div className="mt-s8">{children}</div>
      </div>
    </div>
  );
}
