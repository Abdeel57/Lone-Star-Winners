import { Badge, type BadgeSize } from "@lsw/ui";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import type { AdminProductStatus } from "@/lib/api";

/**
 * Estado de un producto en el panel.
 *
 * Tres estados y tres palabras que NO son el nombre tecnico: "Borrador",
 * "Publicado", "Archivado". Es lo que quien opera necesita saber -si la tienda
 * lo ensena o no-, y el color nunca es la unica senal.
 *
 * Es el UNICO `switch` sobre el estado del producto en la interfaz; el listado
 * y la ficha lo comparten para que no puedan discrepar.
 */
export async function ProductStatusBadge({
  status,
  locale,
  size,
}: {
  readonly status: AdminProductStatus;
  readonly locale: Locale;
  readonly size?: BadgeSize;
}) {
  const t = await getTranslations({ locale, namespace: "admin.catalog" });

  switch (status) {
    case "ACTIVE":
      return (
        <Badge tone="success" {...(size === undefined ? {} : { size })}>
          {t("statusActive")}
        </Badge>
      );
    case "ARCHIVED":
      return (
        <Badge tone="warning" {...(size === undefined ? {} : { size })}>
          {t("statusArchived")}
        </Badge>
      );
    case "DRAFT":
      return (
        <Badge tone="neutral" {...(size === undefined ? {} : { size })}>
          {t("statusDraft")}
        </Badge>
      );
  }
}
