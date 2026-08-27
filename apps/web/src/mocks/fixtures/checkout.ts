import type { CheckoutSessionResponse, CheckoutSessionState } from "@/lib/api";

import { pendingOrder } from "./account";

/**
 * Fixtures de checkout.
 *
 * EL PROVEEDOR DE PAGO NO ESTA DECIDIDO, y estos fixtures existen precisamente
 * para que no haga falta decidirlo para construir la pantalla. `provider` se
 * llama `mock` y no se parece al nombre de ningun proveedor real: si algun dia
 * alguien lee esta cadena en una captura de pantalla, tiene que ser evidente de
 * inmediato que no se ha cobrado nada.
 *
 * LAS DOS MODALIDADES ESTAN AQUI, y solo una se implementa. `hosted_redirect`
 * es la que la interfaz sabe recorrer entera; `embedded_component` existe como
 * fixture para poder probar que la pantalla lo dice en vez de quedarse en
 * blanco cuando el backend responda una modalidad que todavia no sabe pintar.
 */

/** Borrador de pedido. No es un pedido: el pedido lo crea el backend al cobrar. */
export const ORDER_DRAFT_ID = "chk_0000000000000001";

export const hostedRedirectSession: CheckoutSessionResponse = {
  provider: "mock",
  mode: "hosted_redirect",
  /**
   * `redirect_url` la compone la API simulada en tiempo de ejecucion, porque
   * incluye la URL de retorno que manda el frontend. Este valor fijo es el que
   * ven los tests, donde no hay navegador que redirigir.
   */
  client_config: { redirect_url: "https://payments.example.invalid/session/chk_0000000000000001" },
  order_draft_id: ORDER_DRAFT_ID,
};

/**
 * Modalidad que la interfaz NO implementa.
 *
 * Sirve para comprobar el punto de extension: la pantalla tiene que decir que
 * esa forma de pago no esta disponible aqui, con su codigo y su referencia,
 * en vez de ensenar un contenedor vacio donde deberia ir un formulario.
 */
export const embeddedComponentSession: CheckoutSessionResponse = {
  provider: "mock",
  mode: "embedded_component",
  client_config: { publishable_key: "pk_test_not_a_real_key", session_id: ORDER_DRAFT_ID },
  order_draft_id: ORDER_DRAFT_ID,
};

export const pendingCheckout: CheckoutSessionState = {
  order_draft_id: ORDER_DRAFT_ID,
  status: "PENDING",
  order_id: null,
};

export const completedCheckout: CheckoutSessionState = {
  order_draft_id: ORDER_DRAFT_ID,
  status: "COMPLETED",
  order_id: pendingOrder.id,
};

/**
 * Pago confirmado y pedido todavia sin materializar.
 *
 * Es un estado real y corto, no una hipotesis: el webhook llega, el pedido se
 * crea en la misma transaccion, y entre una cosa y otra hay un instante. La
 * pagina de retorno tiene que saber pintarlo sin enviar a nadie a un 404.
 */
export const completedWithoutOrder: CheckoutSessionState = {
  ...completedCheckout,
  order_id: null,
};

export const cancelledCheckout: CheckoutSessionState = {
  order_draft_id: ORDER_DRAFT_ID,
  status: "CANCELLED",
  order_id: null,
};

export const failedCheckout: CheckoutSessionState = {
  order_draft_id: ORDER_DRAFT_ID,
  status: "FAILED",
  order_id: null,
};
