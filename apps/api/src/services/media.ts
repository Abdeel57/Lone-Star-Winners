/**
 * Imagenes de catalogo subidas desde el panel (DEC-056).
 *
 * QUE DECIDE ESTE ARCHIVO
 *   Que bytes son una imagen admisible y como se guardan. Nada mas: no sabe de
 *   productos ni de variantes. El panel sube la imagen, recibe una ruta, y esa
 *   ruta viaja en el `image_url` de siempre (contrato 13.6), con su validacion
 *   de siempre.
 *
 * EL TIPO SE LEE DE LOS BYTES, NO SE PREGUNTA
 *   El cuerpo de la subida no declara `content_type`. Lo que un cliente diga
 *   sobre su propio fichero no vale nada -se escribe a mano en cinco segundos-,
 *   y lo unico que importa es lo que el navegador de un comprador va a recibir.
 *   La firma de los primeros bytes decide el tipo, y lo que no sea JPEG, PNG o
 *   WebP no entra. SVG queda fuera a proposito: es un documento que puede
 *   llevar script.
 *
 * LAS FILAS SON INMUTABLES
 *   `lsw_app` solo tiene SELECT e INSERT sobre `media_assets`. Subir la misma
 *   foto dos veces devuelve la fila que ya existia (`sha256` es UNIQUE).
 */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import type { Database, MediaContentType } from "@lsw/database";
import { MEDIA_MAX_BYTES, mediaAssets } from "@lsw/database";

export { MEDIA_MAX_BYTES };

/** Longitud maxima del base64 de `MEDIA_MAX_BYTES` bytes. */
export const MEDIA_MAX_BASE64_LENGTH = Math.ceil(MEDIA_MAX_BYTES / 3) * 4;

/**
 * Limite de cuerpo de la ruta de subida: el base64 mas el envoltorio JSON, con
 * holgura. Es el unico sitio de la API que acepta mas que `API_BODY_LIMIT_BYTES`.
 */
export const MEDIA_UPLOAD_BODY_LIMIT_BYTES = MEDIA_MAX_BASE64_LENGTH + 4_096;

/**
 * Extension canonica de cada tipo. Una imagen tiene UNA sola direccion.
 *
 * `switch` exhaustivo y no un objeto indexado: anadir un tipo a
 * `MediaContentType` sin decir su extension deja de compilar.
 */
export function extensionOf(contentType: MediaContentType): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Tipo de imagen segun la firma de sus primeros bytes, o `null`.
 *
 * No decodifica la imagen: comprueba que EMPIEZA como una. Es suficiente para
 * lo que protege -que la respuesta no declare `image/png` sobre un HTML- porque
 * ademas se sirve con `nosniff`: un navegador que reciba bytes corruptos bajo
 * un tipo de imagen pinta una imagen rota, no ejecuta nada.
 */
export function sniffImageType(bytes: Buffer): MediaContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Decodifica base64 ESTRICTO, o `null`.
 *
 * `Buffer.from(x, "base64")` no falla nunca: se salta lo que no entiende y
 * devuelve lo que pueda. Aqui se exige el alfabeto, el relleno y la longitud, de
 * modo que lo que se guarda es exactamente lo que se envio.
 */
export function decodeStrictBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return null;

  return Buffer.from(value, "base64");
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Ruta publica de una imagen, en el propio sitio (`apps/web` la sirve). */
export function mediaUrl(asset: {
  readonly id: string;
  readonly contentType: MediaContentType;
}): string {
  return `/media/${asset.id}.${extensionOf(asset.contentType)}`;
}

const MEDIA_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/u;

/** `<uuid>.<ext>` -> sus dos partes, o `null` si no tiene esa forma. */
export function parseMediaFile(
  file: string,
): { readonly id: string; readonly extension: string } | null {
  const match = MEDIA_FILE_PATTERN.exec(file);
  if (match === null) return null;

  const [, id, extension] = match;
  if (id === undefined || extension === undefined) return null;

  return { id, extension };
}

export interface MediaAssetSummary {
  readonly id: string;
  readonly contentType: MediaContentType;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface MediaAssetContent extends MediaAssetSummary {
  readonly content: Buffer;
}

export interface StoreMediaInput {
  readonly contentType: MediaContentType;
  readonly content: Buffer;
  readonly sha256: string;
  readonly uploadedByAdminUserId: string | null;
}

export interface MediaRepository {
  /** Guarda la imagen, o devuelve la que ya existia con ese contenido. */
  store(input: StoreMediaInput): Promise<MediaAssetSummary>;
  find(id: string): Promise<MediaAssetContent | null>;
}

const SUMMARY_COLUMNS = {
  id: mediaAssets.id,
  contentType: mediaAssets.contentType,
  byteSize: mediaAssets.byteSize,
  sha256: mediaAssets.sha256,
} as const;

export function createMediaRepository(db: Database): MediaRepository {
  return {
    async store(input) {
      const inserted = await db
        .insert(mediaAssets)
        .values({
          contentType: input.contentType,
          byteSize: input.content.length,
          sha256: input.sha256,
          content: input.content,
          uploadedByAdminUserId: input.uploadedByAdminUserId,
        })
        // La misma foto subida dos veces NO es un error ni una segunda fila.
        .onConflictDoNothing({ target: mediaAssets.sha256 })
        .returning(SUMMARY_COLUMNS);

      const created = inserted[0];
      if (created !== undefined) return created;

      const existing = await db
        .select(SUMMARY_COLUMNS)
        .from(mediaAssets)
        .where(eq(mediaAssets.sha256, input.sha256))
        .limit(1);

      const found = existing[0];
      if (found === undefined) {
        // El INSERT choco con una fila que el SELECT ya no ve. Las filas no se
        // borran, asi que esto no deberia ocurrir; si ocurre, que se vea.
        throw new Error("media_assets: conflicto de sha256 sin fila existente");
      }

      return found;
    },

    async find(id) {
      const rows = await db
        .select({ ...SUMMARY_COLUMNS, content: mediaAssets.content })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id))
        .limit(1);

      return rows[0] ?? null;
    },
  };
}
