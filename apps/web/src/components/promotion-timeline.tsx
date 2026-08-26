import { Timeline, TimelineItem } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { usePromotionStatusLabel } from "@/i18n/promotion-labels";
import type { PromotionStatus } from "@/lib/api";
import { promotionTimeline } from "@/lib/promotion-state";

/**
 * Ciclo de vida de la promocion, con el paso actual marcado.
 *
 * Se muestran SIEMPRE todos los pasos del recorrido normal, incluidos los que
 * aun no han ocurrido. Enseñar solo los pasados dejaria al participante sin
 * saber que falta, y es justo lo que hace que la fase de sorteo se perciba como
 * un silencio en vez de como un procedimiento con etapas.
 *
 * `DRAFT` y `CANCELLED` no son pasos del recorrido: `promotionTimeline` los
 * devuelve como lista vacia y aqui no se pinta nada. Una promocion cancelada
 * con una linea temporal a medio recorrer diria que sigue en marcha.
 *
 * Ningun paso lleva fecha. Las fechas de sorteo y de verificacion son materia
 * de las Reglas Oficiales y hoy no estan aprobadas (`docs/LEGAL_PENDING.md`);
 * poner una aqui seria inventarsela.
 */
export function PromotionTimeline({ status }: { readonly status: PromotionStatus }) {
  const t = useTranslations("a11y");
  const statusLabel = usePromotionStatusLabel();
  const steps = promotionTimeline(status);

  if (steps.length === 0) return null;

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
