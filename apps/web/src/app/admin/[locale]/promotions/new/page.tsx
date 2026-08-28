import { buttonVariants, Card } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { PromotionForm } from "@/components/admin/promotion-form";
import { adminHref } from "@/i18n/admin-routing";
import { isLocale } from "@/i18n/locales";
import { createPromotionAction } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";

/**
 * Alta de una promocion.
 *
 * Nace en DRAFT y no puede activarse todavia: le faltan el periodo -que se fija
 * aqui o despues- y una version de reglas (DEC-012), que hoy no tiene pantalla.
 * La descripcion lo dice de entrada para que nadie cree una promocion creyendo
 * que el siguiente paso es activarla.
 */
export default async function AdminNewPromotionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.promotions" });

  const screen = await openAdminScreen({
    locale,
    current: "promotions",
    path: "/promotions/new",
    title: t("newTitle"),
    capability: "promotion.create",
  });

  if (!screen.ok) return screen.node;

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="promotions"
      title={t("newTitle")}
      description={t("newBody")}
      actions={
        <Link
          href={adminHref(locale, "/promotions")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("backToList")}
        </Link>
      }
    >
      <Card elevation="raised" padding="lg">
        <PromotionForm locale={locale} action={createPromotionAction} />
      </Card>
    </AdminChrome>
  );
}
