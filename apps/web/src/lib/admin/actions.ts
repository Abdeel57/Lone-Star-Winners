"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { adminHref } from "@/i18n/admin-routing";
import { FALLBACK_LOCALE, type Locale } from "@/i18n/locales";
import {
  ADJUSTMENT_DIRECTIONS,
  approveAdjustment,
  approveAmoeSubmission,
  createAdjustment,
  login,
  logout,
  rejectAmoeSubmission,
  verifyMfa,
  type AdjustmentDirection,
  activateAdminPromotion,
  closeAdminPromotion,
  createAdminProduct,
  createAdminPromotion,
  fetchAdminProduct,
  fetchAdminPromotion,
  publishAdminProduct,
  scheduleAdminPromotion,
  updateAdminProduct,
  updateAdminPromotion,
} from "@/lib/api";
import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "@/lib/action-result";
import { checkboxFrom, localeFrom, secretFrom, textFrom } from "@/lib/form-input";
import { isIanaTimeZone, priceToMinorUnits, zonedWallTimeToIso } from "@/lib/admin/catalog-input";
import { PROMOTION_ACTIVATE_REASONS, PROMOTION_CLOSE_REASONS } from "@/lib/admin/reason-codes";
import { mutableSession } from "@/lib/session-server";

/**
 * Acciones del panel, como Server Actions (DEC-006, DEC-048).
 *
 * NO EXISTE `/admin/login` EN LA API, Y NO ES UN OLVIDO
 * ----------------------------------------------------
 * `CLAUDE.md` seccion 4 prohibe dos sistemas de autenticacion y DEC-006 lo
 * repite. Personal y participante usan LAS MISMAS rutas -`/auth/login`,
 * `/auth/mfa/verify`, `/auth/logout`-; lo que cambia es la politica que decide
 * el backend a partir de los roles: nombre de cookie, `SameSite`, `Path`, TTL,
 * inactividad y si el MFA es obligatorio. El frontend no decide ni un atributo
 * de esa cookie: los propaga tal como llegan.
 *
 * Lo unico propio de estas acciones frente a las del escaparate es A DONDE
 * REDIRIGEN, y por que el segundo factor no es opcional.
 *
 * EL SEGUNDO FACTOR NO SE PUEDE SALTAR
 * ------------------------------------
 * Para personal, un 200 en el login NO significa estar dentro: devuelve
 * `MFA_PENDING`, que es una sesion que "todavia no vale para nada" salvo para
 * completar el segundo factor. Mandar a esa persona al panel la llevaria a una
 * pantalla que le pide iniciar sesion justo despues de haberla iniciado, y peor
 * aun: si alguna pantalla tratara ese estado como "casi dentro", abriria en la
 * interfaz una puerta que el backend tiene cerrada.
 *
 * LO QUE ESTAS ACCIONES NO HACEN
 * ------------------------------
 * No comprueban ninguna capacidad, no calculan ninguna cifra de participaciones
 * y no deciden si una segunda aprobacion hace falta. Todo eso lo decide el
 * backend, que revalida y responde 403 cuando toca; la interfaz pinta ese 403.
 */

/** Destino dentro del panel, validado. */
function adminDestination(formData: FormData, locale: Locale): string {
  const raw = formData.get("next");

  /*
   * ES UNA VALIDACION DE SEGURIDAD, no una comodidad, y aqui es MAS estricta
   * que la del escaparate (`returnPathFrom`): un destino del panel tiene que
   * empezar por `/admin/`. Sin esa restriccion, el formulario de personal seria
   * un redirector que ademas se enlaza desde un correo dirigido a alguien con
   * credenciales de administracion, que es el peor destinatario posible.
   */
  if (typeof raw !== "string") return adminHref(locale);
  if (!raw.startsWith("/admin/")) return adminHref(locale);
  if (raw.startsWith("//")) return adminHref(locale);
  if (raw.includes("\\")) return adminHref(locale);
  if (raw.length > 512) return adminHref(locale);

  return raw;
}

/**
 * Inicio de sesion de personal.
 *
 * Usa `POST /auth/login`, la MISMA ruta que el escaparate. Codigos de fallo del
 * contrato: 401 credenciales invalidas -que no distingue si el correo existe, a
 * proposito-, 423 cuenta bloqueada con `retry_after_seconds`, 422 cuerpo
 * invalido.
 */
export async function staffLoginAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const email = textFrom(formData, "email");
  if (email === null) return invalid("FIELD_REQUIRED", "email");

  const credential = secretFrom(formData, "password");
  if (credential === null) return invalid("FIELD_REQUIRED", "password");

  const session = await mutableSession();
  const result = await login({ email, password: credential }, locale, session);

  if (!result.ok) return fromFailure(result.error);

  const destination = adminDestination(formData, locale);

  /*
   * `MFA_PENDING` es el camino NORMAL de una cuenta de personal, no una
   * excepcion: DEC-006 hace el MFA obligatorio para todo rol administrativo.
   * El destino que se pedia viaja a traves del segundo paso para no perderlo.
   */
  if (result.data.state === "MFA_PENDING") {
    const mfa = `${adminHref(locale, "/mfa")}?next=${encodeURIComponent(destination)}`;
    revalidatePath("/admin", "layout");
    redirect(mfa);
  }

  revalidatePath("/admin", "layout");
  redirect(destination);
}

/**
 * Segundo factor del panel.
 *
 * `POST /auth/mfa/verify` es `PUBLIC` en el contrato y no es un descuido: la
 * sesion existe pero esta en `MFA_PENDING`, asi que exigir sesion valida aqui
 * seria circular.
 *
 * UN CODIGO NO VALE DOS VECES, ni siquiera dentro de su ventana de 30 segundos.
 * El backend responde 401 igual si el codigo es invalido, si caduco o si ya se
 * uso, y la interfaz no intenta adivinar cual de los tres: inventarse el motivo
 * seria peor que decir que no vale.
 */
export async function staffMfaAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const typed = textFrom(formData, "code");
  if (typed === null) return invalid("FIELD_REQUIRED", "code");

  const session = await mutableSession();

  // Se quitan los espacios interiores: el contrato admite espacios y las
  // aplicaciones de autenticacion muestran el codigo agrupado de tres en tres.
  // No se comprueba que sean seis: la longitud es politica del backend.
  const result = await verifyMfa({ code: typed.replace(/\s+/g, "") }, locale, session);

  if (!result.ok) return fromFailure(result.error, "code");

  /*
   * Escrita EN POSITIVO (HO-027). Si el backend responde 200 y la sesion sigue
   * sin autenticar, NO se sale de esta pantalla: llevar a alguien al panel con
   * una sesion que no autentica solo cambia donde aparece el problema.
   */
  const authenticated = result.data.authenticated && result.data.state === "ACTIVE";
  if (!authenticated) return invalid("MFA_CODE_INVALID", "code");

  revalidatePath("/admin", "layout");
  redirect(adminDestination(formData, locale));
}

/**
 * Cierre de sesion del panel.
 *
 * Lleva al login del panel y no a la portada del sitio: quien cierra sesion en
 * el panel esta trabajando, no comprando. La revocacion la hace el backend en
 * base de datos ademas de borrar la cookie; borrar solo la cookie dejaria el
 * token vivo para quien lo hubiera copiado.
 */
export async function staffLogoutAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData) ?? FALLBACK_LOCALE;

  const session = await mutableSession();
  await logout(locale, session);

  revalidatePath("/admin", "layout");
  redirect(adminHref(locale, "/login"));
}

/**
 * Sentido de un ajuste, comprobado contra la lista del contrato.
 *
 * SE COMPARA CON LA LISTA y no se acepta cualquier texto: un `direction`
 * manipulado en el navegador tiene que morir aqui con un error de forma, no
 * viajar al backend para que lo rechace. No es una regla de negocio -cuanto y
 * en que sentido se puede ajustar lo decide el motor-, es el enum del contrato.
 */
function directionFrom(formData: FormData): AdjustmentDirection | null {
  const raw = textFrom(formData, "direction");
  if (raw === null) return null;

  const known = ADJUSTMENT_DIRECTIONS.find((direction) => direction === raw);
  return known ?? null;
}

/**
 * Cantidad de un ajuste: entero POSITIVO.
 *
 * El signo lo lleva `direction`, asi que aqui un cero o un negativo son formas
 * invalidas del dato (DEC-010), no decisiones de negocio. Cuanto puede valer un
 * ajuste, si hay tope y si el saldo puede quedar negativo lo decide el backend,
 * y ninguna de esas tres preguntas se responde aqui.
 */
function positiveQuantityFrom(formData: FormData): number | null {
  const raw = textFrom(formData, "quantity");
  if (raw === null) return null;

  const quantity = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(quantity)) return null;

  return quantity > 0 ? quantity : null;
}

/** Lee clave de motivo y nota, con la nota obligatoria cuando la clave lo exige. */
function reasonFrom(
  formData: FormData,
): ActionResult | { readonly reason_key: string; readonly note: string | null } {
  const reasonKey = textFrom(formData, "reason_key");
  if (reasonKey === null) return invalid("FIELD_REQUIRED", "reason_key");

  const note = textFrom(formData, "reason_note");

  // La nota es obligatoria para las claves que por si solas no explican nada.
  // Se comprueba tambien en el backend; esto evita el viaje de ida y vuelta.
  if (note === null && reasonKey === "OTHER") {
    return invalid("FIELD_REQUIRED", "reason_note");
  }

  return { reason_key: reasonKey, note };
}

function isActionResult(value: unknown): value is ActionResult {
  return typeof value === "object" && value !== null && "status" in value;
}

/** Aprobacion de un envio AMOE. */
export async function approveAmoeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const submissionId = textFrom(formData, "submission_id");
  if (submissionId === null) return invalid("VALIDATION_FAILED");

  const reason = reasonFrom(formData);
  if (isActionResult(reason)) return reason;

  const session = await mutableSession();
  const result = await approveAmoeSubmission(
    submissionId,
    reason.note === null
      ? { reason_key: reason.reason_key }
      : { reason_key: reason.reason_key, notes: reason.note },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/** Rechazo de un envio AMOE. */
export async function rejectAmoeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const submissionId = textFrom(formData, "submission_id");
  if (submissionId === null) return invalid("VALIDATION_FAILED");

  const reason = reasonFrom(formData);
  if (isActionResult(reason)) return reason;

  const session = await mutableSession();
  const result = await rejectAmoeSubmission(
    submissionId,
    reason.note === null
      ? { reason_key: reason.reason_key }
      : { reason_key: reason.reason_key, notes: reason.note },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Propuesta de un ajuste manual.
 *
 * CREA, NO APLICA. El ajuste nace pendiente de la aprobacion de OTRO actor.
 * `entry.adjust.create` y `entry.adjust.approve` son capacidades distintas
 * porque un ajuste que se aprueba a si mismo es una edicion del ledger con otro
 * nombre.
 *
 * SE ENVIA EXACTAMENTE LO QUE SE PREVISUALIZO: el mismo sentido y la misma
 * cantidad que produjeron la tabla de impacto. Aqui no se suma, no se compara
 * con ningun saldo y no se calcula ningun resultado: el "despues" lo publica la
 * previsualizacion del backend, porque el frontend no puede calcularlo
 * (DEC-023, requisito R13 de `security`).
 */
export async function createAdjustmentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const participantId = textFrom(formData, "participant_id");
  if (participantId === null) return invalid("FIELD_REQUIRED", "participant_id");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("FIELD_REQUIRED", "promotion_id");

  const direction = directionFrom(formData);
  if (direction === null) return invalid("VALIDATION_FAILED", "direction");

  const quantity = positiveQuantityFrom(formData);
  if (quantity === null) return invalid("VALIDATION_FAILED", "quantity");

  const reason = reasonFrom(formData);
  if (isActionResult(reason)) return reason;

  const session = await mutableSession();
  const result = await createAdjustment(
    {
      participant_id: participantId,
      promotion_id: promotionId,
      direction,
      quantity,
      reason_key: reason.reason_key,
      reason_detail: reason.note,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Segunda aprobacion de un ajuste.
 *
 * QUE LA INTERFAZ NO OFREZCA EL BOTON A QUIEN LO PROPUSO ES CORTESIA, no el
 * control. El control lo aplica el backend comparando actores y exigiendo
 * step-up (DEC-006). Si esta accion se llamara igualmente sobre un ajuste
 * propio, la respuesta correcta es un 403 y la pantalla lo pinta.
 */
export async function approveAdjustmentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const adjustmentId = textFrom(formData, "adjustment_id");
  if (adjustmentId === null) return invalid("VALIDATION_FAILED");

  const reason = reasonFrom(formData);
  if (isActionResult(reason)) return reason;

  const session = await mutableSession();
  const result = await approveAdjustment(
    adjustmentId,
    reason.note === null
      ? { reason_key: reason.reason_key }
      : { reason_key: reason.reason_key, notes: reason.note },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

// ---------------------------------------------------------------------------
// Altas del panel: catalogo y promociones (seccion 12)
// ---------------------------------------------------------------------------
//
// LO QUE ESTAS ACCIONES CONVIERTEN Y LO QUE NO DECIDEN
//
//   Convierten dos cosas que el formulario no puede mandar en la forma que la
//   API exige: el precio tecleado con decimales pasa a unidad menor, y la
//   fecha de pared pasa a instante UTC contra la zona legal de la promocion.
//   Las dos conversiones viven en `lib/admin/catalog-input.ts`, sin coma
//   flotante y con sus propios tests.
//
//   NO deciden si un SKU es valido, si una promocion puede activarse ni cuantas
//   participaciones genera nada. Eso lo decide el backend y el motor de base
//   de datos, y sus respuestas -422, 409 con el mensaje del motor- se
//   traducen a un resultado de formulario y se ensenan.

/** Existencias: vacio = no gestionadas (`null`); si no, entero no negativo. */
function stockFrom(
  formData: FormData,
): { readonly ok: true; readonly value: number | null } | { readonly ok: false } {
  const raw = textFrom(formData, "stock");
  if (raw === null) return { ok: true, value: null };
  if (!/^\d+$/u.test(raw)) return { ok: false };

  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
}

/**
 * Un campo de fecha del formulario, resuelto contra la zona legal.
 *
 * Vacio significa "sin fijar" y viaja como `null`. Una hora que no existe en
 * esa zona -el hueco del horario de verano- se rechaza con el campo señalado,
 * en vez de inventarse una hora cercana.
 */
function windowFieldFrom(
  formData: FormData,
  field: "starts_at" | "ends_at",
  timeZone: string,
):
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly result: ActionResult } {
  const raw = textFrom(formData, field);
  if (raw === null) return { ok: true, value: null };

  const iso = zonedWallTimeToIso(raw, timeZone);
  if (iso === null) return { ok: false, result: invalid("DATETIME_INVALID", field) };

  return { ok: true, value: iso };
}

/** Los dos nombres, los dos obligatorios (principio 4). */
function localizedFrom(
  formData: FormData,
  prefix: string,
):
  | { readonly ok: true; readonly value: { readonly "es-US": string; readonly "en-US": string } }
  | { readonly ok: false; readonly result: ActionResult } {
  const es = textFrom(formData, `${prefix}_es`);
  if (es === null) return { ok: false, result: invalid("FIELD_REQUIRED", `${prefix}_es`) };

  const en = textFrom(formData, `${prefix}_en`);
  if (en === null) return { ok: false, result: invalid("FIELD_REQUIRED", `${prefix}_en`) };

  return { ok: true, value: { "es-US": es, "en-US": en } };
}

/** Alta de un producto. Redirige a su ficha, que es donde se publica. */
export async function createProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const sku = textFrom(formData, "sku");
  if (sku === null) return invalid("FIELD_REQUIRED", "sku");

  const slug = textFrom(formData, "slug");
  if (slug === null) return invalid("FIELD_REQUIRED", "slug");

  const currencyRaw = textFrom(formData, "currency");
  if (currencyRaw === null) return invalid("FIELD_REQUIRED", "currency");
  const currency = currencyRaw.toUpperCase();

  const name = localizedFrom(formData, "name");
  if (!name.ok) return name.result;

  const priceText = textFrom(formData, "price");
  if (priceText === null) return invalid("FIELD_REQUIRED", "price");

  const price = priceToMinorUnits(priceText, currency);
  if (price === null) return invalid("PRICE_INVALID", "price");

  const stock = stockFrom(formData);
  if (!stock.ok) return invalid("VALIDATION_FAILED", "stock");

  const session = await mutableSession();
  const result = await createAdminProduct(
    {
      sku,
      slug,
      currency,
      name: name.value,
      description: {
        "es-US": textFrom(formData, "description_es"),
        "en-US": textFrom(formData, "description_en"),
      },
      price_amount_minor: price,
      stock_quantity: stock.value,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  redirect(adminHref(locale, `/catalog/${encodeURIComponent(result.data.id)}`));
}

/**
 * Edicion de nombre, precio y existencias.
 *
 * La moneda se lee del PRODUCTO, no del formulario: es lo que decide cuantos
 * decimales tiene el precio, y un campo oculto se edita en cinco segundos.
 */
export async function updateProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const productId = textFrom(formData, "product_id");
  if (productId === null) return invalid("VALIDATION_FAILED");

  const name = localizedFrom(formData, "name");
  if (!name.ok) return name.result;

  const priceText = textFrom(formData, "price");
  if (priceText === null) return invalid("FIELD_REQUIRED", "price");

  const stock = stockFrom(formData);
  if (!stock.ok) return invalid("VALIDATION_FAILED", "stock");

  const session = await mutableSession();

  const current = await fetchAdminProduct(productId, locale, session);
  if (!current.ok) return fromFailure(current.error);

  const price = priceToMinorUnits(priceText, current.data.currency);
  if (price === null) return invalid("PRICE_INVALID", "price");

  const result = await updateAdminProduct(
    productId,
    { name: name.value, price_amount_minor: price, stock_quantity: stock.value },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Publicar o retirar.
 *
 * `published` se compara con la cadena "true", no con `Boolean()`:
 * `Boolean("false")` es `true`, y ese es exactamente el fallo que publicaria
 * un producto al intentar retirarlo.
 */
export async function publishProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const productId = textFrom(formData, "product_id");
  if (productId === null) return invalid("VALIDATION_FAILED");

  const published = formData.get("published") === "true";

  const session = await mutableSession();
  const result = await publishAdminProduct(productId, { published }, locale, session);

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/** Alta de una promocion. Redirige a su ficha. */
export async function createPromotionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const slug = textFrom(formData, "slug");
  if (slug === null) return invalid("FIELD_REQUIRED", "slug");

  const internalName = textFrom(formData, "internal_name");
  if (internalName === null) return invalid("FIELD_REQUIRED", "internal_name");

  /*
   * La zona se valida aqui con el MISMO catalogo que usa el formateador. No es
   * la comprobacion autoritativa -PostgreSQL vuelve a validarla contra el
   * suyo- pero evita mandar una promocion entera para que vuelva por una zona
   * mal tecleada.
   */
  const timeZone = textFrom(formData, "legal_timezone");
  if (timeZone === null) return invalid("FIELD_REQUIRED", "legal_timezone");
  if (!isIanaTimeZone(timeZone)) return invalid("TIMEZONE_INVALID", "legal_timezone");

  const publicName = localizedFrom(formData, "public_name");
  if (!publicName.ok) return publicName.result;

  const startsAt = windowFieldFrom(formData, "starts_at", timeZone);
  if (!startsAt.ok) return startsAt.result;

  const endsAt = windowFieldFrom(formData, "ends_at", timeZone);
  if (!endsAt.ok) return endsAt.result;

  const session = await mutableSession();
  const result = await createAdminPromotion(
    {
      slug,
      internal_name: internalName,
      legal_timezone: timeZone,
      public_name: publicName.value,
      starts_at: startsAt.value,
      ends_at: endsAt.value,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  redirect(adminHref(locale, `/promotions/${encodeURIComponent(result.data.id)}`));
}

/**
 * Edicion de nombres y ventana.
 *
 * La zona legal se lee de la PROMOCION, no del formulario: es contra la que se
 * resuelven las fechas, y no se edita (DEC-011).
 */
export async function updatePromotionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  const internalName = textFrom(formData, "internal_name");
  if (internalName === null) return invalid("FIELD_REQUIRED", "internal_name");

  const publicName = localizedFrom(formData, "public_name");
  if (!publicName.ok) return publicName.result;

  const session = await mutableSession();

  const current = await fetchAdminPromotion(promotionId, locale, session);
  if (!current.ok) return fromFailure(current.error);

  const timeZone = current.data.legal_timezone;

  const startsAt = windowFieldFrom(formData, "starts_at", timeZone);
  if (!startsAt.ok) return startsAt.result;

  const endsAt = windowFieldFrom(formData, "ends_at", timeZone);
  if (!endsAt.ok) return endsAt.result;

  const result = await updateAdminPromotion(
    promotionId,
    {
      internal_name: internalName,
      public_name: publicName.value,
      starts_at: startsAt.value,
      ends_at: endsAt.value,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Motivo de una transicion sensible, comprobado contra la lista que el panel
 * ofrece.
 *
 * SE COMPARA CON LA LISTA y no se acepta cualquier texto: un `reason_code`
 * manipulado tiene que morir aqui, no viajar al backend. `OTHER` exige nota:
 * un motivo que no dice nada y sin nota es una traza que no explica nada.
 */
function transitionReasonFrom(
  formData: FormData,
  allowed: readonly string[],
):
  | { readonly ok: true; readonly reasonCode: string; readonly reasonText: string | null }
  | { readonly ok: false; readonly result: ActionResult } {
  const reasonCode = textFrom(formData, "reason_code");
  if (reasonCode === null || !allowed.includes(reasonCode)) {
    return { ok: false, result: invalid("FIELD_REQUIRED", "reason_code") };
  }

  const reasonText = textFrom(formData, "reason_text");
  if (reasonCode === "OTHER" && reasonText === null) {
    return { ok: false, result: invalid("FIELD_REQUIRED", "reason_text") };
  }

  return { ok: true, reasonCode, reasonText };
}

/** DRAFT -> SCHEDULED. Sin motivo; con confirmacion. */
export async function schedulePromotionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  if (!checkboxFrom(formData, "confirmed")) return invalid("CONFIRMATION_REQUIRED", "confirmed");

  const session = await mutableSession();
  const result = await scheduleAdminPromotion(promotionId, locale, session);

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * SCHEDULED -> ACTIVE.
 *
 * Si el motor rechaza la transicion, `fromFailure` conserva su mensaje en
 * `detail` y la pantalla lo ensena tal cual: es la unica explicacion fiable de
 * cual de los cerrojos de DEC-012 salto.
 */
export async function activatePromotionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  if (!checkboxFrom(formData, "confirmed")) return invalid("CONFIRMATION_REQUIRED", "confirmed");

  const reason = transitionReasonFrom(formData, PROMOTION_ACTIVATE_REASONS);
  if (!reason.ok) return reason.result;

  const session = await mutableSession();
  const result = await activateAdminPromotion(
    promotionId,
    { reason_code: reason.reasonCode, reason_text: reason.reasonText },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/** ACTIVE -> CLOSED. Mismas reglas que activar. */
export async function closePromotionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  if (!checkboxFrom(formData, "confirmed")) return invalid("CONFIRMATION_REQUIRED", "confirmed");

  const reason = transitionReasonFrom(formData, PROMOTION_CLOSE_REASONS);
  if (!reason.ok) return reason.result;

  const session = await mutableSession();
  const result = await closeAdminPromotion(
    promotionId,
    { reason_code: reason.reasonCode, reason_text: reason.reasonText },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}
