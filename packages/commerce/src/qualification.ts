/**
 * Cuando una orden CALIFICA para generar participaciones.
 *
 * ---------------------------------------------------------------------------
 * ESTO NO ES UNA DECISION TECNICA
 * ---------------------------------------------------------------------------
 *
 * "Las participaciones se generan al autorizar el pago" y "se generan al
 * capturarlo" son dos promociones distintas para el participante:
 *
 *   Con `AUTHORIZED`, una compra que despues falla al capturarse habra
 *   generado participaciones que hay que revertir.
 *   Con `PAID`, un pago que tarde tres dias en liquidar deja al participante
 *   sin sus participaciones durante tres dias, con la promocion corriendo.
 *
 * Cual de las dos es la correcta lo dicen las Official Rules. Por eso este
 * modulo NO tiene valor por defecto y falla si la configuracion no lo declara
 * (principio 2). Elegir `PAID` "porque es lo prudente" seria inventar un
 * requisito legal, y ademas uno que el participante nota.
 *
 * ---------------------------------------------------------------------------
 * PENDIENTE DE REGISTRAR
 * ---------------------------------------------------------------------------
 *
 * `docs/LEGAL_PENDING.md` NO tiene todavia un epigrafe para esta pregunta. Debe
 * anadirse uno -"Order qualification point"- junto al resto. Mientras no exista
 * la clave en la version de reglas, el pipeline de award no puede arrancar para
 * esa promocion, que es el comportamiento correcto: es preferible que no genere
 * a que genere en el momento equivocado.
 */

import { z } from "zod";

import { CommerceError } from "./errors.js";
import type { PaymentState } from "./payment-provider.js";

/**
 * Los unicos estados que tiene sentido declarar como cualificantes.
 *
 * `REFUNDED` o `DISPUTED` como punto de calificacion serian una contradiccion,
 * y `PENDING` significaria otorgar sobre un cobro que aun no ha empezado.
 */
export const QUALIFYING_PAYMENT_STATES = ["AUTHORIZED", "PAID"] as const;
export type QualifyingPaymentState = (typeof QUALIFYING_PAYMENT_STATES)[number];

const qualificationSliceSchema = z.object({
  order_qualification: z
    .object({ qualifying_payment_state: z.enum(QUALIFYING_PAYMENT_STATES) })
    .optional(),
});

/**
 * Lee el estado cualificante de `PromotionRulesVersion.config`.
 *
 * Falla si no esta. Ver la cabecera: no hay default posible que no sea una
 * decision legal disfrazada.
 */
export function resolveQualifyingPaymentState(rawConfig: unknown): PaymentState {
  const parsed = qualificationSliceSchema.safeParse(rawConfig);
  const declared = parsed.success ? parsed.data.order_qualification : undefined;

  if (declared === undefined) {
    throw new CommerceError(
      "ORDER_QUALIFICATION_NOT_CONFIGURED",
      { key: "order_qualification.qualifying_payment_state" },
      "La version de reglas no declara en que estado de pago califica una orden. " +
        "Ver docs/LEGAL_PENDING.md -> Order qualification point.",
    );
  }
  return declared.qualifying_payment_state;
}
