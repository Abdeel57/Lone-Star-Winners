"use server";

import { revalidatePath } from "next/cache";

import type { Locale } from "@/i18n/locales";
import { cancelAmoeSubmission, fetchAmoeConfig, submitAmoe } from "@/lib/api";

import { normalizeAmoeConfig } from "./amoe-config";
import { fromFailure, invalid, SUCCEEDED, type ActionResult } from "./action-result";
import { localeFrom, textFrom } from "./form-input";
import { mutableSession } from "./session-server";

/**
 * Acciones de la via gratuita de participacion (AMOE).
 *
 * LA REGLA QUE GOBIERNA ESTE ARCHIVO ENTERO
 * -----------------------------------------
 * El frontend NO SABE -y no debe saber- que datos se piden para participar sin
 * comprar. Eso lo fijan las Official Rules y lo publica el backend en
 * `required_fields`. Por eso el `payload` se construye LEYENDO ESA LISTA, no
 * recorriendo el formulario: un campo de mas seria recogida de datos personales
 * que nadie autorizo (CLAUDE.md #2) y un campo de menos, un envio rechazado.
 *
 * POR QUE SE VUELVE A PEDIR LA CONFIGURACION AL ENVIAR
 * ----------------------------------------------------
 * Porque la alternativa es que el formulario le diga a la accion que campos hay
 * -en un `<input type="hidden">`- y eso lo edita cualquiera con las
 * herramientas del navegador en cinco segundos. Cuesta una peticion y cierra la
 * unica via por la que el cliente podria decidir la forma del payload.
 *
 * El backend REVALIDA igualmente; esto no es el control, es no ofrecer la
 * puerta.
 *
 * NINGUNA VALIDACION LEGAL VIVE AQUI. No hay edad, ni jurisdiccion, ni limite
 * por periodo, ni formato de codigo. Solo se comprueba que los campos marcados
 * como obligatorios por el backend llevan algo, para no gastar un viaje.
 */

/** Extrae el payload del formulario segun los campos que declara el backend. */
async function payloadFor(
  slug: string,
  locale: Locale,
  formData: FormData,
): Promise<
  | { readonly ok: true; readonly payload: Record<string, string> }
  | { readonly ok: false; readonly result: ActionResult }
> {
  const config = await fetchAmoeConfig(slug, locale);

  if (!config.ok) return { ok: false, result: fromFailure(config.error) };

  /*
   * El flag manda. Si la via esta apagada -o el backend deja de publicar
   * campos- no se envia nada: componer un payload a ciegas seria inventarse el
   * procedimiento de participacion gratuita.
   */
  if (!config.data.enabled) {
    return { ok: false, result: invalid("AMOE_NOT_ENABLED") };
  }

  /*
   * Se leen los campos YA NORMALIZADOS, por la misma razon que la pantalla: la
   * clave del payload es `key` -no una etiqueta, no un nombre inventado aqui- y
   * una respuesta a la que le falte algun descriptor tiene que producir un envio
   * igualmente, no una excepcion en la unica via que no exige comprar nada.
   */
  const fields = normalizeAmoeConfig(config.data).fields;
  if (fields.length === 0) {
    return { ok: false, result: invalid("AMOE_PAYLOAD_INVALID") };
  }

  const payload: Record<string, string> = {};

  for (const field of fields) {
    const raw = formData.get(field.key);
    const value = typeof raw === "string" ? raw.trim() : "";

    if (value.length === 0) {
      if (field.required) {
        return { ok: false, result: invalid("FIELD_REQUIRED", field.key) };
      }
      continue;
    }

    payload[field.key] = value;
  }

  return { ok: true, payload };
}

/**
 * Envio de una participacion gratuita.
 *
 * DEVUELVE EL RESULTADO EN LA MISMA PANTALLA y no redirige. Una modalidad con
 * revision manual responde `PENDING_REVIEW`, que no es un exito ni un fallo:
 * es un estado que hay que explicar donde la persona esta mirando. Redirigir a
 * una pagina de "gracias" borraria esa distincion.
 */
export async function submitAmoeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const slug = textFrom(formData, "promotion_slug");
  if (slug === null) return invalid("VALIDATION_FAILED");

  const promotionId = textFrom(formData, "promotion_id");
  if (promotionId === null) return invalid("VALIDATION_FAILED");

  const built = await payloadFor(slug, locale, formData);
  if (!built.ok) return built.result;

  const session = await mutableSession();
  const result = await submitAmoe(promotionId, { payload: built.payload }, locale, session);

  if (!result.ok) return fromFailure(result.error);

  // El portal tiene que reflejar el envio nuevo en la siguiente navegacion.
  revalidatePath("/", "layout");

  return SUCCEEDED;
}

/**
 * Retirada de un envio propio.
 *
 * NO ES UN BORRADO: el envio pasa a `CANCELLED` y sigue en la lista. Los
 * principios #6 y #7 valen igual para la procedencia de una participacion que
 * para el ledger que la contiene, y un envio que desapareciera dejaria un saldo
 * sin explicacion.
 */
export async function cancelAmoeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const submissionId = textFrom(formData, "submission_id");
  if (submissionId === null) return invalid("VALIDATION_FAILED");

  const session = await mutableSession();
  const result = await cancelAmoeSubmission(submissionId, locale, session);

  if (!result.ok) return fromFailure(result.error);

  revalidatePath("/", "layout");

  return SUCCEEDED;
}
