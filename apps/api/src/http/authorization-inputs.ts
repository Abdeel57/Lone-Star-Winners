/**
 * Los tres hechos que `authorize()` no puede averiguar por si solo (HO-034.1).
 *
 * `packages/security` aporta la REGLA -esta capacidad exige motivo, esta otra
 * depende de un flag- y este modulo aporta el HECHO correspondiente a la
 * peticion que se esta autorizando. La separacion no es estetica: el catalogo
 * no puede saber si en ESTA peticion viaja un motivo, ni cuanto vale el flag
 * persistido ahora mismo, y la puerta no puede reimplementar el catalogo.
 *
 * Hasta HO-034.1 los tres llegaban como constantes -`false`, `false`, `null`-
 * con un comentario que decia que las rutas los aportarian. Las rutas no podian
 * aportarlos: el autorizador corre en un `preHandler`, ANTES del handler, asi
 * que nada de lo que el handler haga llega a tiempo. El resultado medido fue 27
 * de 62 capacidades inalcanzables para todo el mundo, entre ellas
 * `promotion.activate`, `promotion.close`, `pii.view.full` y
 * `order.refund.initiate`.
 */

import type { FastifyRequest } from "fastify";

/**
 * Forma de un `reason_code`: la MISMA que ya valida `routes/adjustments.ts`.
 *
 * Se repite el patron en vez de importarlo desde una ruta porque la dependencia
 * correcta va al reves -las rutas dependen de la puerta, no la puerta de una
 * ruta- y un test de paridad seria mas ruido que valor para una expresion de
 * catorce caracteres. Si algun dia divergen, lo que falla es un 403 visible, no
 * un permiso concedido de mas.
 */
const REASON_CODE = /^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u;

/** Cabecera para las rutas sin cuerpo. En minuscula: Fastify normaliza. */
export const REASON_HEADER = "x-lsw-reason-code";

/**
 * Motivo presentado en esta peticion, o `null`.
 *
 * DOS TRANSPORTES, UN SOLO CONCEPTO
 *   - `reason_code` en el cuerpo, que es lo que ya hacen las rutas de ajustes y
 *     de sorteo y lo que publica el contrato.
 *   - Cabecera `X-LSW-Reason-Code`, para las rutas que NO tienen cuerpo. La
 *     mas importante es `GET /admin/participants/:id/pii`: exige motivo y es un
 *     GET, asi que sin cabecera no habria forma de dar uno y la ruta seguiria
 *     respondiendo 403 para siempre.
 *
 *   El cuerpo gana cuando estan los dos. Es el canal que el contrato publica y
 *   el que acaba en el `AuditEvent`; una cabecera que pudiera sobreescribirlo
 *   permitiria auditar un motivo distinto del que autorizo la operacion.
 *
 * SE VALIDA LA FORMA, NO SOLO LA PRESENCIA
 *   Una cadena vacia o un espacio no son un motivo. Aceptar cualquier cosa no
 *   vacia convertiria el control en un tramite: bastaria con mandar "x" para
 *   abrir toda capacidad que exija motivo. La forma exigida es la misma que ya
 *   se persiste en `audit_events.reason_code`, asi que lo que abre la puerta es
 *   exactamente lo que queda escrito en la traza.
 *
 * LO QUE ESTO NO COMPRUEBA
 *   Que el motivo sea CIERTO. Ningun control automatico puede. Lo que garantiza
 *   es que existe, que tiene forma de codigo estable y que queda atribuido a un
 *   actor concreto, que es lo que permite pedir cuentas despues.
 */
export function presentedReasonCode(request: FastifyRequest): string | null {
  const body: unknown = request.body;

  if (typeof body === "object" && body !== null && "reason_code" in body) {
    const value: unknown = (body as { readonly reason_code?: unknown }).reason_code;
    if (typeof value === "string" && REASON_CODE.test(value)) {
      return value;
    }
  }

  const header: unknown = request.headers[REASON_HEADER];

  // Una cabecera repetida llega como array. No se elige una: dos motivos para
  // una operacion son una peticion mal formada, y quedarse con el primero
  // dejaria en la traza un motivo que quiza no es el que el cliente creia
  // mandar.
  if (typeof header === "string" && REASON_CODE.test(header)) {
    return header;
  }

  return null;
}
