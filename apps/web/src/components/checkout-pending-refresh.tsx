"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";

/** Cada cuanto se vuelve a preguntar, y durante cuanto. */
const INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 20;

/**
 * Vuelve a pedir la pagina de retorno mientras el pago siga PENDIENTE.
 *
 * Lo normal es que el webhook de confirmacion llegue unos segundos DESPUES de
 * que el proveedor devuelva el navegador. La pagina se pintaba en ese hueco con
 * "seguimos esperando tu pago" y se quedaba ahi hasta que la persona recargaba
 * a mano; muchos pensaban que el pago habia fallado.
 *
 * `router.refresh()` vuelve a ejecutar el Server Component, que es quien
 * pregunta al BACKEND -nunca a la URL- y redirige a la confirmacion del pedido
 * en cuanto el pago consta. Se detiene al minuto: si para entonces no hay
 * confirmacion, el texto de la pagina ya explica que hacer y seguir preguntando
 * solo gastaria peticiones.
 */
export function CheckoutPendingRefresh() {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= MAX_ATTEMPTS) window.clearInterval(timer);
    }, INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [router]);

  return null;
}
