/**
 * Implementacion del puerto para `PAYMENT_PROVIDER=none`.
 *
 * No es un proveedor: es la ausencia de proveedor, hecha explicita. Existe
 * para que `apps/api` pueda arrancar y servir catalogo, cuenta y admin
 * mientras la decision de pagos sigue abierta, **sin** que ninguna ruta de
 * cobro funcione a medias.
 *
 * Cada metodo falla ruidosamente. Un puerto que devolviera exito simulado
 * seria capaz de generar entries sin cobro real, que es justo el escenario que
 * DEC-009 intenta hacer imposible.
 */

import { PaymentProviderNotConfiguredError } from "./errors.js";
import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  PaymentProvider,
  PaymentSnapshot,
  RefundInput,
  RefundResult,
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
  public verifyWebhook(_input: WebhookVerificationInput): Promise<WebhookVerificationResult> {
    return Promise.resolve({ ok: false, reasonCode: "PROVIDER_NOT_CONFIGURED" });
  }
}
