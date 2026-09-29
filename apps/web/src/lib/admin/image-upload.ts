import type { Locale } from "@/i18n/locales";
import { fromFailure, invalid, type ActionResult } from "@/lib/action-result";
import {
  ADMIN_MEDIA_CONTENT_TYPES,
  ADMIN_MEDIA_MAX_BYTES,
  uploadAdminMedia,
  type SessionContext,
} from "@/lib/api";
import { checkboxFrom } from "@/lib/form-input";

/**
 * Imagen de un formulario del panel (§14, DEC-056).
 *
 * LA FOTO SALE DEL DISPOSITIVO, NO DE UNA URL. Quien edita el catalogo lo hace
 * desde el telefono, y lo que tiene es la foto. El fichero viaja dentro del
 * mismo `<form>` que el resto de campos -funciona sin JavaScript-, esta funcion
 * lo sube a la API y devuelve la ruta que va en `image_url`. El navegador sigue
 * sin hablar con `apps/api`.
 *
 * VIVE FUERA DE `actions.ts` A PROPOSITO: todo lo que exporta un modulo
 * `"use server"` se convierte en una accion invocable desde el navegador, y esto
 * es un ayudante, no una accion.
 *
 * ESTA VALIDACION NO ES AUTORITATIVA, como el resto de `form-input.ts`. El tipo
 * que declara el navegador (`file.type`) se escribe a mano en cinco segundos; la
 * API decide el tipo leyendo la firma de los bytes. Aqui se comprueba para
 * contestar rapido y junto al campo, sin gastar una subida de 5 MB en algo que
 * se sabe que va a rebotar.
 */

/**
 * Lo que el formulario dice sobre UNA imagen:
 *
 *   - una cadena ...... se subio una foto nueva; es su ruta;
 *   - `null` .......... se marco "quitar la imagen";
 *   - `undefined` ..... no se toco. En una edicion NO se manda `image_url`, y la
 *                       API deja la que hubiera.
 */
export type ImageFieldResult =
  | { readonly ok: true; readonly value: string | null | undefined }
  | { readonly ok: false; readonly result: ActionResult };

/**
 * Fichero elegido en `<input type="file" name={field}>`, o `null`.
 *
 * Un input de fichero SIN seleccion no llega ausente: llega como un `File` de
 * cero bytes y nombre vacio. Tratar eso como "subio un fichero vacio" haria que
 * guardar cualquier formulario sin tocar la foto fallara.
 */
function fileFrom(formData: FormData, field: string): File | null {
  const raw = formData.get(field);
  if (typeof raw !== "object" || raw === null) return null;
  if (raw.size === 0) return null;
  return raw;
}

/**
 * Comprueba la imagen de `${prefix}_file` SIN subirla.
 *
 * Separado de la subida para que una accion pueda validar TODAS las fotos del
 * formulario antes de subir ninguna: si la tercera variante trae un PDF, no se
 * han guardado ya dos imagenes que nadie va a usar.
 */
export function checkImage(formData: FormData, prefix: string): ActionResult | null {
  const field = `${prefix}_file`;
  const file = fileFrom(formData, field);
  if (file === null) return null;

  if (!(ADMIN_MEDIA_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return invalid("MEDIA_TYPE_UNSUPPORTED", field);
  }

  if (file.size > ADMIN_MEDIA_MAX_BYTES) return invalid("MEDIA_TOO_LARGE", field);

  return null;
}

/**
 * Sube la imagen de `${prefix}_file`, si la hay, y devuelve su ruta.
 *
 * Con foto nueva Y "quitar" marcado gana la foto: quien acaba de elegir una
 * imagen quiere esa imagen, y la casilla se quedo marcada de antes.
 */
export async function imageFrom(
  formData: FormData,
  prefix: string,
  locale: Locale,
  session: SessionContext,
): Promise<ImageFieldResult> {
  const field = `${prefix}_file`;

  const rejected = checkImage(formData, prefix);
  if (rejected !== null) return { ok: false, result: rejected };

  const file = fileFrom(formData, field);

  if (file === null) {
    return { ok: true, value: checkboxFrom(formData, `${prefix}_remove`) ? null : undefined };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadAdminMedia(
    { data_base64: bytes.toString("base64") },
    locale,
    session,
  );

  if (!uploaded.ok) return { ok: false, result: fromFailure(uploaded.error, field) };

  return { ok: true, value: uploaded.data.url };
}
