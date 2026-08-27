/**
 * DEFECTOS CONOCIDOS QUE IMPIDEN COMPLETAR UN PASO DEL RECORRIDO.
 *
 * POR QUE ESTE FICHERO EXISTE EN VEZ DE PRUEBAS QUE AFIRMEN EL COMPORTAMIENTO
 * ACTUAL
 *
 *   La tentacion, al escribir un e2e contra un sistema a medio construir, es
 *   afirmar lo que el sistema hace hoy: "esta ruta responde 403". Esa prueba
 *   pasa, queda verde para siempre y CONVIERTE UN DEFECTO EN CONTRATO. El dia
 *   que alguien lo arregla, la suite se pone roja por haberlo arreglado.
 *
 *   Aqui se hace lo contrario. La prueba afirma el comportamiento CORRECTO -el
 *   que exige `docs/API_CONTRACT.md`- y se marca `test.fixme()` mientras el
 *   defecto siga vivo. Consecuencias:
 *
 *     - el informe de Playwright ENUMERA los pasos que no se estan probando,
 *       con su motivo, en vez de callarlos;
 *     - arreglar el defecto es poner a `false` una linea de este fichero;
 *     - nadie tiene que reescribir la prueba cuando eso pase.
 *
 * COMO SE APAGA UN BLOQUEO
 *
 *   Se cambia el valor a `false` en el mismo commit que arregla el defecto. Si
 *   la prueba entonces no pasa, es que el arreglo no estaba completo, que es
 *   justo lo que hay que saber.
 *
 *   Cada entrada lleva FICHERO Y LINEA de la evidencia. Sin eso, un bloqueo
 *   sobrevive a su causa: nadie se atreve a quitar una bandera cuyo motivo no
 *   puede comprobar.
 */

/**
 * `session-authorizer.ts` pasa `featureFlagEnabled: null`, `reasonProvided:
 * false` y `secondApprovalGranted: false` a `authorize()`
 * (`apps/api/src/http/session-authorizer.ts`, bloque comentado justo antes de
 * la llamada). `authorize()` DENIEGA con `FEATURE_FLAG_NOT_EVALUATED` cuando la
 * capacidad declara un flag y el valor llega sin consultar.
 *
 * Es deliberado -fallar cerrado mientras la ruta no resuelva el flag- y esta
 * escrito asi en el propio comentario del fichero. Pero deja INALCANZABLES,
 * con 403, todas las capacidades que dependen de un flag legalmente material:
 *
 *   amoe.self.submit ......... flag `amoe_enabled`
 *   amoe.review.approve ...... flag `amoe_enabled` + motivo
 *   amoe.review.reject ....... idem
 *   entry.adjust.create ...... flag `manual_adjustments_enabled` + step-up +
 *                              motivo + segunda aprobacion
 *   entry.adjust.approve ..... step-up + motivo
 *
 * Sembrar el flag encendido en base de datos NO lo desbloquea: el autorizador
 * no lo lee.
 */
export const AUTHORIZER_DOES_NOT_EVALUATE_FLAGS =
  process.env.E2E_AUTHORIZER_EVALUATES_FLAGS !== "true";

/**
 * `apps/web` y `apps/api` no coinciden en la forma del carrito.
 *
 * La pagina lee `cartResult.data.cart.items`
 * (`apps/web/src/app/[locale]/cart/page.tsx`), y `GET /api/v1/cart` devuelve
 * `{ id, currency, lines, subtotal, entry_quote }`
 * (`apps/api/src/http/schemas.ts`, `cartWithQuoteSchema`). No hay `cart` ni
 * `items` en la respuesta.
 *
 * Consecuencia: la pantalla de carrito no puede pintar lineas contra la API
 * real, aunque el `POST /cart/items` haya funcionado. La comprobacion a nivel
 * de API si corre, y es la que demuestra que el backend hace su parte.
 */
export const CART_PAGE_SHAPE_MISMATCH = process.env.E2E_CART_SHAPES_ALIGNED !== "true";

/**
 * `apps/web` no emite ninguna cabecera de seguridad.
 *
 * `next.config.mjs` no define `headers()`, `middleware.ts` solo redirige y
 * ninguna plantilla pone `<meta http-equiv>`. Es decir: sin CSP, sin HSTS, sin
 * `X-Content-Type-Options`, en cualquier `NODE_ENV`. Lo unico que hace es
 * quitar `X-Powered-By` (`poweredByHeader: false`).
 *
 * DEC-018 las pide. `apps/api` SI las emite -helmet, en `app.ts`- asi que la
 * comprobacion del backend corre de verdad y no esta bloqueada.
 */
export const WEB_EMITS_NO_SECURITY_HEADERS = process.env.E2E_WEB_SECURITY_HEADERS !== "true";

/**
 * No existe `POST /auth/register` en `apps/api`.
 *
 * La pantalla `/{locale}/account/register` existe en `apps/web` y el manifiesto
 * de rutas (`apps/api/openapi/route-manifest.json`) no tiene endpoint de alta.
 * El participante del escenario se siembra por SQL, con su credencial Argon2id,
 * porque no hay otra via.
 */
export const NO_PARTICIPANT_REGISTRATION_ENDPOINT =
  process.env.E2E_REGISTRATION_ENDPOINT !== "true";

/**
 * Buena parte del panel llama a endpoints que `apps/api` no sirve:
 * `/admin/dashboard`, `/admin/promotions`, `/admin/products`,
 * `/admin/participants`, `/admin/orders`, `/admin/audit-events`,
 * `/admin/export-snapshots`, `/admin/draw-authorizations`.
 *
 * Las pantallas responden 200 pero pintan su estado de error. Solo la cola de
 * revision AMOE y la de ajustes tienen backend real.
 */
export const ADMIN_DASHBOARD_ENDPOINTS_MISSING =
  process.env.E2E_ADMIN_DASHBOARD_ENDPOINTS !== "true";

/** Todos los bloqueos, para que un solo sitio pueda enumerarlos en el informe. */
export const ALL_BLOCKERS = Object.freeze({
  AUTHORIZER_DOES_NOT_EVALUATE_FLAGS,
  CART_PAGE_SHAPE_MISMATCH,
  WEB_EMITS_NO_SECURITY_HEADERS,
  NO_PARTICIPANT_REGISTRATION_ENDPOINT,
  ADMIN_DASHBOARD_ENDPOINTS_MISSING,
});
