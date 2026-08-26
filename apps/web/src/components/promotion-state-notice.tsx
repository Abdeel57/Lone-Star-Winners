import { Alert } from "@lsw/ui";

import { usePromotionNoticeText } from "@/i18n/promotion-labels";
import type { PromotionPresentation } from "@/lib/promotion-state";

/**
 * Aviso que explica en que fase esta la promocion.
 *
 * Es el componente que da sentido a los seis estados. Sin el, la interfaz solo
 * podria decir "abierta" o "cerrada", y el tramo mas largo y mas confuso de una
 * promocion -desde que cierra hasta que hay ganador confirmado- se veria como
 * un silencio.
 *
 * El texto NO afirma nada legal: no dice quien gana, ni cuando se sortea, ni
 * con que criterio. Dice en que paso del procedimiento se esta y remite a las
 * Reglas Oficiales, que son las que lo definen (CLAUDE.md #1 y #2).
 */
export function PromotionStateNotice({
  presentation,
  className,
}: {
  readonly presentation: PromotionPresentation;
  readonly className?: string;
}) {
  const noticeText = usePromotionNoticeText();
  const { title, body } = noticeText(presentation.noticeKey);

  // El tono `neutral` de la maquina de estados no existe en `Alert`: una
  // promocion cerrada o terminada no es un aviso de peligro ni una felicitacion,
  // asi que se pinta como informacion.
  const tone = presentation.noticeTone === "neutral" ? "info" : presentation.noticeTone;

  return (
    <Alert tone={tone} title={title} {...(className === undefined ? {} : { className })}>
      {body}
    </Alert>
  );
}
