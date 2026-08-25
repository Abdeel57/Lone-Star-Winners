import { cn } from "@lsw/ui";
import { useTranslations } from "next-intl";

import type { PromotionStatus } from "@/lib/api";

/**
 * Etiqueta de estado de una promocion.
 *
 * El estado lo decide el backend; aqui solo se traduce y se colorea. El color
 * NUNCA es la unica senal: el texto dice lo mismo, para quien no distinga los
 * colores y para quien use un lector de pantalla.
 */
export function PromotionStatusBadge({
  status,
  className,
}: {
  readonly status: PromotionStatus;
  readonly className?: string;
}) {
  const t = useTranslations("promotionStatus");

  // `switch` exhaustivo en vez de `t(status)`: asi, si el contrato anade un
  // estado nuevo, esto deja de compilar aqui en vez de aparecer como clave
  // ausente en produccion.
  let label: string;
  switch (status) {
    case "upcoming":
      label = t("upcoming");
      break;
    case "active":
      label = t("active");
      break;
    case "ended":
      label = t("ended");
      break;
    case "administrator_processing":
      label = t("administrator_processing");
      break;
    case "winner_verification":
      label = t("winner_verification");
      break;
    case "completed":
      label = t("completed");
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-3 py-1 text-caption font-semibold",
        toneClasses(status),
        className,
      )}
    >
      {label}
    </span>
  );
}

function toneClasses(status: PromotionStatus): string {
  switch (status) {
    case "active":
      return "border-success/30 bg-success-subtle text-success";
    case "upcoming":
      return "border-info/30 bg-info-subtle text-info";
    case "administrator_processing":
    case "winner_verification":
      return "border-warning/40 bg-warning-subtle text-warning";
    case "ended":
    case "completed":
      return "border-border-strong bg-surface-sunken text-text-muted";
  }
}
