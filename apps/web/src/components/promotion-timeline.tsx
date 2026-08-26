import { Timeline, TimelineItem } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { usePromotionStatusLabel } from "@/i18n/promotion-labels";
import type { PromotionStatus } from "@/lib/api";
import { promotionTimeline } from "@/lib/promotion-state";

/**
 * Ciclo de vida de la promocion, con el paso actual marcado.
 *
 * Se muestran SIEMPRE los seis pasos, incluidos los que aun no han ocurrido.
 * Enseñar solo los pasados dejaria al participante sin saber que falta, y es
 * justo lo que hace que la fase de sorteo se perciba como un silencio en vez de
 * como un procedimiento con etapas.
 *
 * Ningun paso lleva fecha. Las fechas de sorteo y de verificacion son materia
 * de las Reglas Oficiales y hoy no estan aprobadas (`docs/LEGAL_PENDING.md`);
 * poner una aqui seria inventarsela.
 */
export function PromotionTimeline({ status }: { readonly status: PromotionStatus }) {
  const t = useTranslations("a11y");
  const statusLabel = usePromotionStatusLabel();
  const steps = promotionTimeline(status);

  return (
    <div aria-label={t("promotionTimeline")} role="group">
      <Timeline>
        {steps.map((step, index) => (
          <TimelineItem
            key={step.status}
            title={statusLabel(step.status)}
            status={step.state}
            isLast={index === steps.length - 1}
          />
        ))}
      </Timeline>
    </div>
  );
}
