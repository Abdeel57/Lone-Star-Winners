"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { adminHref } from "@/i18n/admin-routing";
import { FALLBACK_LOCALE, type Locale } from "@/i18n/locales";
import {
  activateAdminRulesVersion,
  ADJUSTMENT_DIRECTIONS,
  ADMIN_PRODUCT_STATUSES,
  AMOE_MODES,
  approveAdjustment,
  approveAdminSettingChangeRequest,
  approveAmoeSubmission,
  createAdjustment,
  createAdminBonusPeriod,
  createAdminProductVariant,
  createAdminRulesVersion,
  createAdminSettingChangeRequest,
  login,
  logout,
  PRODUCT_KINDS,
  putAdminRulesDocument,
  rejectAdminSettingChangeRequest,
  rejectAmoeSubmission,
  transcribeAmoeSubmission,
  updateAdminFeatureFlag,
  updateAdminProductVariant,
  updateAdminRulesVersion,
  verifyMfa,
  type AdjustmentDirection,
  type AdminProductVariantInput,
  type AmoeMode,
  type ProductKind,
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
import {
  BONUS_PERIOD_REASONS,
  FLAG_UPDATE_REASONS,
  PROMOTION_ACTIVATE_REASONS,
  PROMOTION_CLOSE_REASONS,
  RULES_ACTIVATE_REASONS,
} from "@/lib/admin/reason-codes";
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

  const kind = productKindFrom(formData);
  if (kind === null) return invalid("FIELD_REQUIRED", "kind");

  const variants = variantsFrom(formData, currency);
  if (!variants.ok) return variants.result;

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
      kind,
      category_key: textFrom(formData, "category_key"),
      image_url: textFrom(formData, "image_url"),
      // Vacio significa "sin variantes declaradas": la API crea `<sku>-1` con
      // el precio y las existencias de arriba, que es el flujo de siempre.
      ...(variants.value.length === 0 ? {} : { variants: variants.value }),
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

  const kind = productKindFrom(formData);

  const result = await updateAdminProduct(
    productId,
    {
      name: name.value,
      price_amount_minor: price,
      stock_quantity: stock.value,
      /*
       * `kind` SOLO VIAJA SI SE ELIGIO. Sin eleccion no se manda: un producto
       * que la API sirve sin `kind` no se convierte en mercancia por guardar el
       * nombre, porque eso cambiaria en silencio la tasa que se le aplica.
       */
      ...(kind === null ? {} : { kind }),
      category_key: textFrom(formData, "category_key"),
      image_url: textFrom(formData, "image_url"),
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Tipo de producto elegido, comprobado contra el enum del contrato (§13.1).
 *
 * `null` significa QUE NO SE ELIGIO NINGUNO, y quien llama decide si eso es un
 * error -al crear- o una ausencia legitima -al editar un producto que la API
 * sirve sin `kind`-. Nunca se cae a `MERCHANDISE` por defecto: el tipo decide
 * la tasa, y elegir por omision cambiaria lo que vale comprarlo.
 */
function productKindFrom(formData: FormData): ProductKind | null {
  const raw = textFrom(formData, "kind");
  if (raw === null) return null;

  return PRODUCT_KINDS.find((kind) => kind === raw) ?? null;
}

/**
 * Variantes declaradas en el alta, leidas por indice.
 *
 * El formulario numera los campos (`variant_0_name_es`, `variant_1_price`, ...)
 * y manda cuantas hay en `variant_count`. Es la forma que sobrevive SIN
 * JavaScript y sin arrays en `FormData`: cada campo tiene nombre propio.
 *
 * UNA VARIANTE A MEDIAS ES UN ERROR, no una variante con huecos: sin los dos
 * nombres o sin precio no se puede crear, y dejarla pasar produciria un SKU
 * anonimo en la tienda. El precio se convierte a unidad menor en el servidor,
 * sin coma flotante, con la MONEDA DEL PRODUCTO -que es la que decide cuantos
 * decimales tiene-.
 */
function variantsFrom(
  formData: FormData,
  currency: string,
):
  | { readonly ok: true; readonly value: readonly AdminProductVariantInput[] }
  | { readonly ok: false; readonly result: ActionResult } {
  const countRaw = textFrom(formData, "variant_count");
  const count = countRaw === null ? 0 : Number.parseInt(countRaw, 10);
  if (!Number.isSafeInteger(count) || count < 0) return { ok: true, value: [] };

  const value: AdminProductVariantInput[] = [];

  for (let index = 0; index < count; index += 1) {
    const nameEs = textFrom(formData, `variant_${index}_name_es`);
    const nameEn = textFrom(formData, `variant_${index}_name_en`);
    if (nameEs === null) {
      return { ok: false, result: invalid("FIELD_REQUIRED", `variant_${index}_name_es`) };
    }
    if (nameEn === null) {
      return { ok: false, result: invalid("FIELD_REQUIRED", `variant_${index}_name_en`) };
    }

    const priceText = textFrom(formData, `variant_${index}_price`);
    if (priceText === null) {
      return { ok: false, result: invalid("FIELD_REQUIRED", `variant_${index}_price`) };
    }

    const price = priceToMinorUnits(priceText, currency);
    if (price === null) {
      return { ok: false, result: invalid("PRICE_INVALID", `variant_${index}_price`) };
    }

    const stockRaw = textFrom(formData, `variant_${index}_stock`);
    const stock = stockRaw === null ? null : Number.parseInt(stockRaw, 10);
    if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0)) {
      return { ok: false, result: invalid("VALIDATION_FAILED", `variant_${index}_stock`) };
    }

    const sku = textFrom(formData, `variant_${index}_sku`);
    const imageUrl = textFrom(formData, `variant_${index}_image_url`);

    value.push({
      name: { "es-US": nameEs, "en-US": nameEn },
      price_amount_minor: price,
      stock_quantity: stock,
      ...(sku === null ? {} : { sku }),
      ...(imageUrl === null ? {} : { image_url: imageUrl }),
    });
  }

  return { ok: true, value };
}

/**
 * Alta de una variante (§13.6).
 *
 * La moneda se lee del PRODUCTO y no del formulario: es lo que decide cuantos
 * decimales tiene el precio, y un campo oculto se edita en cinco segundos.
 */
export async function createVariantAction(
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

  const sku = textFrom(formData, "sku");
  const imageUrl = textFrom(formData, "image_url");

  const result = await createAdminProductVariant(
    productId,
    {
      name: name.value,
      price_amount_minor: price,
      stock_quantity: stock.value,
      ...(sku === null ? {} : { sku }),
      image_url: imageUrl,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Edicion de una variante, ARCHIVARLA incluida (§13.6).
 *
 * No existe `deleteVariantAction` y no puede existir: un SKU vendido tiene que
 * seguir explicando los pedidos que lo contienen (principios #5 y #6). La API
 * tampoco publica un DELETE.
 */
export async function updateVariantAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const productId = textFrom(formData, "product_id");
  if (productId === null) return invalid("VALIDATION_FAILED");

  const variantId = textFrom(formData, "variant_id");
  if (variantId === null) return invalid("VALIDATION_FAILED");

  const name = localizedFrom(formData, "name");
  if (!name.ok) return name.result;

  const priceText = textFrom(formData, "price");
  if (priceText === null) return invalid("FIELD_REQUIRED", "price");

  const stock = stockFrom(formData);
  if (!stock.ok) return invalid("VALIDATION_FAILED", "stock");

  const statusRaw = textFrom(formData, "status");
  const status =
    statusRaw === null
      ? null
      : (ADMIN_PRODUCT_STATUSES.find((value) => value === statusRaw) ?? null);
  if (statusRaw !== null && status === null) return invalid("VALIDATION_FAILED", "status");

  const session = await mutableSession();

  const current = await fetchAdminProduct(productId, locale, session);
  if (!current.ok) return fromFailure(current.error);

  const price = priceToMinorUnits(priceText, current.data.currency);
  if (price === null) return invalid("PRICE_INVALID", "price");

  const result = await updateAdminProductVariant(
    productId,
    variantId,
    {
      name: name.value,
      price_amount_minor: price,
      stock_quantity: stock.value,
      image_url: textFrom(formData, "image_url"),
      ...(status === null ? {} : { status }),
    },
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

// ---------------------------------------------------------------------------
// Versiones de reglas, bonus, flags y transcripcion (§13.7 a §13.10, DEC-054)
// ---------------------------------------------------------------------------
//
// LO QUE ESTAS ACCIONES NO DECIDEN, Y ES CASI TODO
//
//   No validan una configuracion legal: lo hace la API por rebanadas, con los
//   esquemas del dominio, y responde 422 con la ruta de cada problema. No
//   deciden si una version se puede activar: ese cerrojo es un trigger de
//   PostgreSQL (DEC-012) y su 409 se ensena tal cual. No comprueban ninguna
//   capacidad ni ningun step-up: eso es del autorizador, y su 403 tambien se
//   pinta.
//
//   Y NO RELLENAN NINGUNA CLAVE. Un campo vacio viaja como `"TBD"` o como
//   `null` segun la clave -el formulario lo dice con esas palabras- porque
//   `"TBD"` es el estado honesto de una clave legal sin resolver y un valor por
//   defecto diria que algo esta decidido cuando no lo esta (CLAUDE.md #2).

/**
 * `config` tecleado en la vista JSON avanzada.
 *
 * SE COMPRUEBA QUE SEA UN OBJETO JSON y nada mas. No se valida su contenido
 * -eso es del dominio legal y lo hace la API- pero un texto que no parsea no
 * puede viajar: el backend respondería un 400 sin `path`, y quien opera se
 * quedaría sin saber en que linea se equivoco.
 */
function configFrom(
  formData: FormData,
  field: string,
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly result: ActionResult } {
  const raw = textFrom(formData, field);
  if (raw === null) return { ok: false, result: invalid("FIELD_REQUIRED", field) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, result: invalid("CONFIG_JSON_INVALID", field) };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, result: invalid("CONFIG_JSON_INVALID", field) };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

/**
 * Alta de un borrador de version de reglas.
 *
 * DOS CAMINOS Y NINGUNO INVENTA NADA: vacio -la API compone la plantilla con
 * todas las claves requeridas en `"TBD"`- o CLONANDO otra version, que es el
 * camino normal porque casi ningun cambio legal parte de cero.
 */
export async function createRulesVersionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  const cloneFrom = textFrom(formData, "clone_from_rules_version_id");
  const reference = textFrom(formData, "attorney_approval_reference");

  const session = await mutableSession();
  const result = await createAdminRulesVersion(
    promotionId,
    {
      ...(cloneFrom === null ? {} : { clone_from_rules_version_id: cloneFrom }),
      ...(reference === null ? {} : { attorney_approval_reference: reference }),
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  redirect(
    adminHref(
      locale,
      `/promotions/${encodeURIComponent(promotionId)}/rules/${encodeURIComponent(result.data.id)}`,
    ),
  );
}

/**
 * Edicion del `config` de un borrador.
 *
 * EL CUERPO LLEVA EL OBJETO ENTERO, no un parche por clave. Es lo que pide
 * §13.7 y ademas es lo correcto para un documento legal: enviar solo lo que
 * cambio dejaria al servidor fusionando dos versiones de una configuracion que
 * gobierna cuanto vale una compra.
 */
export async function updateRulesVersionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  const rulesVersionId = textFrom(formData, "rules_version_id");
  if (rulesVersionId === null) return invalid("VALIDATION_FAILED");

  const config = configFrom(formData, "config");
  if (!config.ok) return config.result;

  const reference = textFrom(formData, "attorney_approval_reference");

  const session = await mutableSession();
  const result = await updateAdminRulesVersion(
    promotionId,
    rulesVersionId,
    { config: config.value, attorney_approval_reference: reference },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Documento de una version en un locale.
 *
 * LAS DOS BANDERAS SON INDEPENDIENTES y se envian como se marcaron. No se
 * deduce una de la otra: puede haber una version con las dos lenguas
 * controlantes, y hoy la real es la contraria -ninguna lo es, porque
 * `controlling_language` sigue en `TBD`-. Deducirlas seria decidir cual manda,
 * que es materia del abogado (CLAUDE.md #2).
 */
export async function putRulesDocumentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  const rulesVersionId = textFrom(formData, "rules_version_id");
  if (rulesVersionId === null) return invalid("VALIDATION_FAILED");

  const documentLocale = textFrom(formData, "document_locale");
  if (documentLocale === null) return invalid("VALIDATION_FAILED", "document_locale");

  const title = textFrom(formData, "title");
  if (title === null) return invalid("FIELD_REQUIRED", "title");

  const body = textFrom(formData, "body");
  if (body === null) return invalid("FIELD_REQUIRED", "body");

  const session = await mutableSession();
  const result = await putAdminRulesDocument(
    promotionId,
    rulesVersionId,
    documentLocale,
    {
      title,
      body,
      is_legally_controlling: checkboxFrom(formData, "is_legally_controlling"),
      is_informational_translation: checkboxFrom(formData, "is_informational_translation"),
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Activacion de una version de reglas. Motivo obligatorio y step-up.
 *
 * La pantalla ya lista las claves sin resolver ANTES del boton, para que el 409
 * del motor no sea la primera noticia. Cuando aun asi salta, su mensaje se
 * conserva en `detail` y se ensena tal cual: es la unica explicacion fiable de
 * cual de los cerrojos de DEC-012 se cerro (HO-038 punto 4).
 */
export async function activateRulesVersionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  const rulesVersionId = textFrom(formData, "rules_version_id");
  if (rulesVersionId === null) return invalid("VALIDATION_FAILED");

  if (!checkboxFrom(formData, "confirmed")) return invalid("CONFIRMATION_REQUIRED", "confirmed");

  const reason = transitionReasonFrom(formData, RULES_ACTIVATE_REASONS);
  if (!reason.ok) return reason.result;

  const session = await mutableSession();
  const result = await activateAdminRulesVersion(
    promotionId,
    rulesVersionId,
    { reason_code: reason.reasonCode, reason_text: reason.reasonText },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Atajo "periodo bonus" (§13.8).
 *
 * ES UNA VERSION DE REGLAS NUEVA, no un objeto aparte: clona la activa, le
 * anade el periodo y la activa. Por eso exige lo mismo que activar -motivo y
 * step-up- y por eso el multiplicador viaja como FRACCION (DEC-010), nunca como
 * decimal.
 *
 * EL INSTANTE SE COMPONE EN EL SERVIDOR a partir de un preset -"ahora + 12h"- o
 * de dos fechas escritas. Los presets son comodidad, no una regla: el techo
 * legal lo impone `bonus_rules.max_multiplier` y lo comprueba la API.
 */
export async function createBonusPeriodAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  if (!checkboxFrom(formData, "confirmed")) return invalid("CONFIRMATION_REQUIRED", "confirmed");

  const multiplier = multiplierFrom(formData);
  if (multiplier === null) return invalid("MULTIPLIER_INVALID", "multiplier_numerator");

  const window = bonusWindowFrom(formData);
  if (!window.ok) return window.result;

  const reason = transitionReasonFrom(formData, BONUS_PERIOD_REASONS);
  if (!reason.ok) return reason.result;

  const session = await mutableSession();
  const result = await createAdminBonusPeriod(
    promotionId,
    {
      multiplier,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      product_kind_scope: productKindScopeFrom(formData),
      sku_scope: null,
      conflict_strategy: textFrom(formData, "conflict_strategy"),
      reason_code: reason.reasonCode,
      reason_text: reason.reasonText,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");

  /*
   * LAS ADVERTENCIAS DE LA RESPUESTA SE DEVUELVEN, NO SE TRAGAN.
   *
   * Con `entry_multipliers_enabled` apagado el bonus existe y NO aplica, y la
   * API lo dice en `warnings`. Un exito silencioso dejaria a quien acaba de
   * crear un 5X creyendo que esta activo, que es la peor forma de terminar este
   * gesto. Viajan en `detail` porque es el unico canal de texto libre que tiene
   * `ActionResult`, y la pantalla las pinta como aviso y no como error.
   */
  const warnings = result.data.warnings ?? [];
  if (warnings.length === 0) return SUCCEEDED;

  return { ...SUCCEEDED, detail: warnings.join(" · ") };
}

/**
 * Multiplicador como fraccion (DEC-010).
 *
 * DOS ENTEROS Y NUNCA UN DECIMAL. El panel ofrece 2X, 5X y 10X como atajos
 * -son los que pidio el cliente- y admite escribir numerador y denominador; en
 * los tres casos lo que viaja son dos enteros, porque `3/2` redondeado a "1.5"
 * es una cifra distinta de la que aplica el motor.
 *
 * Aqui NO se comprueba el techo: `bonus_rules.max_multiplier` es una regla legal
 * de la version activa y quien la conoce es la API, que responde 422.
 */
function multiplierFrom(formData: FormData): { numerator: number; denominator: number } | null {
  const numerator = positiveIntegerFrom(formData, "multiplier_numerator");
  if (numerator === null) return null;

  const denominator = positiveIntegerFrom(formData, "multiplier_denominator") ?? 1;

  return { numerator, denominator };
}

function positiveIntegerFrom(formData: FormData, field: string): number | null {
  const raw = textFrom(formData, field);
  if (raw === null) return null;
  if (!/^\d+$/u.test(raw)) return null;

  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) return null;

  return value;
}

/**
 * Ventana del periodo bonus.
 *
 * DOS FORMAS, Y LA COMODA ES LA DEL PRESET. "Ahora + 12h" es literalmente el
 * gesto que pidio el cliente, y componerlo en el SERVIDOR -no en el navegador-
 * es lo que evita que la duracion dependa del reloj de quien pulsa (DEC-011).
 *
 * Con fechas escritas se toman tal cual, en ISO UTC. No se convierten desde la
 * zona legal de la promocion: el formulario pide instantes absolutos y lo dice,
 * porque un periodo bonus de doce horas cruzando un cambio de horario no tiene
 * una respuesta obvia y no es el frontend quien debe elegirla.
 */
function bonusWindowFrom(
  formData: FormData,
):
  | { readonly ok: true; readonly startsAt: string; readonly endsAt: string }
  | { readonly ok: false; readonly result: ActionResult } {
  const preset = textFrom(formData, "duration_preset");

  if (preset !== null && preset !== "custom") {
    /*
     * `preset` es texto de formulario y el mapa es una constante literal de
     * este archivo: una clave desconocida devuelve `undefined` y se rechaza en
     * la linea siguiente, que es exactamente la comprobacion que la regla pide.
     */
    // eslint-disable-next-line security/detect-object-injection
    const hours = BONUS_PRESET_HOURS[preset];
    if (hours === undefined)
      return { ok: false, result: invalid("VALIDATION_FAILED", "duration_preset") };

    const now = Date.now();
    return {
      ok: true,
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + hours * 3_600_000).toISOString(),
    };
  }

  const startsAt = textFrom(formData, "starts_at");
  if (startsAt === null) return { ok: false, result: invalid("FIELD_REQUIRED", "starts_at") };

  const endsAt = textFrom(formData, "ends_at");
  if (endsAt === null) return { ok: false, result: invalid("FIELD_REQUIRED", "ends_at") };

  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start)) return { ok: false, result: invalid("DATETIME_INVALID", "starts_at") };
  if (Number.isNaN(end)) return { ok: false, result: invalid("DATETIME_INVALID", "ends_at") };

  // La API tambien lo rechaza (422). Se comprueba aqui para no mandar a nadie a
  // firmar una accion que ya se sabe que va a fallar.
  if (end <= start) return { ok: false, result: invalid("DATETIME_INVALID", "ends_at") };

  return { ok: true, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

/** Presets de duracion que ofrece el panel. Comodidad, no regla legal. */
const BONUS_PRESET_HOURS: Readonly<Record<string, number>> = {
  "6h": 6,
  "12h": 12,
  "24h": 24,
  "48h": 48,
};

/**
 * Ambito por tipo de producto.
 *
 * `null` significa TODOS y es lo que viaja cuando se eligen los dos o ninguno:
 * es la forma que espera el contrato, y enumerar los dos tipos daria el mismo
 * resultado con mas superficie de error.
 */
function productKindScopeFrom(formData: FormData): readonly ProductKind[] | null {
  const raw = textFrom(formData, "product_kind_scope");
  if (raw === null || raw === "ALL") return null;

  const kind = PRODUCT_KINDS.find((candidate) => candidate === raw);
  return kind === undefined ? null : [kind];
}

/**
 * Cambio de un feature flag, con motivo.
 *
 * LA MATERIALIDAD LEGAL NO SE COMPRUEBA AQUI. Que un flag exija
 * `flag.update.legally_material` y step-up lo decide el autorizador con el
 * catalogo de `@lsw/security`; esta accion manda el cambio y el 403 se pinta
 * como estado deliberado. La pantalla lo ADVIERTE antes, que es otra cosa.
 */
export async function updateFeatureFlagAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const key = textFrom(formData, "flag_key");
  if (key === null) return invalid("VALIDATION_FAILED", "flag_key");

  const reason = transitionReasonFrom(formData, FLAG_UPDATE_REASONS);
  if (!reason.ok) return reason.result;

  /*
   * `enabled` se compara con la cadena "true" y no con `Boolean()`:
   * `Boolean("false")` es `true`, y ese es exactamente el fallo que encenderia
   * un flag legalmente material al intentar apagarlo.
   */
  const enabled = formData.get("enabled") === "true";

  const session = await mutableSession();
  const result = await updateAdminFeatureFlag(
    key,
    { enabled, reason_code: reason.reasonCode, reason_text: reason.reasonText },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Solicitud de cambio de un ajuste legalmente material
 * (HO-041, resolucion fase 1).
 *
 * SUSTITUYE AL `PATCH` DIRECTO. Encender `amoe_enabled` o apagar
 * `entry_caps_enabled` cambia lo que la plataforma afirma o aplica sobre las
 * condiciones de participacion, y DEC-032 pide segunda aprobacion para eso. La
 * respuesta no fue rebajar la capacidad de la ruta: fue construir el control
 * dual, igual que en los ajustes de participaciones.
 *
 * DOS TIPOS DE AJUSTE, UN SOLO GESTO: un flag (`enabled`) y la modalidad AMOE
 * (`amoe_mode`). Solo viaja el valor que corresponde al tipo; mandar los dos
 * "por si acaso" no diria que se esta pidiendo, y la API responde 422.
 *
 * NO DEDUCE EL EFECTO. Con `dual_approval_for_sensitive_actions_enabled`
 * apagado, la API aplica el cambio al momento y lo dice con `status: "APPLIED"`.
 * Suponer que siempre queda pendiente diria que no ha pasado nada cuando si ha
 * pasado.
 */
export async function requestSettingChangeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const kindRaw = textFrom(formData, "setting_kind");
  const kind =
    kindRaw === "AMOE_MODE" ? "AMOE_MODE" : kindRaw === "FEATURE_FLAG" ? "FEATURE_FLAG" : null;
  if (kind === null) return invalid("VALIDATION_FAILED", "setting_kind");

  const key = textFrom(formData, "setting_key");
  if (key === null) return invalid("VALIDATION_FAILED", "setting_key");

  const reason = transitionReasonFrom(formData, FLAG_UPDATE_REASONS);
  if (!reason.ok) return reason.result;

  let value: { readonly enabled: boolean } | { readonly amoe_mode: AmoeMode | null };

  if (kind === "AMOE_MODE") {
    /*
     * Vacio significa NINGUNA MODALIDAD, y es un estado real: alguien enciende
     * la via gratuita antes de que el abogado fije como funciona. Viaja como
     * `null` y no como cadena vacia, que no es un valor del enum.
     */
    const raw = textFrom(formData, "amoe_mode");
    const mode = raw === null ? null : (AMOE_MODES.find((candidate) => candidate === raw) ?? null);
    if (raw !== null && mode === null) return invalid("VALIDATION_FAILED", "amoe_mode");

    value = { amoe_mode: mode };
  } else {
    /*
     * `enabled` se compara con la cadena "true" y no con `Boolean()`:
     * `Boolean("false")` es `true`, y ese es exactamente el fallo que pediria
     * ENCENDER un flag legalmente material al intentar apagarlo.
     */
    value = { enabled: formData.get("enabled") === "true" };
  }

  const session = await mutableSession();
  const result = await createAdminSettingChangeRequest(
    {
      setting_kind: kind,
      setting_key: key,
      ...value,
      reason_code: reason.reasonCode,
      reason_text: reason.reasonText,
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");

  /*
   * El estado viaja en `detail` para que la pantalla pueda decir si el cambio
   * quedo pendiente o si ya se aplico. Es la misma via por la que llegan los
   * `warnings` del atajo bonus y el mensaje del motor: texto que produce el
   * backend y que la interfaz no redacta.
   */
  return { ...SUCCEEDED, detail: result.data.status };
}

/**
 * Aprobacion o rechazo de una solicitud de cambio.
 *
 * QUIEN LA PIDIO NO PUEDE APROBARLA. Que la pantalla no ofrezca el boton es
 * cortesia; el control lo aplican el servicio y una `CHECK` de la tabla, y
 * responden 409 `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN`. Si esta accion se
 * llamara igualmente sobre una solicitud propia, ese 409 es lo correcto y se
 * pinta tal cual.
 */
export async function decideSettingChangeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const requestId = textFrom(formData, "request_id");
  if (requestId === null) return invalid("VALIDATION_FAILED", "request_id");

  const decision = textFrom(formData, "decision");
  if (decision !== "approve" && decision !== "reject") {
    return invalid("VALIDATION_FAILED", "decision");
  }

  const reason = transitionReasonFrom(formData, FLAG_UPDATE_REASONS);
  if (!reason.ok) return reason.result;

  const body = {
    reason_code: reason.reasonCode,
    reason_text: reason.reasonText,
    decision_notes: reason.reasonText,
  };

  const session = await mutableSession();
  const result =
    decision === "approve"
      ? await approveAdminSettingChangeRequest(requestId, body, locale, session)
      : await rejectAdminSettingChangeRequest(requestId, body, locale, session);

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}

/**
 * Transcripcion de una ficha postal (§13.10).
 *
 * EL `payload` SE COMPONE CON LOS CAMPOS QUE DECLARA LA CONFIGURACION, ni uno
 * mas ni uno menos. Las claves llegan en un campo oculto porque quien las fija
 * es la version de reglas -a traves de `required_fields`- y no esta accion:
 * escribirlas aqui seria fijar en el frontend que se pide para participar
 * gratis, que es justo lo que el principio 2 prohibe.
 *
 * QUIEN TRANSCRIBE NO PODRA APROBAR. No se comprueba aqui -la accion no sabe
 * quien aprobara despues-: lo aplica el backend comparando actores y responde
 * 409 `SEPARATION_OF_DUTIES`.
 */
export async function transcribeAmoeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED", "promotion_id");

  const email = textFrom(formData, "participant_email");
  if (email === null) return invalid("FIELD_REQUIRED", "participant_email");

  const keysRaw = textFrom(formData, "payload_keys");
  if (keysRaw === null) return invalid("VALIDATION_FAILED", "payload_keys");

  const payload: Record<string, string> = {};
  for (const key of keysRaw.split(",").filter((candidate) => candidate.length > 0)) {
    const value = textFrom(formData, `field_${key}`);
    /*
     * Las claves salen de `required_fields` de la configuracion AMOE, no de
     * entrada libre, y el objeto se construye aqui mismo: nada se lee de el
     * despues, solo se serializa como cuerpo JSON de la peticion.
     */
    // eslint-disable-next-line security/detect-object-injection
    if (value !== null) payload[key] = value;
  }

  const envelope = textFrom(formData, "envelope_reference");
  const cards = positiveIntegerFrom(formData, "cards_in_envelope");

  const session = await mutableSession();
  const result = await transcribeAmoeSubmission(
    {
      promotion_id: promotionId,
      participant_email: email,
      payload,
      ...(envelope === null ? {} : { envelope_reference: envelope }),
      ...(cards === null ? {} : { cards_in_envelope: cards }),
    },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}
