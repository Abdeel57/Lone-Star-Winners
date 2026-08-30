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
// RESUELTO en 57ee8eb (HO-034.1: flag desde createFeatureFlagPort y motivo desde reason_code o X-LSW-Reason-Code). Se deja en `false` en vez de borrarse para que el
// historial de bloqueos siga siendo legible desde las propias pruebas.
export const AUTHORIZER_DOES_NOT_EVALUATE_FLAGS = false;

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
// RESUELTO en c90c732 (carrito alineado a la seccion 5 del contrato). Se deja en `false` en vez de borrarse para que el
// historial de bloqueos siga siendo legible desde las propias pruebas.
export const CART_PAGE_SHAPE_MISMATCH = false;

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
// RESUELTO en c90c732 (CSP con nonce por peticion, DEC-049). Se deja en `false` en vez de borrarse para que el
// historial de bloqueos siga siendo legible desde las propias pruebas.
export const WEB_EMITS_NO_SECURITY_HEADERS = false;

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
// RESUELTO en ed777b4 (dashboard, pedidos, participantes, auditoria; seccion 11.7) y 9b1c278 (catalogo y promociones; seccion 12). Se deja en `false` en vez de borrarse para que el
// historial de bloqueos siga siendo legible desde las propias pruebas.
export const ADMIN_DASHBOARD_ENDPOINTS_MISSING = false;

/**
 * Las 21 rutas de la seccion 13 del contrato todavia no existen en `apps/api`.
 *
 * EVIDENCIA (2026-08-29, HO-041): `apps/api/openapi/route-manifest.json`
 * declara 79 rutas y NINGUNA de estas:
 *
 *   POST  /api/v1/admin/promotions/:promotion_id/bonus-periods        (13.8)
 *   GET   /api/v1/admin/feature-flags                                 (13.9)
 *   PATCH /api/v1/admin/feature-flags/:key                            (13.9)
 *   POST  /api/v1/admin/settings/change-requests                      (13.9, control dual)
 *   GET   /api/v1/admin/settings/change-requests                      (13.9)
 *   POST  /api/v1/admin/settings/change-requests/:id/approve|reject   (13.9)
 *   POST  /api/v1/admin/amoe-submissions                              (13.10)
 *   ... y las once de reglas, categorias y variantes.
 *
 * Tampoco existe `entry_offer` en el catalogo publico (13.4) ni en
 * `PromotionDetail` (13.5), asi que la cotizacion por tipo de producto no se
 * puede comprobar ni por API; ni `AMOE_MODE_NOT_ONLINE` /
 * `AMOE_MODE_NOT_MAIL_IN` en `apps/api/src/http/errors.ts`, que es lo que
 * cierra la via en linea cuando el AMOE es postal (resolucion HO-041, hallazgo
 * 2 de la fase 1 de security).
 *
 * Se apaga cuando `backend` publique esas rutas y regenere el manifiesto. La
 * comprobacion equivalente, y que SI corre hoy, es
 * `tests/security/src/permissions/section-13-routes.test.ts`: enumera cuales
 * faltan y falla mientras falten.
 */
// RESUELTO en la fase 2 de HO-041: `apps/api/openapi/route-manifest.json` declara
// las 21 rutas (100 en total) y `http/errors.ts` mas los handlers cubren los ocho
// codigos nuevos. Se deja en `false` en vez de borrarse para que el historial de
// bloqueos siga siendo legible desde las propias pruebas.
export const SECTION_13_API_ROUTES_MISSING = false;

/**
 * El panel no tiene todavia las pantallas de la seccion 13 (DEC-054).
 *
 * EVIDENCIA (2026-08-29, HO-041): `apps/web/src/app/admin/[locale]/` contiene
 * `adjustments`, `amoe`, `audit`, `catalog`, `draw`, `exports`, `login`, `mfa`,
 * `orders`, `participants` y `promotions`. NO hay `rules` (versiones de
 * reglas), no hay `flags`, no hay accion de periodo bonus y
 * `components/admin/amoe-review.tsx` no tiene formulario de transcripcion de
 * ficha postal.
 *
 * Se apaga cuando `frontend` publique las cuatro: Reglas, Bonus, Flags y
 * Transcribir ficha.
 */
// RESUELTO en la fase 2 de HO-041: existen `admin/[locale]/flags/page.tsx`,
// `admin/[locale]/promotions/[id]/rules/page.tsx` (y `[versionId]`), el formulario
// de bonus en la ficha de la promocion y `components/admin/amoe-transcribe-form.tsx`.
// Se deja en `false` en vez de borrarse para que el historial siga siendo legible.
export const SECTION_13_ADMIN_SCREENS_MISSING = false;

/**
 * El escaparate todavia pinta el universo retirado y no pinta `entry_offer`.
 *
 * EVIDENCIA (2026-08-29, HO-041): `apps/web/src/components/promotion-hero.tsx`
 * linea 221 lee `detail?.entry_pool`, y `apps/web/src/lib/api/contract.ts`
 * linea 363 sigue declarando `entry_pool?: EntryPool | null`. DEC-052 punto 6
 * lo retira, y en su lugar la ficha de un paquete tiene que mostrar "Incluye N
 * participaciones" desde `entry_offer.base_entries`.
 *
 * Se apaga cuando `frontend` cambie a `entry_offer`.
 */
// RESUELTO en la fase 2 de HO-041: la ficha pinta `entry_offer` a traves de
// `components/entry-package-panel.tsx` ("Incluye {entries} participaciones") y
// `/shop` filtra por `?kind=`. Se deja en `false` en vez de borrarse para que el
// historial siga siendo legible.
export const SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING = false;

/** Todos los bloqueos, para que un solo sitio pueda enumerarlos en el informe. */
/**
 * HO-034.1 (57ee8eb) dejo SEIS capacidades cerradas por construccion: las que
 * exigen segunda aprobacion. El autorizador no la decide -es un hecho sobre un
 * recurso concreto- y la deniega salvo que la ruta declare, con
 * `secondApprovalEnforcedBy`, donde la impone el dominio. `entry.adjust.create`
 * (POST /admin/entry-adjustments) no lo declara todavia, asi que sigue en 403.
 * Se levanta cuando la ruta de ajustes declare quien impone la segunda
 * aprobacion (`apps/api/src/routes/adjustments.ts`).
 */
// RESUELTO: POST /admin/entry-adjustments (y preview) declaran secondApprovalEnforcedBy
// nombrando adjustment-service.ts#approve y el CHECK adjustments_approver_differs.
export const SECOND_APPROVAL_NOT_DECLARED_FOR_ADJUSTMENTS = false;

export const ALL_BLOCKERS = Object.freeze({
  SECOND_APPROVAL_NOT_DECLARED_FOR_ADJUSTMENTS,
  AUTHORIZER_DOES_NOT_EVALUATE_FLAGS,
  CART_PAGE_SHAPE_MISMATCH,
  WEB_EMITS_NO_SECURITY_HEADERS,
  NO_PARTICIPANT_REGISTRATION_ENDPOINT,
  ADMIN_DASHBOARD_ENDPOINTS_MISSING,
  SECTION_13_API_ROUTES_MISSING,
  SECTION_13_ADMIN_SCREENS_MISSING,
  SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING,
});
