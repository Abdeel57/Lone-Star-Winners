import { Badge, type BadgeSize, type BadgeTone } from "@lsw/ui";

import { usePromotionStatusLabel } from "@/i18n/promotion-labels";
import type { PromotionStatus } from "@/lib/api";

/**
 * Etiqueta de estado de una promocion.
 *
 * El estado lo decide el backend; aqui solo se traduce y se colorea. El color
 * NUNCA es la unica senal: el texto dice lo mismo, para quien no distinga los
 * colores y para quien use un lector de pantalla.
 *
 * Usa `Badge` de `@lsw/ui` en vez de repetir sus clases. La version anterior
 * las copiaba, de modo que un cambio de tono en el sistema de diseno no llegaba
 * hasta aqui.
 *
 * La traduccion la hace `usePromotionStatusLabel`, que es el UNICO `switch`
 * sobre el estado en toda la interfaz. Antes habia dos -aqui y en la linea
 * temporal- y podian discrepar.
 */
export function PromotionStatusBadge({
  status,
  size,
  className,
}: {
  readonly status: PromotionStatus;
  /** Tamano de la insignia. En el hero conviene `sm`, junto al antetitulo. */
  readonly size?: BadgeSize;
  readonly className?: string;
}) {
  const statusLabel = usePromotionStatusLabel();

  return (
    <Badge
      tone={toneFor(status)}
      {...(size === undefined ? {} : { size })}
      {...(className === undefined ? {} : { className })}
    >
      {statusLabel(status)}
    </Badge>
  );
}

/**
 * Tono de cada estado.
 *
 * `switch` exhaustivo: si el contrato anade un estado, esto deja de compilar en
 * vez de pintar una insignia sin color.
 */
function toneFor(status: PromotionStatus): BadgeTone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SCHEDULED":
      return "info";
    case "EXPORT_PREPARATION":
    case "DRAW_PENDING":
    case "POTENTIAL_WINNER_REVIEW":
      return "warning";
    case "CANCELLED":
      return "danger";
    case "DRAFT":
    case "CLOSED":
    case "COMPLETED":
      return "neutral";
  }
}
