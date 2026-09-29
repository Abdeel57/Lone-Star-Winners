/**
 * Imagenes de catalogo subidas desde el panel (DEC-056, contrato 14).
 *
 * ---------------------------------------------------------------------------
 * RUTAS
 * ---------------------------------------------------------------------------
 *
 *   POST /admin/media ......... `product.write`
 *   GET  /media/:file ......... PUBLIC
 *
 * ---------------------------------------------------------------------------
 * POR QUE `product.write` Y NO UNA CAPACIDAD NUEVA
 * ---------------------------------------------------------------------------
 * Lo unico que se puede hacer con una imagen subida es ponerla en el
 * `image_url` de un producto o de una variante, y eso ya exige `product.write`.
 * Una capacidad `media.upload` separada seria una puerta que nadie puede abrir
 * sin la otra, y una fila mas que sembrar, conceder y auditar sin que cambie
 * quien puede hacer que.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL CUERPO ES JSON CON BASE64 Y NO `multipart/form-data`
 * ---------------------------------------------------------------------------
 * DEC-014: Zod es el unico lenguaje de esquemas, y de el salen la validacion, los
 * tipos y el OpenAPI. Un parser multipart es una dependencia nueva que valida
 * por su cuenta y fuera de ese esquema. Quien llama aqui es el servidor de Next
 * -el navegador no habla con esta API-, asi que el 33 % de sobrecoste del
 * base64 viaja por la red interna, una vez por foto, y a cambio la ruta es una
 * mas del registro.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO HACE
 * ---------------------------------------------------------------------------
 * No toca ningun producto. Subir devuelve una ruta; asociarla es el `PATCH` de
 * siempre, con su validacion de siempre.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  MEDIA_MAX_BASE64_LENGTH,
  MEDIA_MAX_BYTES,
  MEDIA_UPLOAD_BODY_LIMIT_BYTES,
  createMediaRepository,
  decodeStrictBase64,
  extensionOf,
  mediaUrl,
  parseMediaFile,
  sha256Hex,
  sniffImageType,
  type MediaRepository,
} from "../services/media.js";

const uploadBodySchema = z.object({
  /**
   * Los bytes de la imagen en base64 estandar, con relleno.
   *
   * NO hay `content_type`: el tipo se lee de la firma de los bytes. Ver la
   * cabecera de `services/media.ts`.
   */
  data_base64: z.string().min(4).max(MEDIA_MAX_BASE64_LENGTH),
});

const mediaSchema = z.object({
  id: z.uuid(),
  /** Ruta raiz del propio sitio. Es lo que se manda despues como `image_url`. */
  url: z.string(),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byte_size: z.number().int(),
});

/**
 * Cadena libre y no un patron: un nombre que no tenga forma de `<uuid>.<ext>`
 * es una imagen que no existe -404-, no una peticion mal formada -422-. Quien
 * pide aqui es una etiqueta `<img>`, y a una imagen solo le sirve el 404.
 */
const mediaParamsSchema = z.object({ file: z.string().min(1).max(64) });

const mediaTooLarge = (): ApiError =>
  new ApiError({
    statusCode: 413,
    code: "MEDIA_TOO_LARGE",
    details: { max_bytes: MEDIA_MAX_BYTES },
  });

const mediaTypeUnsupported = (): ApiError =>
  new ApiError({
    statusCode: 415,
    code: "MEDIA_TYPE_UNSUPPORTED",
    details: { accepted: ["image/jpeg", "image/png", "image/webp"] },
  });

export function buildMediaRoutes(dependencies: AppDependencies): RouteDefinition[] {
  // Perezoso por el mismo motivo que en `admin-catalog.ts`: el emisor del
  // contrato llama a este builder sin base de datos.
  let repository: MediaRepository | null = null;

  const repo = (): MediaRepository => {
    repository ??= createMediaRepository(dependencies.database.db);
    return repository;
  };

  return [
    {
      method: "POST",
      url: "/api/v1/admin/media",
      operationId: "uploadAdminMedia",
      summary: "Subir una imagen de catalogo. Devuelve la ruta que va en `image_url`.",
      description:
        "Acepta JPEG, PNG o WebP de hasta 5 MiB; el tipo se decide por la firma de los bytes, no por lo que declare el cliente. La imagen es inmutable: cambiar la foto de un producto es subir otra. Subir dos veces el mismo contenido devuelve la misma imagen. NO asocia nada: la ruta devuelta se manda despues como `image_url` en el alta o el PATCH del producto o la variante.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.write" },
      bodyLimitBytes: MEDIA_UPLOAD_BODY_LIMIT_BYTES,
      schema: {
        body: uploadBodySchema,
        response: {
          201: mediaSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          413: errorEnvelopeSchema,
          415: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const body = request.body as z.infer<typeof uploadBodySchema>;

        const content = decodeStrictBase64(body.data_base64);
        if (content === null) {
          throw ApiErrors.validationFailed([{ path: "data_base64", code: "invalid_base64" }]);
        }

        if (content.length === 0 || content.length > MEDIA_MAX_BYTES) throw mediaTooLarge();

        const contentType = sniffImageType(content);
        if (contentType === null) throw mediaTypeUnsupported();

        const stored = await repo().store({
          contentType,
          content,
          sha256: sha256Hex(content),
          uploadedByAdminUserId: staff.adminUserId,
        });

        void reply.code(201);
        return {
          id: stored.id,
          url: mediaUrl(stored),
          content_type: stored.contentType,
          byte_size: stored.byteSize,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/media/:file",
      operationId: "getMedia",
      summary: "Los bytes de una imagen de catalogo.",
      description:
        "`:file` es `<id>.<ext>`, con la extension canonica del tipo guardado (`jpg`, `png`, `webp`); cualquier otra forma es 404. El contenido es inmutable y se sirve con `immutable`. `apps/web` lo expone en su propio origen como `/media/:file`, que es la forma que lleva `image_url`.",
      tags: ["products"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Son las fotos de la mercancia del escaparate, tan publicas como la ficha de producto que las muestra. Solo devuelve los bytes de una imagen por su identificador; no enumera ni revela quien la subio.",
      },
      binaryResponses: { 200: ["image/jpeg", "image/png", "image/webp"] },
      schema: {
        params: mediaParamsSchema,
        response: { 404: errorEnvelopeSchema },
      },
      handler: async (request, reply) => {
        const params = request.params as z.infer<typeof mediaParamsSchema>;

        const parsed = parseMediaFile(params.file);
        if (parsed === null) throw ApiErrors.notFound();

        const asset = await repo().find(parsed.id);

        // UNA sola direccion por imagen: `<id>.png` sobre un JPEG es 404, no un
        // JPEG servido bajo otro nombre.
        if (asset === null || extensionOf(asset.contentType) !== parsed.extension) {
          throw ApiErrors.notFound();
        }

        const etag = `"${asset.sha256}"`;

        void reply
          .header("cache-control", "public, max-age=31536000, immutable")
          .header("etag", etag);

        if (request.headers["if-none-match"] === etag) {
          return reply.code(304).send();
        }

        // El tipo sale de la FILA -que lo fijo la firma de los bytes al subir-,
        // nunca de la extension pedida. Un `Buffer` no pasa por el serializador.
        return reply.type(asset.contentType).send(asset.content);
      },
    },
  ];
}
