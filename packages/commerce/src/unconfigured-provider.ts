/**
 * Implementacion del puerto para `PAYMENT_PROVIDER=none`.
 *
 * No es un proveedor: es la AUSENCIA de proveedor, hecha explicita. Existe para
 * que `apps/api` pueda arrancar y servir catalogo, cuenta y admin mientras la
 * decision de pagos sigue abierta (`CLAUDE.md` seccion 7), sin que ninguna ruta
 * de cobro funcione a medias.
 *
 * Cada metodo falla ruidosamente. Un puerto que devolviera exito simulado seria
 * capaz de generar participaciones sin cobro real, que es justo el escenario que
 * DEC-009 intenta hacer imposible.
 *
 * NO CONFUNDIR CON `MockPaymentProvider`. El mock simula un proveedor completo
 * y es para desarrollo y tests; este declara que no hay ninguno. Que sean dos
 * clases distintas es deliberado: si el mock hiciera de sustituto por defecto,
 * un despliegue mal configurado cobraria contra un proveedor de mentira sin que
 * nada fallara.
 */

import { PaymentProviderNotConfiguredError } from "./errors.js";
import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  PaymentProvider,
  PaymentSnapshot,
  RefundInput,
  RefundResult,
  SignatureVerificationResult,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from "./payment-provider.js";

export const UNCONFIGURED_PAYMENT_PROVIDER_NAME = "none";

export class UnconfiguredPaymentProvider implements PaymentProvider {
  public readonly name = UNCONFIGURED_PAYMENT_PROVIDER_NAME;

  public createCheckoutSession(_input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    return Promise.reject(new PaymentProviderNotConfiguredError());
  }

  public getPayment(_providerPaymentId: string): Promise<PaymentSnapshot> {
    return Promise.reject(new PaymentProviderNotConfiguredError());
  }

  public refund(_input: RefundInput): Promise<RefundResult> {
    return Promise.reject(new PaymentProviderNotConfiguredError());
  }

  /**
   * Rechaza sin lanzar: un webhook entrante con el proveedor sin configurar es
   * una senal de seguridad que hay que registrar y contar, no una excepcion.
   */
  public verifyWebhookSignature(_input: WebhookVerificationInput): SignatureVerificationResult {
    return { ok: false, reasonCode: "PROVIDER_NOT_CONFIGURED" };
  }

  public parseEvent(_rawBody: Buffer, _receivedAt: Date): WebhookVerificationResult {
    return { ok: false, reasonCode: "PROVIDER_NOT_CONFIGURED" };
  }
}
