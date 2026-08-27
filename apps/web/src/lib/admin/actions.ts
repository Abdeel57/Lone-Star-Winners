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
} from "@/lib/api";
import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "@/lib/action-result";
import { localeFrom, secretFrom, textFrom } from "@/lib/form-input";
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
      : { reason_key: reason.reason_key, note: reason.note },
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
      : { reason_key: reason.reason_key, note: reason.note },
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
      : { reason_key: reason.reason_key, note: reason.note },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/admin", "layout");
  return SUCCEEDED;
}
